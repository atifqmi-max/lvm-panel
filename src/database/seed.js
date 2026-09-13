const bcrypt = require('bcryptjs');
const db = require('./db');

async function seed(adminEmail, adminPassword, adminUsername = 'admin') {
  console.log('[Seed] Initializing database...');

  // 1. Check or create Admin
  const email = adminEmail || process.env.ADMIN_EMAIL || 'admin@lvmpanel.local';
  const password = adminPassword || process.env.ADMIN_PASSWORD || 'Admin@123456';
  const username = adminUsername || 'admin';

  let admin = db.findOne('users', u => u.email.toLowerCase() === email.toLowerCase() || u.role === 'admin');

  if (!admin) {
    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    admin = db.insert('users', {
      username: username,
      email: email,
      password_hash: password_hash,
      role: 'admin',
      status: 'active'
    });
    console.log(`[Seed] Created default admin account: ${email}`);
  } else {
    console.log(`[Seed] Admin user already exists: ${admin.email}`);
  }

  // 2. Check or create Local Node
  const { getPublicIp } = require('../utils/helpers');
  const serverIp = await getPublicIp();

  let localNode = db.findOne('nodes', n => n.is_local === true);
  if (!localNode) {
    localNode = db.insert('nodes', {
      name: 'Local Node (Primary)',
      location: 'Primary Datacenter',
      fqdn_or_ip: serverIp,
      port: 3000,
      token: 'local_node_internal_token_' + Math.random().toString(36).substring(2, 12),
      status: 'online',
      ram_total: 16384, // 16 GB
      cpu_cores: 8,
      disk_total: 500, // 500 GB
      is_local: true,
      last_ping: new Date().toISOString()
    });
    console.log(`[Seed] Created default Local Node: ${localNode.name} (${serverIp})`);
  } else {
    // If localNode was set to 127.0.0.1, auto-upgrade to real server IP
    if (localNode.fqdn_or_ip === '127.0.0.1' && serverIp !== '127.0.0.1') {
      db.updateById('nodes', localNode.id, { fqdn_or_ip: serverIp });
      localNode.fqdn_or_ip = serverIp;
      console.log(`[Seed] Updated Local Node IP to real public IP: ${serverIp}`);
    } else {
      console.log(`[Seed] Local Node already active: ${localNode.name} (${localNode.fqdn_or_ip})`);
    }
  }

  // Set default node in settings
  db.updateSettings({ default_node_id: localNode.id });

  console.log('[Seed] Database initialization complete.');
  return { admin, localNode };
}

// Support direct execution via CLI: node src/database/seed.js <email> <password> <username>
if (require.main === module) {
  const args = process.argv.slice(2);
  const email = args[0];
  const password = args[1];
  const username = args[2] || 'admin';

  seed(email, password, username)
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('[Seed] Error during seeding:', err);
      process.exit(1);
    });
}

module.exports = seed;
