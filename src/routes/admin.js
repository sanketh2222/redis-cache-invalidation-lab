const express = require('express');
const { warmCache } = require('../controllers/adminController');

const router = express.Router();

router.post('/cache/warm', warmCache);

module.exports = router;
