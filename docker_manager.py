import docker
import secrets
import string
import os
import time
import re
import tempfile

client = docker.from_env()

NETWORK_NAME = "lvm_panel_net"
NETWORK_SUBNET = "10.77.0.0/16"

# NOTE: We intentionally do NOT run full systemd / privileged containers here.
# Privileged mode + cgroup bind-mounts are unreliable across different hosts
# (cgroup v1 vs v2, kernel differences, OpenVZ/LXC hosts, etc.) and were the
# cause of VPS creation ending up stuck in "error". Instead every VPS is a
# normal container that boots straight into sshd + tmate, which works
# reliably on any Docker host and is all that's needed for SSH/tmate access.
DOCKERFILE_TEMPLATE = """
FROM {base_image}
ENV DEBIAN_FRONTEND=noninteractive
RUN (apt-get update && \\
    apt-get install -y openssh-server tmate sudo curl wget nano vim htop \\
        net-tools iproute2 iputils-ping ca-certificates && \\
    apt-get clean && rm -rf /var/lib/apt/lists/*) || \\
    (apk update && apk add --no-cache openssh tmate sudo curl wget nano bash)
RUN echo "root:{root_password}" | chpasswd || (echo "root:{root_password}" | chpasswd -R /)
RUN mkdir -p /var/run/sshd && \\
    (ssh-keygen -A || true) && \\
    (sed -i 's/#\\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config || true) && \\
    (sed -i 's/#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config || true)
RUN echo 'Welcome to your LVM Panel VPS ({vps_id})' > /etc/motd
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
"""


def ensure_network():
    """Create an isolated bridge network so every VPS gets a private IPv4 address."""
    try:
        client.networks.get(NETWORK_NAME)
    except docker.errors.NotFound:
        ipam_pool = docker.types.IPAMPool(subnet=NETWORK_SUBNET)
        ipam_config = docker.types.IPAMConfig(pool_configs=[ipam_pool])
        client.networks.create(NETWORK_NAME, driver="bridge", ipam=ipam_config)


def gen_password(length=14):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def build_image(vps_id, os_image, root_password):
    dockerfile = DOCKERFILE_TEMPLATE.format(
        base_image=os_image,
        root_password=root_password,
        vps_id=vps_id
    )
    build_dir = tempfile.mkdtemp(prefix=f"lvm_{vps_id}_")
    with open(os.path.join(build_dir, "Dockerfile"), "w") as f:
        f.write(dockerfile)

    image, logs = client.images.build(path=build_dir, tag=f"lvm-panel/{vps_id}", rm=True)
    return image


def create_container(vps_id, ram_gb, cpu_cores, disk_gb, os_image):
    """Builds and starts an SSH-ready container acting as a lightweight VPS.
    Publishes container port 22 to a random free host port so the VPS is
    reachable from the outside world (e.g. Termius) via HOST_IP:PORT.
    """
    ensure_network()
    root_password = gen_password()

    build_image(vps_id, os_image, root_password)

    container = client.containers.run(
        image=f"lvm-panel/{vps_id}",
        name=f"lvm-{vps_id}",
        detach=True,
        tty=True,
        network=NETWORK_NAME,
        mem_limit=f"{ram_gb}g",
        nano_cpus=int(cpu_cores * 1_000_000_000),
        ports={"22/tcp": None},  # None = docker assigns a random free host port
        restart_policy={"Name": "unless-stopped"},
        # tmate's relay (tmate.io) often has an AAAA (IPv6) DNS record. On an
        # isolated bridge network the container has no real IPv6 route, so
        # tmate's connect() fails with "Host is down". Disabling IPv6 inside
        # the container forces it to fall back to IPv4, which always works.
        sysctls={
            "net.ipv6.conf.all.disable_ipv6": "1",
            "net.ipv6.conf.default.disable_ipv6": "1",
        },
        dns=["8.8.8.8", "1.1.1.1"],
    )

    time.sleep(2)
    container.reload()

    private_ip = None
    try:
        private_ip = container.attrs["NetworkSettings"]["Networks"][NETWORK_NAME]["IPAddress"]
    except Exception:
        pass

    ssh_port = None
    try:
        port_info = container.attrs["NetworkSettings"]["Ports"]["22/tcp"]
        if port_info:
            ssh_port = int(port_info[0]["HostPort"])
    except Exception:
        pass

    return {
        "container_id": container.id,
        "container_name": container.name,
        "private_ip": private_ip,
        "ssh_port": ssh_port,
        "root_password": root_password,
    }


def update_resources(container_id, ram_gb, cpu_cores):
    """Live-updates RAM/CPU limits on a running container without recreating it."""
    c = get_container(container_id)
    if not c:
        return False
    c.update(mem_limit=f"{ram_gb}g", nano_cpus=int(cpu_cores * 1_000_000_000))
    return True


def get_uptime_seconds(container_id):
    """Returns how many seconds the container has been running, or None."""
    import datetime
    c = get_container(container_id)
    if not c:
        return None
    c.reload()
    if c.status != "running":
        return None
    started_at = c.attrs["State"].get("StartedAt")
    if not started_at:
        return None
    try:
        started_at = started_at.split(".")[0].replace("Z", "")
        started_dt = datetime.datetime.fromisoformat(started_at)
        delta = datetime.datetime.utcnow() - started_dt
        return int(delta.total_seconds())
    except Exception:
        return None


def get_container(container_id):
    if not container_id:
        return None
    try:
        return client.containers.get(container_id)
    except docker.errors.NotFound:
        return None


def start_vps(container_id):
    c = get_container(container_id)
    if c:
        c.start()
        return True
    return False


def stop_vps(container_id):
    c = get_container(container_id)
    if c:
        c.stop()
        return True
    return False


def restart_vps(container_id):
    c = get_container(container_id)
    if c:
        c.restart()
        return True
    return False


def remove_vps(container_id):
    c = get_container(container_id)
    if c:
        try:
            c.remove(force=True)
        except Exception:
            pass
        return True
    return False


def reinstall_vps(vps_id, container_id, ram_gb, cpu_cores, disk_gb, os_image):
    """Wipes the current container and rebuilds a fresh one with the same specs."""
    remove_vps(container_id)
    try:
        client.images.remove(f"lvm-panel/{vps_id}", force=True)
    except Exception:
        pass
    return create_container(vps_id, ram_gb, cpu_cores, disk_gb, os_image)


def get_status(container_id):
    c = get_container(container_id)
    if not c:
        return "not_found"
    c.reload()
    return c.status


def get_ssh_port(container_id):
    c = get_container(container_id)
    if not c:
        return None
    c.reload()
    try:
        port_info = c.attrs["NetworkSettings"]["Ports"]["22/tcp"]
        if port_info:
            return int(port_info[0]["HostPort"])
    except Exception:
        pass
    return None


def generate_tmate_session(container_id):
    """Starts a tmate session inside the container and returns the SSH connection string."""
    c = get_container(container_id)
    if not c:
        return None

    c.exec_run("pkill tmate", detach=True)
    time.sleep(1)
    c.exec_run(
        "bash -lc \"tmate -S /tmp/tmate.sock new-session -d && "
        "tmate -S /tmp/tmate.sock wait tmate-ready\"",
        detach=False,
    )
    result = c.exec_run("bash -lc \"tmate -S /tmp/tmate.sock display -p '#{tmate_ssh}'\"")
    output = result.output.decode(errors="ignore").strip()
    match = re.search(r"(ssh\s+\S+)", output)
    if match:
        return match.group(1)
    return output or None


# ---------------- Web console (browser terminal) ----------------

def open_console_socket(container_id, shell="/bin/bash"):
    """Creates an interactive exec session inside the container and returns the
    raw docker-py socket object, which streams raw PTY bytes both ways. The
    caller is responsible for bridging this to a WebSocket connection."""
    c = get_container(container_id)
    if not c:
        return None

    exec_id = client.api.exec_create(
        c.id,
        cmd=[shell, "-l"] if shell_exists(c, shell) else ["/bin/sh", "-l"],
        stdin=True, tty=True, stdout=True, stderr=True,
    )["Id"]

    sock = client.api.exec_start(exec_id, tty=True, socket=True, demux=False)
    # docker-py wraps the raw socket; grab the underlying fd-like object
    raw = sock._sock if hasattr(sock, "_sock") else sock
    return raw, exec_id


def shell_exists(container, shell_path):
    try:
        result = container.exec_run(f"test -x {shell_path}")
        return result.exit_code == 0
    except Exception:
        return False


def resize_exec(exec_id, rows, cols):
    try:
        client.api.exec_resize(exec_id, height=rows, width=cols)
    except Exception:
        pass


# ---------------- File manager ----------------

def list_files(container_id, path="/root"):
    """Returns a list of {name, is_dir, size, mtime} for the given path."""
    c = get_container(container_id)
    if not c:
        return None
    # Use a stable, easy-to-parse format: type|size|epoch|name
    cmd = (
        "bash -lc \"cd '%s' 2>/dev/null && "
        "for f in .* *; do "
        "[ \\\"$f\\\" = '.' ] && continue; "
        "[ \\\"$f\\\" = '..' ] && continue; "
        "if [ -e \\\"$f\\\" ]; then "
        "stat -c '%%F|%%s|%%Y|%%n' \\\"$f\\\" 2>/dev/null; fi; done\""
        % path.replace("'", "'\\''")
    )
    result = c.exec_run(cmd)
    if result.exit_code not in (0, None):
        return None
    entries = []
    for line in result.output.decode(errors="ignore").splitlines():
        parts = line.split("|", 3)
        if len(parts) != 4:
            continue
        ftype, size, mtime, name = parts
        entries.append({
            "name": name,
            "is_dir": "directory" in ftype,
            "size": int(size) if size.isdigit() else 0,
            "mtime": int(mtime) if mtime.isdigit() else 0,
        })
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    return entries


def read_file(container_id, path):
    """Downloads a single file from the container as bytes via a tar stream."""
    import tarfile
    import io
    c = get_container(container_id)
    if not c:
        return None
    try:
        stream, _ = c.get_archive(path)
        raw = io.BytesIO()
        for chunk in stream:
            raw.write(chunk)
        raw.seek(0)
        with tarfile.open(fileobj=raw) as tar:
            member = tar.getmembers()[0]
            f = tar.extractfile(member)
            return f.read() if f else None
    except Exception:
        return None


def write_file(container_id, dest_dir, filename, file_bytes):
    """Uploads a single file into the container at dest_dir/filename."""
    import tarfile
    import io
    c = get_container(container_id)
    if not c:
        return False
    try:
        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode="w") as tar:
            info = tarfile.TarInfo(name=filename)
            info.size = len(file_bytes)
            tar.addfile(info, io.BytesIO(file_bytes))
        tar_stream.seek(0)
        c.put_archive(dest_dir, tar_stream.read())
        return True
    except Exception:
        return False


def delete_path(container_id, path):
    c = get_container(container_id)
    if not c:
        return False
    result = c.exec_run(["rm", "-rf", path])
    return result.exit_code == 0


def make_dir(container_id, path):
    c = get_container(container_id)
    if not c:
        return False
    result = c.exec_run(["mkdir", "-p", path])
    return result.exit_code == 0
