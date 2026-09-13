const fs = require('fs');
const path = require('path');
const config = require('../config');

class JsonDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      users: [],
      nodes: [],
      vps: [],
      settings: {
        panel_name: 'LVM Panel',
        theme: 'cyber-dark',
        accent_color: '#3b82f6',
        allow_registration: true,
        default_node_id: null,
        port: config.PORT
      },
      activities: []
    };
    this.init();
  }

  init() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          users: parsed.users || [],
          nodes: parsed.nodes || [],
          vps: parsed.vps || [],
          settings: { ...this.data.settings, ...(parsed.settings || {}) },
          activities: parsed.activities || []
        };
      } catch (err) {
        console.error('[DB] Error parsing existing database, keeping in-memory fallback:', err.message);
      }
    } else {
      this.save();
    }
  }

  save() {
    try {
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('[DB] Failed to save database to disk:', err.message);
    }
  }

  // Generic helpers
  find(collection, filterFn) {
    if (!this.data[collection]) return [];
    if (!filterFn) return [...this.data[collection]];
    return this.data[collection].filter(filterFn);
  }

  findOne(collection, filterFn) {
    if (!this.data[collection]) return null;
    return this.data[collection].find(filterFn) || null;
  }

  findById(collection, id) {
    return this.findOne(collection, item => item.id === id);
  }

  insert(collection, item) {
    if (!this.data[collection]) {
      this.data[collection] = [];
    }
    const newItem = {
      id: item.id || (Date.now().toString(36) + Math.random().toString(36).substring(2, 7)),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...item
    };
    this.data[collection].push(newItem);
    this.save();
    return newItem;
  }

  update(collection, filterFn, updateObj) {
    if (!this.data[collection]) return 0;
    let count = 0;
    this.data[collection] = this.data[collection].map(item => {
      if (filterFn(item)) {
        count++;
        return {
          ...item,
          ...updateObj,
          updated_at: new Date().toISOString()
        };
      }
      return item;
    });
    if (count > 0) this.save();
    return count;
  }

  updateById(collection, id, updateObj) {
    return this.update(collection, item => item.id === id, updateObj);
  }

  delete(collection, filterFn) {
    if (!this.data[collection]) return 0;
    const initialLen = this.data[collection].length;
    this.data[collection] = this.data[collection].filter(item => !filterFn(item));
    const deletedCount = initialLen - this.data[collection].length;
    if (deletedCount > 0) this.save();
    return deletedCount;
  }

  deleteById(collection, id) {
    return this.delete(collection, item => item.id === id);
  }

  // Settings
  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(newSettings) {
    this.data.settings = {
      ...this.data.settings,
      ...newSettings
    };
    this.save();
    return this.data.settings;
  }

  // Audit logging
  logActivity(userId, action, details = {}, ip = '') {
    this.insert('activities', {
      user_id: userId,
      action,
      details,
      ip_address: ip,
      timestamp: new Date().toISOString()
    });
  }
}

const db = new JsonDatabase(config.DB_PATH);
module.exports = db;
