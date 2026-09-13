const https = require('https');
const http = require('http');
const os = require('os');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 4000 }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    });
    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function getPublicIp() {
  const providers = [
    'https://api.ipify.org',
    'https://ifconfig.me/ip',
    'https://icanhazip.com'
  ];

  for (const url of providers) {
    try {
      const ip = await fetchUrl(url);
      if (ip && /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(ip) && !ip.startsWith('127.')) {
        return ip;
      }
    } catch (e) {}
  }

  // Fallback to local network interfaces
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('10.0.3.')) {
        return net.address;
      }
    }
  }

  return '127.0.0.1';
}

module.exports = {
  getPublicIp
};
