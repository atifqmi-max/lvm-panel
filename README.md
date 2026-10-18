# LVM Panel

LVM Panel creates and manages Linux VPS containers using **LXD**. It does not use Docker.

## Install (systemd-enabled Ubuntu/Debian VM or VPS)

```bash
unzip -o lvm-panel.zip -d ~
cd ~/NRB
sudo bash install.sh
bash start.sh
```

The host must boot with systemd as PID 1. Do not run this installer inside a basic Docker/container shell without systemd: snapd cannot start there, so LXD cannot be installed through Snap. If the VM itself is nested inside a container, the provider must allow nested LXD and expose the required kernel features. The installer checks for systemd and the Snap daemon before attempting LXD installation. It initializes a default LXD storage/network profile when needed and installs the panel's Python dependencies. The panel listens on port 5000; allow TCP/5000 in your firewall/security group and visit `http://YOUR_SERVER_IP:5000`.

VPS lifecycle actions, shell execution, limits and proxy-based port forwarding are routed through LXD. Root-disk quota enforcement depends on the LXD storage pool driver; `dir` pools may not enforce configured per-instance disk sizes. Existing Docker-created containers are not automatically converted to LXD instances.
