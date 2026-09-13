const db = require('../database/db');
const driver = require('../services/virtualizationDriver');

class VpsController {
  async listVps(req, res) {
    try {
      const user = req.user;
      let vpsList;

      if (user.role === 'admin' && req.query.all === 'true') {
        vpsList = db.find('vps');
      } else {
        vpsList = db.find('vps', v => v.user_id === user.id);
      }

      const hostIp = req.headers.host ? req.headers.host.split(':')[0] : '127.0.0.1';

      // Enrich with node details and user details if admin
      const enriched = vpsList.map(vps => {
        const node = db.findById('nodes', vps.node_id);
        const owner = db.findById('users', vps.user_id);
        const resolvedNodeIp = (node && node.fqdn_or_ip && node.fqdn_or_ip !== '127.0.0.1') ? node.fqdn_or_ip : hostIp;
        const connectionIp = vps.dedicated_ip || resolvedNodeIp;
        const connectionPort = vps.dedicated_ip ? 22 : vps.ssh_port;

        return {
          ...vps,
          node_name: node ? node.name : 'Primary Node',
          node_ip: resolvedNodeIp,
          node_location: node ? node.location : 'Global',
          owner_name: owner ? owner.username : 'Unknown',
          owner_email: owner ? owner.email : 'Unknown',
          connection_ip: connectionIp,
          connection_port: connectionPort
        };
      });

      return res.json({
        success: true,
        data: enriched
      });
    } catch (err) {
      console.error('[VPS List] Error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve VPS list.' });
    }
  }

  async getVps(req, res) {
    try {
      const { id } = req.params;
      const vps = db.findById('vps', id);

      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      // Check access permission
      if (req.user.role !== 'admin' && vps.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }

      const hostIp = req.headers.host ? req.headers.host.split(':')[0] : '127.0.0.1';
      const node = db.findById('nodes', vps.node_id);
      const owner = db.findById('users', vps.user_id);
      const resolvedNodeIp = (node && node.fqdn_or_ip && node.fqdn_or_ip !== '127.0.0.1') ? node.fqdn_or_ip : hostIp;
      const connectionIp = vps.dedicated_ip || resolvedNodeIp;
      const connectionPort = vps.dedicated_ip ? 22 : vps.ssh_port;

      return res.json({
        success: true,
        data: {
          ...vps,
          node_name: node ? node.name : 'Primary Node',
          node_ip: resolvedNodeIp,
          node_location: node ? node.location : 'Global',
          owner_name: owner ? owner.username : 'Unknown',
          owner_email: owner ? owner.email : 'Unknown',
          connection_ip: connectionIp,
          connection_port: connectionPort
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to retrieve VPS details.' });
    }
  }

  async powerAction(req, res) {
    try {
      const { id } = req.params;
      const { action } = req.body; // 'start', 'stop', 'restart', 'kill'

      const validActions = ['start', 'stop', 'restart', 'kill'];
      if (!validActions.includes(action)) {
        return res.status(400).json({ success: false, message: `Invalid action '${action}'. Must be start, stop, restart, or kill.` });
      }

      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      if (req.user.role !== 'admin' && vps.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }

      if (vps.status === 'suspended') {
        return res.status(400).json({
          success: false,
          message: 'This VPS is suspended. Power actions are disabled until renewed or unsuspended.'
        });
      }

      await driver.setPowerState(vps, action);

      let newStatus = vps.status;
      if (action === 'start') newStatus = 'running';
      if (action === 'stop' || action === 'kill') newStatus = 'stopped';
      if (action === 'restart') newStatus = 'running';

      db.updateById('vps', vps.id, { status: newStatus });
      db.logActivity(req.user.id, `vps_power_${action}`, { vps_id: vps.id, hostname: vps.hostname }, req.ip);

      return res.json({
        success: true,
        message: `Power command '${action.toUpperCase()}' dispatched successfully.`,
        status: newStatus
      });
    } catch (err) {
      console.error('[VPS Power] Error:', err);
      return res.status(500).json({ success: false, message: 'Failed to execute power action.' });
    }
  }

  async changePassword(req, res) {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
      }

      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      if (req.user.role !== 'admin' && vps.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }

      // Update root password on the container/virtualization driver
      await driver.setRootPassword(vps, newPassword);

      // Store in DB
      db.updateById('vps', vps.id, { root_password: newPassword });
      db.logActivity(req.user.id, 'vps_password_change', { vps_id: vps.id, hostname: vps.hostname }, req.ip);

      return res.json({
        success: true,
        message: 'VPS root password has been successfully updated.'
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to update VPS root password.' });
    }
  }

  async getStats(req, res) {
    try {
      const { id } = req.params;
      const vps = db.findById('vps', id);

      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      if (req.user.role !== 'admin' && vps.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }

      const stats = await driver.getStats(vps);
      return res.json({
        success: true,
        stats
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to retrieve stats.' });
    }
  }

  async listFiles(req, res) {
    try {
      const { id } = req.params;
      const subPath = req.query.path || '/root';

      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      if (req.user.role !== 'admin' && vps.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }

      const files = await driver.listFiles(vps, subPath);
      return res.json({
        success: true,
        currentPath: subPath,
        files
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to list directory.' });
    }
  }

  async readFile(req, res) {
    try {
      const { id } = req.params;
      const filePath = req.query.path;

      if (!filePath) {
        return res.status(400).json({ success: false, message: 'File path required.' });
      }

      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      if (req.user.role !== 'admin' && vps.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }

      const content = await driver.readFile(vps, filePath);
      return res.json({
        success: true,
        path: filePath,
        content
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to read file.' });
    }
  }

  async writeFile(req, res) {
    try {
      const { id } = req.params;
      const { path: filePath, content } = req.body;

      if (!filePath) {
        return res.status(400).json({ success: false, message: 'File path required.' });
      }

      const vps = db.findById('vps', id);
      if (!vps) {
        return res.status(404).json({ success: false, message: 'VPS not found.' });
      }

      if (req.user.role !== 'admin' && vps.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }

      await driver.writeFile(vps, filePath, content || '');
      return res.json({
        success: true,
        message: 'File saved successfully.'
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to write file.' });
    }
  }
}

module.exports = new VpsController();
