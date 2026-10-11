const notificationRepository = require('../repositories/notificationRepository');
const userRepository = require('../repositories/userRepository');
const logger = require('../config/logger');

// Must stay in step with chk_notification_events_type in the schema. 'critical' is a severity the
// bell draws differently and nothing currently sends: the one message that used it was the
// panic-value callback, withdrawn in [1.98.0]. Kept because severity is a property of the
// notification subsystem rather than of that feature, and the next genuinely urgent event should
// not have to re-argue the CHECK constraint to say so.
const VALID_TYPES = ['info', 'success', 'warning', 'critical'];

class NotificationService {
  // Fire-and-forget by design, matching config/email.js's sendEmail: a notification is a
  // best-effort side effect of a real business operation (booking/payment/result release) and
  // must never be the reason that operation fails.
  async notifyRoles(roleNames, { title, message, type = 'info' }) {
    try {
      const recipients = await userRepository.findStaffUsers(roleNames);
      if (recipients.length === 0) return;
      const userIds = recipients.map((u) => u.id);
      // An unknown type is downgraded rather than rejected, so a bad value can never stop a real
      // notification being delivered. It is logged because the downgrade is otherwise invisible:
      // an urgent message silently arriving as 'info' looks like any other bell item, and that is
      // exactly how it stops being urgent.
      if (!VALID_TYPES.includes(type)) {
        logger.warn(`Unknown notification type "${type}" downgraded to 'info' (title: ${title})`);
      }
      await notificationRepository.createForUsers(userIds, {
        title,
        message,
        type: VALID_TYPES.includes(type) ? type : 'info'
      });
    } catch (err) {
      logger.error('Failed to create notifications:', err);
    }
  }

  async getMyNotifications(userId) {
    const [notifications, unreadCount] = await Promise.all([
      notificationRepository.findForUser(userId),
      notificationRepository.countUnread(userId)
    ]);
    return { notifications, unreadCount };
  }

  async markAsRead(id, userId) {
    const updated = await notificationRepository.markAsRead(id, userId);
    if (!updated) {
      const error = new Error('Notification not found.');
      error.statusCode = 404;
      throw error;
    }
    return updated;
  }

  async markAllAsRead(userId) {
    await notificationRepository.markAllAsRead(userId);
  }
}

module.exports = new NotificationService();
