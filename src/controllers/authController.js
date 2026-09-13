const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database/db');

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

class AuthController {
  async register(req, res) {
    try {
      const { username, email, password } = req.body;

      // Check settings if registration is allowed
      const settings = db.getSettings();
      if (settings.allow_registration === false) {
        return res.status(403).json({
          success: false,
          message: 'Public registration is currently disabled by administrator.'
        });
      }

      if (!username || !email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Please provide username, email, and password.'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters long.'
        });
      }

      const existingUser = db.findOne('users', u => 
        u.email.toLowerCase() === email.toLowerCase() || 
        u.username.toLowerCase() === username.toLowerCase()
      );

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User with this email or username already exists.'
        });
      }

      const salt = bcrypt.genSaltSync(10);
      const password_hash = bcrypt.hashSync(password, salt);

      // First user registered can be admin if no admin exists, otherwise regular 'user'
      const totalUsers = db.find('users').length;
      const role = totalUsers === 0 ? 'admin' : 'user';

      const newUser = db.insert('users', {
        username: username.trim(),
        email: email.toLowerCase().trim(),
        password_hash,
        role: role,
        status: 'active'
      });

      const token = generateToken(newUser);
      const { password_hash: _, ...safeUser } = newUser;

      db.logActivity(newUser.id, 'register', { email: newUser.email }, req.ip);

      return res.status(201).json({
        success: true,
        message: 'Account registered successfully.',
        token,
        user: safeUser
      });
    } catch (err) {
      console.error('[Auth Register] Error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during registration.'
      });
    }
  }

  async login(req, res) {
    try {
      const { emailOrUsername, password } = req.body;

      if (!emailOrUsername || !password) {
        return res.status(400).json({
          success: false,
          message: 'Please provide email/username and password.'
        });
      }

      const query = emailOrUsername.trim().toLowerCase();
      const user = db.findOne('users', u => 
        u.email.toLowerCase() === query || 
        u.username.toLowerCase() === query
      );

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. User not found.'
        });
      }

      if (user.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended. Please contact admin.'
        });
      }

      const isValidPassword = bcrypt.compareSync(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Password incorrect.'
        });
      }

      const token = generateToken(user);
      const { password_hash: _, ...safeUser } = user;

      db.logActivity(user.id, 'login', { email: user.email }, req.ip);

      return res.json({
        success: true,
        message: 'Logged in successfully.',
        token,
        user: safeUser
      });
    } catch (err) {
      console.error('[Auth Login] Error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during login.'
      });
    }
  }

  async me(req, res) {
    try {
      // req.user is set by requireAuth middleware
      return res.json({
        success: true,
        user: req.user
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching session profile.'
      });
    }
  }

  async updateProfile(req, res) {
    try {
      const { username, currentPassword, newPassword } = req.body;
      const user = db.findById('users', req.user.id);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const updateData = {};

      if (username && username.trim() !== user.username) {
        updateData.username = username.trim();
      }

      if (newPassword) {
        if (!currentPassword) {
          return res.status(400).json({ success: false, message: 'Current password required to set new password.' });
        }
        if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
          return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
        }
        if (newPassword.length < 6) {
          return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
        }
        const salt = bcrypt.genSaltSync(10);
        updateData.password_hash = bcrypt.hashSync(newPassword, salt);
      }

      if (Object.keys(updateData).length > 0) {
        db.updateById('users', user.id, updateData);
      }

      const updated = db.findById('users', user.id);
      const { password_hash: _, ...safeUser } = updated;

      return res.json({
        success: true,
        message: 'Profile updated successfully.',
        user: safeUser
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Error updating profile.' });
    }
  }
}

module.exports = new AuthController();
