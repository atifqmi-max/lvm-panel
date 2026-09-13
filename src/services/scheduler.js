const db = require('../database/db');
const driver = require('./virtualizationDriver');

class SchedulerService {
  constructor() {
    this.intervalId = null;
  }

  start(intervalMs = 60000) {
    console.log('[Scheduler] VPS duration & expiration monitor started.');
    this.checkExpirations();
    this.intervalId = setInterval(() => {
      this.checkExpirations();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkExpirations() {
    try {
      const now = new Date();
      const allVps = db.find('vps');

      for (const vps of allVps) {
        // duration_days === 0 means permanent / no suspension
        if (vps.duration_days && vps.duration_days > 0 && vps.expires_at) {
          const expiryDate = new Date(vps.expires_at);

          if (now >= expiryDate && vps.status !== 'suspended') {
            console.log(`[Scheduler] VPS ${vps.hostname} (ID: ${vps.id}) has expired. Suspending...`);
            
            // Stop container power
            await driver.setPowerState(vps, 'stop');

            // Update database status
            db.updateById('vps', vps.id, {
              status: 'suspended',
              suspended_reason: 'Plan expired. Please renew duration.'
            });

            // Log activity
            db.logActivity(vps.user_id, 'vps_auto_suspended', {
              vps_id: vps.id,
              hostname: vps.hostname,
              expires_at: vps.expires_at
            });
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error checking VPS expirations:', err.message);
    }
  }
}

const scheduler = new SchedulerService();
module.exports = scheduler;
