# LVM Panel

<p align="center">
  <img src="https://raw.githubusercontent.com/atifqmi-max/lvm-panel/main/public/css/style.css" alt="LVM Panel Logo" width="0" height="0">
  <h1 align="center">⚡ LVM Panel ⚡</h1>
  <p align="center"><strong>Next-Gen Linux Virtual Machine & Container Cloud Management Panel</strong></p>
  <p align="center">
    <a href="https://github.com/atifqmi-max/lvm-panel"><img src="https://img.shields.io/badge/version-1.0.0-blue.svg?style=for-the-badge" alt="Version"></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node.js-20_LTS-green.svg?style=for-the-badge" alt="Node.js"></a>
    <a href="https://github.com/atifqmi-max/lvm-panel/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-purple.svg?style=for-the-badge" alt="License"></a>
    <a href="http://localhost:6000"><img src="https://img.shields.io/badge/port-6000-cyan.svg?style=for-the-badge" alt="Default Port"></a>
  </p>
</p>

---

## 📖 Overview

**LVM Panel** is a modern, lightweight, high-performance web panel designed to manage Linux Virtual Machines and LXC containers with zero complexity. It features a futuristic cyber-glassmorphism interface, persistent session authentication, real-time in-browser web terminal, web-based file manager, multi-node clustering, and dedicated IP routing.

---

## 🚀 One-Line Automated Installation

To install LVM Panel on any fresh **Ubuntu 20.04 / 22.04 / 24.04** or **Debian 11 / 12** server, run this single command as root:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/atifqmi-max/lvm-panel/main/install.sh)
```

### 🛠️ Interactive Installation Steps:
1. The installer will prompt you to enter your **Admin Email** and **Admin Password**.
2. It automatically updates system packages and installs Node.js 20 LTS, Git, LXC tools, and network utilities.
3. It seeds your administrator account, initializes the local node, and starts the panel as a systemd background service on port **6000**.
4. Once completed, the terminal will print your access details:

```text
======================================================================
                  LVM Panel Installed Successfully!                   
======================================================================

  Panel URL:        http://<YOUR_VPS_IP>:6000
  Admin Email:      admin@yourdomain.com
  Admin Password:   ••••••••••••
  Panel Port:       6000
  Service Status:   systemctl status lvm-panel

======================================================================
```

> **Note:** If you cannot access the panel URL, ensure port `6000` is opened in your cloud provider's firewall or security group (AWS Security Groups, DigitalOcean Cloud Firewall, Hetzner, Contabo, etc.).

---

## ✨ Key Features

### 1. 🎨 Cyber Glassmorphism UI & Persistent Authentication
- **Sleek & Animated**: Tasteful modern gradient ambient lighting, glowing cyber borders, and smooth UI transitions.
- **Persistent Sessions**: State-of-the-art token authentication ensures you are **never logged out** when reloading or refreshing the browser.
- **Theme Engine**: Switch between *Cyber Dark*, *Neon Violet*, *Emerald Matrix*, and *Ocean Blue* directly from settings.

### 2. 🖥️ VPS Server Manager
- **Instant Power Controls**: Start, Stop, Restart, and Force Kill with live visual feedback.
- **SSH Credentials Card**: Clean display of Node IP, SSH Port, Root username, and password toggle reveal. Includes a **1-click Copy for Termius & PuTTY**.
- **Interactive Web Console**: High-speed embedded `xterm.js` terminal. Auto-fills VPS connection info and connects via secure WebSockets with a single click.
- **Integrated File Manager**: Browse container directory trees (`/root`, `/etc`, etc.), view file details, create new files, and edit configuration files in a built-in code editor.
- **Root Password Reset**: Users and administrators can change or reset the container root password directly from the web interface.

### 3. 🌐 Dedicated Public IP Routing (Admin Exclusive)
- Non-dedicated containers are assigned a NAT port (e.g., `22020`).
- The Dedicated IP card indicates `Not Set` for regular users.
- Administrators get an exclusive **"Set Public IP"** action modal:
  - **Dedicated IP**: e.g., `198.51.100.45`
  - **Host Parent Interface**: `eth0`
  - **Subnet CIDR**: `/32 for routed NICs`
- When applied, the panel configures host routing and iptables, transitioning the container to dedicated status and updating its SSH port to standard **22**.

### 4. 🛡️ Global Administrator Panel
- **Role-Based Access Control**: The Admin Panel sidebar button is strictly visible only to accounts with administrator privileges.
- **All VPS Management**: View all containers hosted across all users and nodes.
  - **Deploy VPS Modal**: Select User, Select Cluster Node, Choose OS (Ubuntu 24.04/22.04, Debian 12/11, Alpine, AlmaLinux), Hostname, RAM (MB), vCPUs, Disk (GB), and Duration Days.
  - **Duration & Auto-Suspension**: Setting Duration Days (e.g. `30`) triggers automated background suspension upon expiration. `0` = Permanent / No Suspension.
  - **Renew & Unsuspend**: Easily extend VPS duration days and restore suspended containers.
  - **Resource Editing & Deletion**: Scale CPU/RAM/Disk limits on the fly or wipe containers.
- **User Management**: View all registered users, promote users to Admin or revoke Admin roles, and remove accounts.
- **Multi-Node Clustering**:
  - Automatically comes with a pre-configured **Local Node**.
  - Add secondary remote nodes with custom geographic locations (Frankfurt, US-East, Singapore, etc.) and capacity metrics.
  - Generates a **1-click node connect script** for remote hosts running the `lvm-agent` daemon.
- **Branding & Settings**: Customize the panel name, toggle public user registrations, and switch themes.

---

## 🏗️ Multi-Node Architecture

```text
                            +--------------------------+
                            |     Browser Client       |
                            | (Tailwind, xterm, Chart) |
                            +------------+-------------+
                                         |
                                         | Port 6000 (HTTP / WS)
                                         v
                         +-------------------------------+
                         |      LVM Panel Master         |
                         |   (Node.js / Express / DB)    |
                         +---------------+---------------+
                                         |
                 +-----------------------+-----------------------+
                 |                                               |
                 v                                               v
    +-------------------------+                     +-------------------------+
    |  Primary Local Node     |                     |  Remote Cluster Node    |
    | (LXC Containers Engine) |                     |   (lvm-agent daemon)    |
    +-------------------------+                     +-------------------------+
```

---

## 🌐 Connecting a Remote Node

1. Open the Admin Panel and navigate to the **Node Cluster System** tab.
2. Click **Add New Node**, enter the node name, location, and hardware capacity.
3. Click **Create Node & Generate Connect Script**.
4. Run the provided command on your remote Linux server:

```bash
curl -sSL https://raw.githubusercontent.com/atifqmi-max/lvm-panel/main/daemon/install-agent.sh | bash -s -- --panel-url http://YOUR_PANEL_IP:6000 --token YOUR_NODE_TOKEN
```

The node will connect, send heartbeats, and display **ONLINE** in your cluster overview!

---

## 🔧 Service Management

| Task | Command |
| :--- | :--- |
| **Check Panel Status** | `systemctl status lvm-panel` |
| **Restart Panel** | `systemctl restart lvm-panel` |
| **Stop Panel** | `systemctl stop lvm-panel` |
| **View Live Logs** | `journalctl -u lvm-panel -f` |
| **Check Node Agent (on remote host)** | `systemctl status lvm-agent` |

---

## 💻 Manual Installation (Developers)

If you wish to run the panel manually or develop locally:

```bash
# Clone the repository
git clone https://github.com/atifqmi-max/lvm-panel.git
cd lvm-panel

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Initialize database with admin account
node src/database/seed.js admin@domain.com MySecretPassword admin

# Start the panel
npm start
```

Visit `http://localhost:6000` in your web browser.

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](file:///C:/Users/Atif%20Lashari/.gemini/antigravity/scratch/lvm-panel/LICENSE) file for details.

Developed with ❤️ for the Linux Cloud & Hosting Community.
