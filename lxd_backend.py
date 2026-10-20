#!/usr/bin/env python3
"""LXD runtime adapter for LVM Panel VPS instances."""
import asyncio
import json
import os
import re
import shlex
import socket
import subprocess
from pathlib import Path


class LXDRuntime:
    @staticmethod
    def _run_sync(args, timeout=120, check=True):
        proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
        if check and proc.returncode:
            message = proc.stderr.strip() or proc.stdout.strip() or f"LXD command failed ({proc.returncode})"
            raise RuntimeError(message)
        return proc.stdout.strip()

    @staticmethod
    def _image(value):
        image = (value or "ubuntu:22.04").strip()
        mapping = {
            "images:debian/10": "images:debian/10",
            "images:debian/11": "images:debian/11",
            "images:debian/12": "images:debian/12",
            "images:debian/13": "images:debian/13",
            "ubuntu:20.04": "ubuntu:20.04",
            "ubuntu:22.04": "ubuntu:22.04",
            "ubuntu:24.04": "ubuntu:24.04",
        }
        return mapping.get(image, image)

    @classmethod
    def _exists(cls, name):
        if not name:
            return False
        proc = subprocess.run(["lxc", "info", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return proc.returncode == 0

    @classmethod
    def _container_ip(cls, name):
        raw = cls._run_sync(["lxc", "list", name, "--format", "json"])
        rows = json.loads(raw or "[]")
        if not rows:
            raise RuntimeError(f"LXD instance {name} has no network data")
        networks = rows[0].get("state", {}).get("network", {})
        for interface in networks.values():
            for address in interface.get("addresses", []):
                if address.get("family") == "inet" and not address.get("address", "").startswith("127."):
                    return address["address"]
        raise RuntimeError(f"No IPv4 address is available for LXD instance {name}")

    @classmethod
    def _allocate_port(cls):
        for port in range(22000, 23000):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                try:
                    sock.bind(("0.0.0.0", port))
                except OSError:
                    continue
            return port
        raise RuntimeError("No free host port available in 22000-22999")

    @classmethod
    def create(cls, name, image, ram_mb=None, cpu=None, disk_gb=None):
        if cls._exists(name):
            raise RuntimeError(f"LXD instance {name} already exists")
        cls._run_sync(["lxc", "init", cls._image(image), name], timeout=600)
        try:
            # Privileged containers weaken isolation and are opt-in for compatibility cases.
            if os.getenv('LVM_ALLOW_PRIVILEGED_CONTAINERS', 'false').lower() == 'true':
                cls._run_sync(["lxc", "config", "set", name, "security.privileged", "true"])
            cls._run_sync(["lxc", "config", "set", name, "security.nesting", "true"])
            if os.path.exists("/dev/net/tun"):
                try:
                    cls._run_sync(["lxc", "config", "device", "add", name, "tun", "unix-char", "source=/dev/net/tun", "path=/dev/net/tun"])
                except RuntimeError:
                    pass
            if ram_mb:
                cls._run_sync(["lxc", "config", "set", name, "limits.memory", f"{int(ram_mb)}MB"])
            if cpu:
                cls._run_sync(["lxc", "config", "set", name, "limits.cpu", str(cpu)])
            if disk_gb:
                # Dir-backed pools do not support enforced quotas; do not abort VPS creation.
                try:
                    cls._run_sync(["lxc", "config", "device", "set", name, "root", "size", f"{int(disk_gb)}GB"])
                except RuntimeError:
                    pass
        except Exception:
            cls._run_sync(["lxc", "delete", name, "--force"], check=False)
            raise
        return cls._allocate_port()

    @classmethod
    async def update(cls, name, privileged=False, ram_mb=None, cpu=None):
        def work():
            if privileged and os.getenv('LVM_ALLOW_PRIVILEGED_CONTAINERS', 'false').lower() == 'true':
                cls._run_sync(["lxc", "config", "set", name, "security.privileged", "true"])
                cls._run_sync(["lxc", "config", "set", name, "security.nesting", "true"])
            if ram_mb:
                cls._run_sync(["lxc", "config", "set", name, "limits.memory", f"{int(ram_mb)}MB"])
            if cpu:
                cls._run_sync(["lxc", "config", "set", name, "limits.cpu", str(cpu)])
        await asyncio.to_thread(work)

    @classmethod
    def _proxy_add(cls, name, command):
        host = re.search(r"listen=(tcp|udp):0\.0\.0\.0:(\d+)", command)
        target = re.search(r"connect=(?:tcp|udp):127\.0\.0\.1:(\d+)", command)
        if not host or not target:
            return True
        proto, host_port = host.group(1), int(host.group(2))
        vps_port = int(target.group(1))
        ip = cls._container_ip(name)
        pidfile = Path("/run") / f"lvm-socat-{name}-{proto}-{host_port}.pid"
        if pidfile.exists():
            try:
                os.kill(int(pidfile.read_text().strip()), 15)
            except Exception:
                pass
            pidfile.unlink(missing_ok=True)
        listener = f"{proto.upper()}-LISTEN:{host_port},reuseaddr,fork"
        destination = f"{proto.upper()}:{ip}:{vps_port}"
        proc = subprocess.Popen(["socat", listener, destination], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pidfile.write_text(str(proc.pid))
        return True

    @classmethod
    def _proxy_remove(cls, name, command):
        match = re.search(r"(tcp|udp)_proxy_(\d+)", command)
        if not match:
            return True
        proto, port = match.group(1), match.group(2)
        pidfile = Path("/run") / f"lvm-socat-{name}-{proto}-{port}.pid"
        if pidfile.exists():
            try:
                os.kill(int(pidfile.read_text().strip()), 15)
            except Exception:
                pass
            pidfile.unlink(missing_ok=True)
        return True

    @classmethod
    def run(cls, name, command, timeout=120):
        async def run_async():
            def work():
                cmd = (command or "").strip()
                if cmd.startswith("init "):
                    args = shlex.split(cmd)
                    image = args[1] if len(args) > 1 else "ubuntu:22.04"
                    instance = args[2] if len(args) > 2 else name
                    ram = cpu = disk = None
                    i = 3
                    while i < len(args):
                        if args[i] in ("-m", "--memory") and i + 1 < len(args):
                            raw = re.sub(r"[^0-9.]", "", args[i + 1])
                            ram = int(float(raw) * (1024 if args[i + 1].lower().endswith(("gb", "g")) else 1))
                            i += 2
                        elif args[i] in ("-c", "--cpus") and i + 1 < len(args):
                            cpu = float(args[i + 1]); i += 2
                        elif args[i] in ("-d", "--disk") and i + 1 < len(args):
                            raw = re.sub(r"[^0-9.]", "", args[i + 1]); disk = int(float(raw)); i += 2
                        else:
                            i += 1
                    return str(cls.create(instance, image, ram_mb=ram, cpu=cpu, disk_gb=disk))
                lifecycle = {
                    "start ": ["lxc", "start", name],
                    "stop ": ["lxc", "stop", name, "--force"],
                    "restart ": ["lxc", "restart", name],
                    "freeze ": ["lxc", "freeze", name],
                    "unfreeze ": ["lxc", "unfreeze", name],
                    "delete ": ["lxc", "delete", name, "--force"],
                }
                for prefix, argv in lifecycle.items():
                    if cmd.startswith(prefix):
                        cls._run_sync(argv, timeout=timeout)
                        return True
                if cmd.startswith("info "):
                    instance = shlex.split(cmd)[1] if len(shlex.split(cmd)) > 1 else name
                    raw = cls._run_sync(["lxc", "list", instance, "--format", "json"])
                    rows = json.loads(raw or "[]")
                    if not rows:
                        raise RuntimeError(f"LXD instance {instance} not found")
                    state = rows[0].get("status", "Unknown")
                    try:
                        ip = cls._container_ip(instance)
                    except Exception:
                        ip = "N/A"
                    return f"Status: {state}\nIP: {ip}\n"
                if cmd.startswith("config set "):
                    parts = shlex.split(cmd)
                    if len(parts) >= 5:
                        key, value = parts[3], parts[4]
                        cls._run_sync(["lxc", "config", "set", name, key, value])
                    return True
                if cmd.startswith("config device set "):
                    parts = shlex.split(cmd)
                    # Existing callers pass: config device set NAME root size=NNGB
                    if len(parts) >= 6:
                        device = parts[4]
                        key_value = parts[5].split("=", 1)
                        setting, value = key_value if len(key_value) == 2 else ("", "")
                        if setting:
                            try:
                                cls._run_sync(["lxc", "config", "device", "set", name, device, setting, value])
                            except RuntimeError:
                                # Storage pools using the dir driver cannot enforce root disk quotas.
                                pass
                    return True
                if cmd.startswith("config device override "):
                    parts = shlex.split(cmd)
                    if len(parts) >= 7:
                        instance, device = parts[3], parts[4]
                        key, value = parts[5], parts[6]
                        cls._run_sync(["lxc", "config", "device", "override", instance, device, key, value])
                    return True
                if cmd.startswith("config device add "):
                    return cls._proxy_add(name, cmd)
                if cmd.startswith("config device remove "):
                    return cls._proxy_remove(name, cmd)
                if cmd.startswith("exec "):
                    rest = cmd[len("exec "):]
                    if rest.startswith("-- "):
                        return cls._run_sync(["/bin/sh", "-lc", rest[3:]], timeout=timeout)
                    if " -- " in rest:
                        left, payload = rest.split(" -- ", 1)
                        parts = shlex.split(left)
                        instance = parts[0] if parts and parts[0] != "--" else name
                        if not instance:
                            return cls._run_sync(["/bin/sh", "-lc", payload.lstrip()], timeout=timeout)
                        payload = payload.lstrip()
                        if len(payload) >= 2 and payload[0] in ("'", '"') and payload[-1] == payload[0]:
                            decoded = shlex.split(payload)
                            if len(decoded) == 1:
                                payload = decoded[0]
                        return cls._run_sync(["lxc", "exec", instance, "--", "/bin/sh", "-lc", payload], timeout=timeout)
                    parts = shlex.split(rest)
                    if len(parts) >= 2:
                        instance, payload = parts[0], " ".join(parts[1:])
                    else:
                        instance, payload = name, rest
                    return cls._run_sync(["lxc", "exec", instance, "--", "/bin/sh", "-lc", payload], timeout=timeout)
                if cmd == "storage list":
                    return cls._run_sync(["lxc", "storage", "list"], timeout=timeout)
                if cmd == "network list":
                    return cls._run_sync(["lxc", "network", "list"], timeout=timeout)
                if cmd.startswith("config "):
                    return True
                raise RuntimeError(f"Unsupported LXD operation: {cmd.split()[0] if cmd else '(empty)'}")
            return await asyncio.to_thread(work)
        return run_async()

    @classmethod
    def translate_command(cls, name, command):
        """Return shell-safe LXD command for legacy node integration clients."""
        cmd = command.strip()
        if cmd.startswith("init "):
            parts = shlex.split(cmd)
            image = parts[1] if len(parts) > 1 else "ubuntu:22.04"
            instance = parts[2] if len(parts) > 2 else name
            return "init " + shlex.quote(image) + " " + shlex.quote(instance)
        if cmd.startswith("start "): return f"start {shlex.quote(name)}"
        if cmd.startswith("stop "): return f"stop {shlex.quote(name)} --force"
        if cmd.startswith("restart "): return f"restart {shlex.quote(name)}"
        if cmd.startswith("freeze "): return f"freeze {shlex.quote(name)}"
        if cmd.startswith("unfreeze "): return f"unfreeze {shlex.quote(name)}"
        if cmd.startswith("delete "): return f"delete {shlex.quote(name)} --force"
        if cmd.startswith("exec "):
            rest = cmd[len("exec "):]
            if " -- " in rest:
                left, payload = rest.split(" -- ", 1)
                parts = shlex.split(left)
                instance = parts[0] if parts and parts[0] != "--" else name
                return f"exec {shlex.quote(instance)} -- /bin/sh -lc {shlex.quote(payload.lstrip())}"
        return cmd
