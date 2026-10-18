# LVM Panel

LVM Panel is a Flask-based control panel for managing Linux VPS instances through LXD. The web application and the LXD runtime are separate components: this installer configures both on a supported host.

## One-command installer

On a **full Ubuntu/Debian VPS or VM with systemd**, run as root:

```bash
curl -fsSL https://raw.githubusercontent.com/atifqmi-max/lvm-panel/main/install.sh | sudo bash
```

The installer downloads the repository into `/opt/lvm-panel` and opens an interactive management menu. Choose **1** to install/initialize LXD and the panel. After installation, the web panel is available at:

`http://YOUR_SERVER_IP:5000`

Open TCP port 5000 in both UFW (menu option 7) and your provider's cloud firewall/security group if applicable.

## Menu options

1. Install / initialize LVM Panel
2. Start service
3. Stop service
4. Restart service
5. Check service, LXD and port status
6. View recent service logs
7. Open the panel firewall port
8. Update application files from the GitHub `main` branch
9. Repair Python dependencies and restart the service
10. Show system information
11. Uninstall panel code/service (confirmation required; leaves LXD installed)
0. Exit

The panel is installed under `/opt/lvm-panel`, runs as a systemd service named `lvm-panel`, and reads configuration from `/etc/lvm-panel.env`. Initial admin credentials are generated on first install and written to `/root/lvm-panel-credentials.txt` with restrictive file permissions. Save them securely.

## Requirements and limitations

- Supported target: full Ubuntu/Debian VM or VPS with systemd as PID 1 and permission to run LXD/Snap.
- Not suitable for GitHub Codespaces, a basic Docker container, or restricted container VPS environments that block snapd, loop devices, or LXD nesting.
- The installer initializes LXD with its automatic default configuration when no usable storage pool/network exists. Review LXD storage and network choices for production use.
- TCP/5000 is plain HTTP by default. Put it behind a properly configured HTTPS reverse proxy before exposing credentials over an untrusted network.
- LXD has powerful host-level access. Only install on servers you administer and keep the host, LXD and panel updated.
- Per-instance disk quota enforcement depends on the LXD storage pool driver; directory-backed pools may not enforce configured sizes.
- This installer manages the existing project's available features; it does not create new backend features that are absent from the application.

## Manual development run

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 nrb.py
```

For the full LXD-backed experience, LXD must already be installed, initialized and accessible to the process.
