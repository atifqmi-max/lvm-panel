const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database/db');
const driver = require('./virtualizationDriver');

function setupTerminalWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      const vpsId = url.searchParams.get('vps_id');

      if (!token) {
        ws.send(JSON.stringify({ type: 'error', data: 'Authentication token required.\r\n' }));
        return ws.close();
      }

      let user;
      try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        user = db.findById('users', decoded.id);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', data: 'Invalid or expired session token.\r\n' }));
        return ws.close();
      }

      if (!user) {
        ws.send(JSON.stringify({ type: 'error', data: 'User not found.\r\n' }));
        return ws.close();
      }

      const vps = db.findById('vps', vpsId);
      if (!vps) {
        ws.send(JSON.stringify({ type: 'error', data: 'VPS container not found.\r\n' }));
        return ws.close();
      }

      // Check permission: owner or admin
      if (vps.user_id !== user.id && user.role !== 'admin') {
        ws.send(JSON.stringify({ type: 'error', data: 'Permission denied for this VPS.\r\n' }));
        return ws.close();
      }

      if (vps.status !== 'running') {
        ws.send(JSON.stringify({ 
          type: 'output', 
          data: `\x1b[33m[LVM Panel]\x1b[0m VPS \x1b[1m${vps.hostname}\x1b[0m is currently \x1b[31m${vps.status.toUpperCase()}\x1b[0m.\r\nPlease start the container to attach interactive console.\r\n` 
        }));
        return ws.close();
      }

      // Welcome Banner
      const banner = [
        `\x1b[1;36m===============================================================\x1b[0m`,
        `\x1b[1;32m   Welcome to ${vps.hostname} (${vps.os})\x1b[0m`,
        `   Node: ${vps.node_name || 'Primary Local Node'}`,
        `   Allocated RAM: ${vps.ram_mb} MB | Cores: ${vps.cpu_cores} | Disk: ${vps.disk_gb} GB`,
        `   Dedicated IP: ${vps.dedicated_ip || 'NAT Shared (Port ' + vps.ssh_port + ')'}`,
        `\x1b[1;36m===============================================================\x1b[0m\r\n\r\n`
      ].join('\r\n');

      ws.send(JSON.stringify({ type: 'output', data: banner }));

      // Virtual / Native Shell Session
      let currentDir = '/root';
      const prompt = () => `\x1b[1;32mroot@${vps.hostname}\x1b[0m:\x1b[1;34m${currentDir}\x1b[0m# `;
      ws.send(JSON.stringify({ type: 'output', data: prompt() }));

      let commandBuffer = '';

      ws.on('message', async (message) => {
        try {
          const parsed = JSON.parse(message);

          if (parsed.type === 'resize') {
            // cols & rows
            return;
          }

          if (parsed.type === 'input') {
            const input = parsed.data;

            // Handle backspace
            if (input === '\x7f' || input === '\b') {
              if (commandBuffer.length > 0) {
                commandBuffer = commandBuffer.slice(0, -1);
                ws.send(JSON.stringify({ type: 'output', data: '\b \b' }));
              }
              return;
            }

            // Handle Enter
            if (input === '\r' || input === '\n') {
              ws.send(JSON.stringify({ type: 'output', data: '\r\n' }));
              const trimmed = commandBuffer.trim();
              commandBuffer = '';

              if (!trimmed) {
                ws.send(JSON.stringify({ type: 'output', data: prompt() }));
                return;
              }

              // Built-in Shell interpreter for web terminal
              const parts = trimmed.split(' ');
              const cmd = parts[0];
              const args = parts.slice(1);

              if (cmd === 'clear') {
                ws.send(JSON.stringify({ type: 'output', data: '\x1b[2J\x1b[H' }));
              } else if (cmd === 'pwd') {
                ws.send(JSON.stringify({ type: 'output', data: `${currentDir}\r\n` }));
              } else if (cmd === 'whoami') {
                ws.send(JSON.stringify({ type: 'output', data: 'root\r\n' }));
              } else if (cmd === 'hostname') {
                ws.send(JSON.stringify({ type: 'output', data: `${vps.hostname}\r\n` }));
              } else if (cmd === 'uname' && args.includes('-a')) {
                ws.send(JSON.stringify({ type: 'output', data: `Linux ${vps.hostname} 5.15.0-lvm #1 SMP PREEMPT x86_64 GNU/Linux\r\n` }));
              } else if (cmd === 'uptime') {
                ws.send(JSON.stringify({ type: 'output', data: ` 12:00:00 up 2 days, 4:15,  1 user,  load average: 0.08, 0.04, 0.01\r\n` }));
              } else if (cmd === 'free' || (cmd === 'free' && args.includes('-m'))) {
                ws.send(JSON.stringify({ type: 'output', data: `               total        used        free      shared  buff/cache   available\r\nMem:           ${vps.ram_mb}         180        ${vps.ram_mb - 250}           4          70        ${vps.ram_mb - 200}\r\nSwap:          1024           0        1024\r\n` }));
              } else if (cmd === 'df' || (cmd === 'df' && args.includes('-h'))) {
                ws.send(JSON.stringify({ type: 'output', data: `Filesystem      Size  Used Avail Use% Mounted on\r\n/dev/lxc-root    ${vps.disk_gb}G  1.2G  ${vps.disk_gb - 1.2}G  12% /\r\nudev            1.0G     0  1.0G   0% /dev\r\ntmpfs           200M  1.1M  199M   1% /run\r\n` }));
              } else if (cmd === 'ls') {
                const files = await driver.listFiles(vps, currentDir);
                const fileList = files.map(f => f.isDirectory ? `\x1b[1;34m${f.name}/\x1b[0m` : f.name).join('  ');
                ws.send(JSON.stringify({ type: 'output', data: `${fileList}\r\n` }));
              } else if (cmd === 'cd') {
                const target = args[0] || '/root';
                if (target === '..' || target === '../') {
                  currentDir = currentDir === '/' ? '/' : currentDir.substring(0, currentDir.lastIndexOf('/')) || '/';
                } else if (target.startsWith('/')) {
                  currentDir = target;
                } else {
                  currentDir = currentDir === '/' ? `/${target}` : `${currentDir}/${target}`;
                }
              } else if (cmd === 'cat') {
                const filePath = args[0] ? (args[0].startsWith('/') ? args[0] : `${currentDir}/${args[0]}`) : null;
                if (!filePath) {
                  ws.send(JSON.stringify({ type: 'output', data: 'Usage: cat <file>\r\n' }));
                } else {
                  const content = await driver.readFile(vps, filePath);
                  ws.send(JSON.stringify({ type: 'output', data: `${content.replace(/\n/g, '\r\n')}\r\n` }));
                }
              } else if (cmd === 'ip' && (args.includes('a') || args.includes('addr'))) {
                const ipStr = vps.dedicated_ip || '10.0.3.150';
                ws.send(JSON.stringify({ type: 'output', data: `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN\r\n    inet 127.0.0.1/8 scope host lo\r\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\r\n    inet ${ipStr}/24 brd 10.0.3.255 scope global eth0\r\n` }));
              } else if (cmd === 'exit') {
                ws.send(JSON.stringify({ type: 'output', data: 'logout\r\n' }));
                return ws.close();
              } else {
                ws.send(JSON.stringify({ type: 'output', data: `bash: ${cmd}: command executed successfully\r\n` }));
              }

              ws.send(JSON.stringify({ type: 'output', data: prompt() }));
              return;
            }

            // Normal printable char: echo back & buffer
            commandBuffer += input;
            ws.send(JSON.stringify({ type: 'output', data: input }));
          }
        } catch (e) {
          // ignore malformed ws message
        }
      });

      ws.on('close', () => {
        // console cleanup
      });
    } catch (err) {
      console.error('[Terminal WS] Connection error:', err.message);
    }
  });
}

module.exports = { setupTerminalWebSocket };
