const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// CLI or Environment configuration
const args = process.argv.slice(2);
let panelUrl = process.env.PANEL_URL || 'http://127.0.0.1:3000';
let token = process.env.NODE_TOKEN || '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--panel-url' && args[i + 1]) panelUrl = args[i + 1];
  if (args[i] === '--token' && args[i + 1]) token = args[i + 1];
}

// Config file fallback
const configPath = '/etc/lvm-agent/config.json';
if (fs.existsSync(configPath)) {
  try {
    const fileConf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    panelUrl = fileConf.panel_url || panelUrl;
    token = fileConf.token || token;
  } catch (e) {}
}

console.log('====================================================');
console.log('   LVM Node Agent Daemon - Starting...');
console.log(`   Panel URL: ${panelUrl}`);
console.log(`   Node Token: ${token ? token.substring(0, 8) + '...' : 'NONE'}`);
console.log('====================================================');

function getHostStats() {
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  const freeMem = Math.round(os.freemem() / 1024 / 1024);
  const cpus = os.cpus().length;

  return {
    ram_total_mb: totalMem,
    ram_free_mb: freeMem,
    cpu_cores: cpus,
    load_avg: os.loadavg(),
    uptime: os.uptime()
  };
}

function sendHeartbeat() {
  if (!token) {
    console.warn('[Agent] Missing node token. Heartbeat paused.');
    return;
  }

  const payload = JSON.stringify({
    token: token,
    stats: getHostStats(),
    timestamp: new Date().toISOString()
  });

  try {
    const parsed = new URL(`${panelUrl}/api/nodes/heartbeat`);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      },
      res => {
        if (res.statusCode === 200) {
          // console.log('[Agent] Heartbeat acknowledged.');
        } else {
          console.warn(`[Agent] Heartbeat rejected with status ${res.statusCode}`);
        }
      }
    );

    req.on('error', err => {
      console.warn(`[Agent] Heartbeat connection error: ${err.message}`);
    });

    req.write(payload);
    req.end();
  } catch (err) {
    console.error(`[Agent] Heartbeat URL error: ${err.message}`);
  }
}

// Send heartbeat every 15 seconds
setInterval(sendHeartbeat, 15000);
sendHeartbeat();
console.log('[Agent] Daemon running in background.');
