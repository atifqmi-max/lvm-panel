const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  JWT_SECRET: process.env.JWT_SECRET || 'lvm_panel_super_secret_key_production_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  DB_PATH: path.resolve(__dirname, '..', process.env.DB_FILE || 'data/lvm_db.json'),
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  VERSION: '1.0.0'
};
