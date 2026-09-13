const express = require('express');
const router = express.Router();
const vpsController = require('../controllers/vpsController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', vpsController.listVps);
router.get('/:id', vpsController.getVps);
router.post('/:id/power', vpsController.powerAction);
router.post('/:id/change-password', vpsController.changePassword);
router.get('/:id/stats', vpsController.getStats);
router.get('/:id/files', vpsController.listFiles);
router.get('/:id/files/read', vpsController.readFile);
router.post('/:id/files/write', vpsController.writeFile);

module.exports = router;
