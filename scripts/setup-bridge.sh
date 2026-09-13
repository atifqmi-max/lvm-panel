#!/usr/bin/env bash
# ==============================================================================
# LVM Panel - LXC Network Bridge Setup Helper
# Configures lxcbr0 and NAT IP forwarding on Ubuntu / Debian
# ==============================================================================

set -e

if [ "$EUID" -ne 0 ]; then
    echo "[Error] Please run as root."
    exit 1
fi

echo "========================================================"
echo "   Configuring LXC Network Bridge (lxcbr0)..."
echo "========================================================"

# Enable IP forwarding
sysctl -w net.ipv4.ip_forward=1
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf

# Configure LXC default network if file exists
if [ -f "/etc/default/lxc-net" ]; then
    sed -i 's/USE_LXC_BRIDGE="false"/USE_LXC_BRIDGE="true"/' /etc/default/lxc-net
    systemctl restart lxc-net || true
fi

# Ensure NAT MASQUERADE is in place
PARENT_IF=$(ip route show default | awk '{print $5}' | head -n1)
PARENT_IF=${PARENT_IF:-eth0}

iptables -t nat -A POSTROUTING -o "$PARENT_IF" -j MASQUERADE || true

echo "========================================================"
echo "   Network bridge setup finished on parent interface $PARENT_IF"
echo "========================================================"
