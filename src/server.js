const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const config = require('./config');
const db = require('./database/db');
const seed = require('./database/seed');
const scheduler = require('./services/scheduler');
const { setupTerminalWebSocket } = require('./services/terminalService');

const authRoutes = require('./routes/authRoutes');
const vpsRoutes = require('./routes/vpsRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve daemon directory so agents can download agent.js directly
app.use('/daemon', express.static(path.join(__dirname, '..', 'daemon')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/vps', vpsRoutes);
app.use('/api/admin', adminRoutes);

// Public settings & branding API
app.get('/api/settings/public', (req, res) => {
  const settings = db.getSettings();
  res.json({
    success: true,
    panel_name: settings.panel_name || 'LVM Panel',
    theme: settings.theme || 'cyber-dark',
    accent_color: settings.accent_color || '#3b82f6',
    allow_registration: settings.allow_registration !== false,
    port: config.PORT,
    version: config.VERSION
  });
});

// Remote Node Heartbeat Receiver
app.post('/api/nodes/heartbeat', (req, res) => {
  const { token, stats } = req.body;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Node token required.' });
  }

  const node = db.findOne('nodes', n => n.token === token);
  if (!node) {
    return res.status(404).json({ success: false, message: 'Unrecognized node token.' });
  }

  const updateObj = {
    status: 'online',
    last_ping: new Date().toISOString()
  };

  if (stats) {
    if (stats.ram_total_mb) updateObj.ram_total = stats.ram_total_mb;
    if (stats.cpu_cores) updateObj.cpu_cores = stats.cpu_cores;
  }

  db.updateById('nodes', node.id, updateObj);
  return res.json({ success: true, message: 'Heartbeat acknowledged.' });
});

// Fallback SPA routing to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Setup WebSocket server for Web Terminal
const wss = new WebSocketServer({ server, path: '/ws/terminal' });
setupTerminalWebSocket(wss);

// Initialize database & Start Server
async function startServer() {
  try {
    // Ensure default admin & node exist
    await seed();

    // Start background duration expiration checker
    scheduler.start(60000);

    server.listen(config.PORT, config.HOST, () => {
      console.log('====================================================');
      console.log(`   LVM Panel running at http://${config.HOST}:${config.PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   WebSocket Terminal active at ws://${config.HOST}:${config.PORT}/ws/terminal`);
      console.log('====================================================');
    });
  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer };
