const express = require('express');
const feedbackController = require('../controllers/feedbackController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Patient feedback. [1.112.0]

// The questions being asked, for whoever fills a form in: a patient in the portal, or reception
// typing in a paper one.
router.get('/questions', verifyToken, feedbackController.listQuestions);

// Every question, including those turned off, for whoever decides what is asked.
router.get('/questions/manage', verifyToken, authorizeStaff, authorizePermissions('feedback:manage'), feedbackController.listAllQuestions);
router.post('/questions', verifyToken, authorizeStaff, authorizePermissions('feedback:manage'), feedbackController.createQuestion);
// Before /questions/:id, so "order" is never read as an id.
router.put('/questions/order', verifyToken, authorizeStaff, authorizePermissions('feedback:manage'), feedbackController.reorderQuestions);
router.put('/questions/:id', verifyToken, authorizeStaff, authorizePermissions('feedback:manage'), feedbackController.updateQuestion);

// A patient's own: the visits they can still rate, and the form for one. Ownership is checked in
// the service. Two routes rather than one for both channels, because "a Client, or staff holding
// feedback:record" is not a gate the middleware can express, and a paper form must name its typist.
router.get('/mine/pending', verifyToken, authorizeRoles('Client'), feedbackController.myPending);
router.post('/visits/:visitId', verifyToken, authorizeRoles('Client'), feedbackController.submitOwn);
router.post('/visits/:visitId/paper', verifyToken, authorizeStaff, authorizePermissions('feedback:record'), feedbackController.submitPaper);

// The overview: a report, so it answers to the reports permission.
router.get('/overview', verifyToken, authorizeStaff, authorizePermissions('reports:view'), feedbackController.overview);

module.exports = router;
