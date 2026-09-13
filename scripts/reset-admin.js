// ==============================================================================
// LVM Panel - Emergency Admin Password Reset Tool
// Usage: node scripts/reset-admin.js <new_password> [admin_email]
// ==============================================================================

const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../src/database/db');

const args = process.argv.slice(2);
const newPassword = args[0];
const targetEmail = args[1];

if (!newPassword || newPassword.length < 6) {
  console.log('================================================================');
  console.log('   LVM Panel - Admin Password Reset Utility');
  console.log('================================================================');
  console.log('Usage: node scripts/reset-admin.js <new_password> [admin_email]');
  console.log('Example: node scripts/reset-admin.js MyNewPass@123 admin@panel.local');
  console.log('Note: New password must be at least 6 characters long.');
  process.exit(1);
}

// Find admin user
let admin;
if (targetEmail) {
  admin = db.findOne('users', u => u.email.toLowerCase() === targetEmail.toLowerCase());
} else {
  admin = db.findOne('users', u => u.role === 'admin');
}

if (!admin) {
  console.error(`[Error] No administrator account found matching "${targetEmail || 'role: admin'}".`);
  process.exit(1);
}

// Hash and update
const salt = bcrypt.genSaltSync(10);
const password_hash = bcrypt.hashSync(newPassword, salt);

db.updateById('users', admin.id, {
  password_hash: password_hash,
  status: 'active'
});

console.log('================================================================');
console.log('   Administrator Password Reset Successfully!');
console.log('================================================================');
console.log(`Username:      ${admin.username}`);
console.log(`Email:         ${admin.email}`);
console.log(`New Password:  ${newPassword}`);
console.log('You can now log in at http://<VPS_IP>:6000 with these credentials.');
console.log('================================================================');
process.exit(0);
