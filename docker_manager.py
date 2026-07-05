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

DOCKERFILE_TEMPLATE = """
FROM {base_image}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \\
    apt-get install -y systemd systemd-sysv dbus sudo curl wget \\
        openssh-server tmate iproute2 iputils-ping nano vim htop net-tools \\
        gnupg2 ca-certificates && \\
    apt-get clean && rm -rf /var/lib/apt/lists/*
RUN echo "root:{root_password}" | chpasswd
RUN mkdir -p /var/run/sshd && \\
    sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && \\
    sed -i 's/#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
RUN echo 'Welcome to your LVM Panel VPS ({vps_id})' > /etc/motd
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
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

    image, _ = client.images.build(path=build_dir, tag=f"lvm-panel/{vps_id}", rm=True)
    return image


def create_container(vps_id, ram_gb, cpu_cores, disk_gb, os_image):
    """Builds and starts a systemd-capable container acting as a lightweight VPS."""
    ensure_network()
    root_password = gen_password()

    build_image(vps_id, os_image, root_password)

    container = client.containers.run(
        image=f"lvm-panel/{vps_id}",
        name=f"lvm-{vps_id}",
        detach=True,
        privileged=True,
        tty=True,
        network=NETWORK_NAME,
        mem_limit=f"{ram_gb}g",
        nano_cpus=int(cpu_cores * 1_000_000_000),
        storage_opt=None,
        cgroupns="host",
        cap_add=["SYS_ADMIN"],
        security_opt=["seccomp=unconfined"],
        volumes={"/sys/fs/cgroup": {"bind": "/sys/fs/cgroup", "mode": "rw"}},
    )

    time.sleep(2)
    container.reload()
    private_ip = None
    try:
        private_ip = container.attrs["NetworkSettings"]["Networks"][NETWORK_NAME]["IPAddress"]
    except Exception:
        pass

    return {
        "container_id": container.id,
        "container_name": container.name,
        "private_ip": private_ip,
        "root_password": root_password,
    }


def get_container(container_id):
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
