const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/scheduleController');
const { verifyToken, authorizeStaff, authorizeRoles } = require('../middlewares/auth');

/**
 * The clinic's diary. [1.57.0]
 *
 * READING is open to any signed-in staff member: reception is asked "are we open on the 30th?"
 * all day, and making them guess because the answer lives behind an admin screen is how a patient
 * gets told the wrong thing.
 *
 * WRITING is Admin and SuperAdmin, by role. There is no `schedule:manage` permission and
 * inventing one would mean a permission held by nobody until somebody remembered to grant it —
 * while the clinic's opening hours sat unchangeable. Deciding when the clinic opens is not a
 * front-desk act; it is the same tier as pricing and staffing, both already Admin's.
 */
// Public, like GET /tests and GET /packages. The booking calendar has to mark a closed date
// before the patient picks it, and the patient may not be signed in when they look.
router.get('/public', scheduleController.getPublic);

router.get('/week', verifyToken, authorizeStaff, scheduleController.getWeek);
router.put('/week/:dayOfWeek', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), scheduleController.updateDay);

router.get('/overrides', verifyToken, authorizeStaff, scheduleController.listOverrides);
router.put('/overrides', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), scheduleController.setOverride);
router.delete('/overrides/:date', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), scheduleController.removeOverride);

module.exports = router;
