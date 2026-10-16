const express = require('express');
const verificationController = require('../controllers/verificationController');

const router = express.Router();

// Is this report genuine? [1.126.0] Public and unauthenticated: it is asked by whoever the patient
// showed their report to, who has no account here. It states only what lets them match the paper
// (see verificationService), and app.js gives it a limiter that counts the misses, which is what
// guessing codes produces.
router.get('/:code', verificationController.verify);

module.exports = router;
