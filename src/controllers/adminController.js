const db = require('../database/db');
const driver = require('../services/virtualizationDriver');
const crypto = require('crypto');

class AdminController {
  // --- VPS MANAGEMENT ---
  async createVps(req, res) {
    try {
      const {
        user_id,
        node_id,
        os,
        hostname,
        ram_mb,
        cpu_cores,
        disk_gb,
        duration_days
      } = req.body;

      if (!user_id || !node_id || !os || !hostname) {
        return res.status(400).json({
          success: false,
          message: 'User, Node, OS, and Hostname are required.'
        });
      }

      // Check user exists
      const targetUser = db.findById('users', user_id);
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'Target user not found.' });
      }

      // Check node exists
      const targetNode = db.findById('nodes', node_id);
      if (!targetNode) {
        return res.status(404).json({ success: false, message: 'Target node not found.' });
      }

      // Clean hostname
      const cleanHostname = hostname.toLowerCase().replace(/[^a-z0-9-]/g, '');

      // Check unique hostname
      const existing = db.findOne('vps', v => v.hostname === cleanHostname);
      if (existing) {
        return res.status(400).json({ success: false, message: `Hostname '${cleanHostname}' is already in use.` });
      }

      // Generate random shared SSH port (range 22000 - 32000)
      const allocatedPorts = db.find('vps').map(v => v.ssh_port);
      let sshPort = 22020;
      while (allocatedPorts.includes(sshPort)) {
        sshPort = Math.floor(Math.random() * (32000 - 22000)) + 22000;
      }

      // Calculate expiration date
      const days = parseInt(duration_days || '0', 10);
      let expiresAt = null;
      if (days > 0) {
        const exp = new Date();
        exp.setDate(exp.getDate() + days);
        expiresAt = exp.toISOString();
      }

      // Generate secure initial root password
      const initialPassword = 'lvm_' + crypto.randomBytes(4).toString('hex') + '!';

      const newVps = db.insert('vps', {
        hostname: cleanHostname,
        name: cleanHostname,
        user_id,
        node_id,
        os,
        ram_mb: parseInt(ram_mb || '1024', 10),
        cpu_cores: parseInt(cpu_cores || '1', 10),
        disk_gb: parseInt(disk_gb || '20', 10),
        duration_days: days,
        expires_at: expiresAt,
        status: 'running',
        ssh_port: sshPort,
        root_password: initialPassword,
        dedicated_ip: null,
        dedicated_nic: 'eth0',
        dedicated_cidr: '/32'
      });

      // Invoke container initialization
      await driver.createContainer(newVps);
      await driver.setRootPassword(newVps, initialPassword);

      db.logActivity(req.user.id, 'admin_create_vps', {
        vps_id: newVps.id,
        hostname: newVps.hostname,
        user_id
      }, req.ip);

      return res.status(201).json({
        success: true,
        message: `VPS '${newVps.hostname}' created and deployed successfully.`,
        vps: newVps
      });
    } catch (err) {
      console.error('[Admin Create VPS] Error:', err);
      return res.status(500).json({ success: false, message: 'Failed to create VPS.' });
    }
  }

  async editVps(req, res) {
    try {
      const { id } = req.params;
      const { ram_mb, cpu_cores, disk_gb, hostname } = req.body;

      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      const updateData = {};
      if (ram_mb) updateData.ram_mb = parseInt(ram_mb, 10);
      if (cpu_cores) updateData.cpu_cores = parseInt(cpu_cores, 10);
      if (disk_gb) updateData.disk_gb = parseInt(disk_gb, 10);
      if (hostname) updateData.hostname = hostname.toLowerCase().replace(/[^a-z0-9-]/g, '');

      db.updateById('vps', id, updateData);
      db.logActivity(req.user.id, 'admin_edit_vps', { vps_id: id, updates: updateData }, req.ip);

      return res.json({
        success: true,
        message: 'VPS resources updated successfully.',
        vps: db.findById('vps', id)
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to edit VPS.' });
    }
  }

  async suspendVps(req, res) {
    try {
      const { id } = req.params;
      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      await driver.setPowerState(vps, 'stop');
      db.updateById('vps', id, { status: 'suspended', suspended_reason: 'Manually suspended by Administrator.' });
      db.logActivity(req.user.id, 'admin_suspend_vps', { vps_id: id, hostname: vps.hostname }, req.ip);

      return res.json({
        success: true,
        message: `VPS '${vps.hostname}' suspended.`,
        status: 'suspended'
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to suspend VPS.' });
    }
  }

  async unsuspendVps(req, res) {
    try {
      const { id } = req.params;
      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      db.updateById('vps', id, { status: 'stopped', suspended_reason: null });
      db.logActivity(req.user.id, 'admin_unsuspend_vps', { vps_id: id, hostname: vps.hostname }, req.ip);

      return res.json({
        success: true,
        message: `VPS '${vps.hostname}' unsuspended successfully.`,
        status: 'stopped'
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to unsuspend VPS.' });
    }
  }

  async renewVps(req, res) {
    try {
      const { id } = req.params;
      const { additional_days } = req.body;
      const days = parseInt(additional_days || '30', 10);

      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      let currentExp = vps.expires_at ? new Date(vps.expires_at) : new Date();
      if (currentExp < new Date()) {
        currentExp = new Date();
      }
      currentExp.setDate(currentExp.getDate() + days);

      db.updateById('vps', id, {
        expires_at: currentExp.toISOString(),
        duration_days: (vps.duration_days || 0) + days,
        status: vps.status === 'suspended' ? 'stopped' : vps.status,
        suspended_reason: null
      });

      db.logActivity(req.user.id, 'admin_renew_vps', { vps_id: id, days, new_expiry: currentExp.toISOString() }, req.ip);

      return res.json({
        success: true,
        message: `VPS renewed for +${days} days. New expiry: ${currentExp.toLocaleDateString()}`,
        expires_at: currentExp.toISOString()
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to renew VPS.' });
    }
  }

  async deleteVps(req, res) {
    try {
      const { id } = req.params;
      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      // Stop container and delete
      await driver.setPowerState(vps, 'kill');
      db.deleteById('vps', id);

      db.logActivity(req.user.id, 'admin_delete_vps', { vps_id: id, hostname: vps.hostname }, req.ip);

      return res.json({
        success: true,
        message: `VPS '${vps.hostname}' permanently deleted.`
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to delete VPS.' });
    }
  }

  async setDedicatedIp(req, res) {
    try {
      const { id } = req.params;
      const { dedicated_ip, host_nic = 'eth0', cidr = '/32' } = req.body;

      if (!dedicated_ip) {
        return res.status(400).json({ success: false, message: 'Dedicated Public IP is required.' });
      }

      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      // Apply network configuration via driver
      const result = await driver.applyDedicatedIp(vps, dedicated_ip.trim(), host_nic.trim(), cidr.trim());

      // Update database: Dedicated IP is set, SSH port switches to 22
      db.updateById('vps', id, {
        dedicated_ip: dedicated_ip.trim(),
        dedicated_nic: host_nic.trim(),
        dedicated_cidr: cidr.trim(),
        ssh_port: 22
      });

      db.logActivity(req.user.id, 'admin_set_dedicated_ip', {
        vps_id: id,
        hostname: vps.hostname,
        dedicated_ip: dedicated_ip.trim(),
        host_nic,
        cidr
      }, req.ip);

      return res.json({
        success: true,
        message: `Dedicated IP ${dedicated_ip.trim()} applied successfully. SSH port updated to 22.`,
        dedicated_ip: dedicated_ip.trim(),
        ssh_port: 22
      });
    } catch (err) {
      console.error('[Admin Set Dedicated IP] Error:', err);
      return res.status(500).json({ success: false, message: 'Failed to apply dedicated IP.' });
    }
  }

  // --- USER MANAGEMENT ---
  async listUsers(req, res) {
    try {
      const users = db.find('users');
      const allVps = db.find('vps');

      const safeUsers = users.map(u => {
        const { password_hash, ...rest } = u;
        const userVpsCount = allVps.filter(v => v.user_id === u.id).length;
        return {
          ...rest,
          vps_count: userVpsCount
        };
      });

      return res.json({ success: true, users: safeUsers });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to list users.' });
    }
  }

  async updateUserRole(req, res) {
    try {
      const { id } = req.params;
      const { role, status } = req.body;

      const user = db.findById('users', id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      // Prevent demoting last admin
      if (user.role === 'admin' && role === 'user') {
        const admins = db.find('users', u => u.role === 'admin');
        if (admins.length <= 1) {
          return res.status(400).json({ success: false, message: 'Cannot demote the only administrator.' });
        }
      }

      const updateData = {};
      if (role && ['admin', 'user'].includes(role)) updateData.role = role;
      if (status && ['active', 'suspended'].includes(status)) updateData.status = status;

      db.updateById('users', id, updateData);
      db.logActivity(req.user.id, 'admin_update_user', { target_user_id: id, updates: updateData }, req.ip);

      return res.json({
        success: true,
        message: `User '${user.username}' updated successfully.`
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to update user.' });
    }
  }

  async deleteUser(req, res) {
    try {
      const { id } = req.params;

      if (id === req.user.id) {
        return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
      }

      const user = db.findById('users', id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      // Delete user's VPS
      const userVps = db.find('vps', v => v.user_id === id);
      for (const vps of userVps) {
        await driver.setPowerState(vps, 'kill');
        db.deleteById('vps', vps.id);
      }

      db.deleteById('users', id);
      db.logActivity(req.user.id, 'admin_delete_user', { deleted_username: user.username }, req.ip);

      return res.json({
        success: true,
        message: `User '${user.username}' and their associated VPS have been deleted.`
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to delete user.' });
    }
  }

  // --- NODE MANAGEMENT ---
  async listNodes(req, res) {
    try {
      const nodes = db.find('nodes');
      const allVps = db.find('vps');

      const enrichedNodes = nodes.map(node => {
        const nodeVps = allVps.filter(v => v.node_id === node.id);
        const usedRam = nodeVps.reduce((acc, curr) => acc + (curr.ram_mb || 0), 0);
        const usedCores = nodeVps.reduce((acc, curr) => acc + (curr.cpu_cores || 0), 0);
        const usedDisk = nodeVps.reduce((acc, curr) => acc + (curr.disk_gb || 0), 0);

        return {
          ...node,
          vps_count: nodeVps.length,
          used_ram_mb: usedRam,
          used_cpu_cores: usedCores,
          used_disk_gb: usedDisk
        };
      });

      return res.json({ success: true, nodes: enrichedNodes });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to list nodes.' });
    }
  }

  async createNode(req, res) {
    try {
      const { name, location, fqdn_or_ip, ram_total, cpu_cores, disk_total } = req.body;

      if (!name || !location || !fqdn_or_ip) {
        return res.status(400).json({ success: false, message: 'Name, location, and IP/Hostname are required.' });
      }

      const nodeToken = 'lvm_node_' + crypto.randomBytes(16).toString('hex');

      const newNode = db.insert('nodes', {
        name: name.trim(),
        location: location.trim(),
        fqdn_or_ip: fqdn_or_ip.trim(),
        port: 6000,
        token: nodeToken,
        status: 'online', // ready for heartbeat
        ram_total: parseInt(ram_total || '16384', 10),
        cpu_cores: parseInt(cpu_cores || '8', 10),
        disk_total: parseInt(disk_total || '500', 10),
        is_local: false,
        last_ping: new Date().toISOString()
      });

      db.logActivity(req.user.id, 'admin_create_node', { node_id: newNode.id, name: newNode.name }, req.ip);

      return res.status(201).json({
        success: true,
        message: `Node '${newNode.name}' created successfully.`,
        node: newNode,
        setup_command: `curl -sSL https://raw.githubusercontent.com/atifqmi-max/lvm-panel/main/daemon/install-agent.sh | bash -s -- --panel-url http://${req.headers.host || 'YOUR_PANEL_IP:6000'} --token ${nodeToken}`
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to create node.' });
    }
  }

  async deleteNode(req, res) {
    try {
      const { id } = req.params;
      const node = db.findById('nodes', id);

      if (!node) {
        return res.status(404).json({ success: false, message: 'Node not found.' });
      }

      if (node.is_local) {
        return res.status(400).json({ success: false, message: 'The primary Local Node cannot be deleted.' });
      }

      const assignedVps = db.find('vps', v => v.node_id === id);
      if (assignedVps.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete node: ${assignedVps.length} VPS are currently hosted on this node. Migrate or delete them first.`
        });
      }

      db.deleteById('nodes', id);
      db.logActivity(req.user.id, 'admin_delete_node', { node_id: id, name: node.name }, req.ip);

      return res.json({ success: true, message: `Node '${node.name}' deleted successfully.` });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to delete node.' });
    }
  }

  // --- SETTINGS MANAGEMENT ---
  async getSettings(req, res) {
    try {
      const settings = db.getSettings();
      return res.json({ success: true, settings });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch settings.' });
    }
  }

  async updateSettings(req, res) {
    try {
      const { panel_name, theme, allow_registration, accent_color } = req.body;
      const current = db.getSettings();

      const updated = db.updateSettings({
        panel_name: panel_name ? panel_name.trim() : current.panel_name,
        theme: theme || current.theme,
        allow_registration: allow_registration !== undefined ? Boolean(allow_registration) : current.allow_registration,
        accent_color: accent_color || current.accent_color
      });

      db.logActivity(req.user.id, 'admin_update_settings', updated, req.ip);

      return res.json({
        success: true,
        message: 'Settings updated successfully.',
        settings: updated
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to update settings.' });
    }
  }

  // --- OVERVIEW STATS ---
  async getOverviewStats(req, res) {
    try {
      const allUsers = db.find('users');
      const allVps = db.find('vps');
      const allNodes = db.find('nodes');

      const totalRamAllocated = allVps.reduce((sum, v) => sum + (v.ram_mb || 0), 0);
      const totalDiskAllocated = allVps.reduce((sum, v) => sum + (v.disk_gb || 0), 0);
      const totalCoresAllocated = allVps.reduce((sum, v) => sum + (v.cpu_cores || 0), 0);

      const runningVps = allVps.filter(v => v.status === 'running').length;
      const suspendedVps = allVps.filter(v => v.status === 'suspended').length;
      const stoppedVps = allVps.filter(v => v.status === 'stopped').length;

      return res.json({
        success: true,
        stats: {
          total_users: allUsers.length,
          total_vps: allVps.length,
          running_vps: runningVps,
          suspended_vps: suspendedVps,
          stopped_vps: stoppedVps,
          total_nodes: allNodes.length,
          allocated_ram_mb: totalRamAllocated,
          allocated_disk_gb: totalDiskAllocated,
          allocated_cpu_cores: totalCoresAllocated
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to get overview stats.' });
    }
  }
}

module.exports = new AdminController();
