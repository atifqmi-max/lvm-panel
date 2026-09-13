const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireAdmin);

// Overview
router.get('/overview', adminController.getOverviewStats);

// VPS Admin Controls
router.post('/vps', adminController.createVps);
router.put('/vps/:id', adminController.editVps);
router.post('/vps/:id/suspend', adminController.suspendVps);
router.post('/vps/:id/unsuspend', adminController.unsuspendVps);
router.post('/vps/:id/renew', adminController.renewVps);
router.delete('/vps/:id', adminController.deleteVps);
router.post('/vps/:id/dedicated-ip', adminController.setDedicatedIp);

// User Management
router.get('/users', adminController.listUsers);
router.put('/users/:id/role', adminController.updateUserRole);
router.delete('/users/:id', adminController.deleteUser);

// Node Clustering System
router.get('/nodes', adminController.listNodes);
router.post('/nodes', adminController.createNode);
router.delete('/nodes/:id', adminController.deleteNode);

// Panel Customization & Settings
router.get('/settings', adminController.getSettings);
router.put('/settings', adminController.updateSettings);

module.exports = router;
