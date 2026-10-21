const express = require('express');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/auth');
const { uploadAvatarMiddleware } = require('../config/upload');

const router = express.Router();

// Rate limits for the unauthenticated routes are applied in app.js, where every limiter lives:
// the code-sending bucket on /register, /codes/resend and /forgot-password, and the failed-attempt
// bucket on /login, /register/verify and /reset-password.
router.post('/register', authController.register);
router.post('/register/verify', authController.verifyRegistration);
router.post('/codes/resend', authController.resendCode);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/google', authController.googleLogin);
router.get('/me', verifyToken, authController.getProfile);
router.put('/me', verifyToken, authController.updateProfile);
router.put('/change-password', verifyToken, authController.changePassword);
// [1.136.0] An existing account proving its address before it accepts a patient record.
router.post('/email-check', verifyToken, authController.startEmailCheck);
router.post('/email-check/confirm', verifyToken, authController.confirmEmailCheck);
router.post('/me/avatar', verifyToken, uploadAvatarMiddleware, authController.uploadAvatar);
router.delete('/me/avatar', verifyToken, authController.deleteAvatar);
router.get('/me/avatar', verifyToken, authController.getAvatarFile);

module.exports = router;
