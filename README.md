# LVM Panel

A self-hosted VPS Management Panel — anyone can install it on their own server and let people register, and manage their own Docker-based VPS instances through a clean web dashboard.

**Made By LashariGamer**

---

## ✨ Features

- **Admin & User roles**
  - Admin can create VPS for any user, choosing RAM, CPU, Disk and how many days it lasts.
  - Admin can add or remove any user, and promote/demote admins.
  - Admin can **edit any VPS** — rename it, resize RAM/CPU live (no reinstall needed), transfer it to a different owner, or extend its expiry.
  - Users can only see and manage their own VPS.
- **VPS Management**
  - Start / Stop / Restart / Reinstall from the dashboard.
  - Instant **tmate** terminal session generation (and regeneration) — works even on hosts with no public IPv4.
  - Every VPS gets its own **private IPv4** internally, plus a **published SSH port** on the host's public IP for direct Termius connections (Host / Port / Username / Password all shown clearly).
  - **Live uptime** shown on the Manage page.
  - **In-browser Console** — a full terminal to your VPS right inside the panel, no SSH client required.
  - **In-browser File Manager** — browse, upload, download, delete files and folders inside your VPS.
- **Redeem Codes**
  - Admin generates a code (or a batch of up to 100 at once) with a fixed RAM/CPU/Disk/duration.
  - Any user pastes the code on the Redeem page and instantly gets their VPS.
  - Admin can copy any single active code, or copy all active codes at once.
- **Nice, themeable, customizable GUI**
  - Each VPS is shown as a card with its name up top, status/specs, and a **Manage VPS** button.
  - Multiple built-in themes (Pro Dark, Midnight Purple, Ocean Blue, Light) switchable per-user from the top bar.
  - Admin can rename the panel and set a **custom background image + card transparency** from Admin → Settings → Appearance.
- **Works on any VPS, with or without public IPv4**
  - If your host has no public IPv4, mark that in Admin → Settings and every VPS page will guide users to connect via tmate instead of Host:Port.
  - Optional custom domain + Nginx reverse proxy setup during install.
  - Built-in Docker storage-driver auto-fix for nested/VPS-in-VPS hosts where overlay2 fails.

---

## 🚀 One-Command Installation

You do **not** need to `git clone` anything yourself — the installer does everything for you.

Run this on a fresh Ubuntu/Debian server as root:

```bash
curl -fsSL https://raw.githubusercontent.com/atifqmi-max/lvm-panel/main/install.sh -o install.sh && sudo bash install.sh
```

During installation you'll be asked:

1. Admin username & password for the panel
2. The port to run the panel on (default `5000`)
3. Whether your server has a public IPv4 address
4. Whether you want to connect a custom domain (sets up Nginx automatically)

When it finishes, you'll see:

```
Thank For Using This Script
```

...and your panel will already be running in the background as a systemd service (`lvm-panel`), auto-starting on every reboot.

---

## 🖥️ Requirements

- Ubuntu 20.04+ / Debian 11+ (root access)
- At least 1 vCPU / 1GB RAM for the panel itself (VPS containers need their own resources on top)
- Open the port you choose (default `5000`) in your firewall, or use a custom domain via Nginx on port 80/443

---

## 🔧 Managing the Panel Service

```bash
systemctl status lvm-panel     # check status
systemctl restart lvm-panel    # restart the panel
systemctl stop lvm-panel       # stop the panel
journalctl -u lvm-panel -f     # view live logs
```

The panel lives at `/opt/lvm-panel`. Its data (users, VPS records, redeem codes) is stored in `/opt/lvm-panel/lvm_panel.db` (SQLite).

---

## 🧭 Using LVM Panel

### As Admin
1. Log in with the admin account you created during install.
2. Go to **Create VPS** → pick the user, RAM, CPU, Disk, OS image and duration → create.
3. Go to **Manage Users** to add/remove users or promote them to admin.
4. Go to **Redeem Codes** to generate codes users can redeem for a pre-set VPS spec.

### As a User
1. Register an account on the panel (or have the admin create one for you).
2. Go to **My VPS** to see your servers as clean status cards.
3. Click **Manage VPS** on any card to Start / Stop / Restart / Reinstall it, generate a tmate session, or grab your private IPv4 + root password to connect through Termius.
4. Go to **Redeem Code** to activate a code an admin gave you.

---

## 🎨 Changing the Theme

Use the theme dropdown in the top-right corner of any page (works for both admin and user accounts). Your choice is saved to your account.

---

## ⚙️ How VPS containers work

Each VPS is a Docker container built from a systemd-capable base image (Ubuntu/Debian/Alpine), with SSH and `tmate` pre-installed, connected to an isolated private Docker network (`10.77.0.0/16`) so every VPS gets its own private IPv4 address. Resource limits (RAM/CPU) are enforced by Docker.

---

## 📜 License

Free to use and modify. Please keep credit to **LashariGamer**.
