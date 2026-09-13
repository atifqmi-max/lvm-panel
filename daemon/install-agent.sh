#!/usr/bin/env bash
# ==============================================================================
# LVM Panel - Remote Node Agent Installer
# ==============================================================================

set -e

# Default variables
PANEL_URL=""
NODE_TOKEN=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --panel-url) PANEL_URL="$2"; shift ;;
        --token) NODE_TOKEN="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$PANEL_URL" ] || [ -z "$NODE_TOKEN" ]; then
    echo "Usage: bash install-agent.sh --panel-url <URL> --token <TOKEN>"
    exit 1
fi

echo "========================================================"
echo "   Installing LVM Node Agent Daemon..."
echo "========================================================"

# Update and install dependencies
if [ -x "$(command -v apt-get)" ]; then
    apt-get update -y
    apt-get install -y curl git lxc lxc-templates bridge-utils iptables
elif [ -x "$(command -v yum)" ]; then
    yum install -y curl git lxc iptables
fi

# Install Node.js if missing
if ! [ -x "$(command -v node)" ]; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs || yum install -y nodejs
fi

# Setup Agent Directory
mkdir -p /opt/lvm-agent
mkdir -p /etc/lvm-agent

# Save Configuration
cat <<EOF > /etc/lvm-agent/config.json
{
  "panel_url": "$PANEL_URL",
  "token": "$NODE_TOKEN"
}
EOF

# Download agent.js
curl -fsSL "${PANEL_URL}/daemon/agent.js" -o /opt/lvm-agent/agent.js || \
curl -fsSL "https://raw.githubusercontent.com/atifqmi-max/lvm-panel/main/daemon/agent.js" -o /opt/lvm-agent/agent.js

# Create Systemd Service
cat <<EOF > /etc/systemd/system/lvm-agent.service
[Unit]
Description=LVM Panel Node Agent Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lvm-agent
ExecStart=/usr/bin/node /opt/lvm-agent/agent.js --panel-url $PANEL_URL --token $NODE_TOKEN
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lvm-agent
systemctl restart lvm-agent

echo "========================================================"
echo "   LVM Node Agent installed and running successfully!"
echo "   Status: systemctl status lvm-agent"
echo "========================================================"
