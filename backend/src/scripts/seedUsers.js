const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');
const logger = require('../config/logger');

/**
 * The demo accounts, one per role. [1.89.0]
 *
 * Named like the people who would hold them, because a demo that says "Released by Doc Lab" reads
 * as a placeholder on every report, audit line and sidebar. Every name and number is invented;
 * none belongs to the clinic's staff. The clinic's real report signatories are in
 * constants/labResultForms.js, and only the demo's sample report PDFs print them.
 *
 * `placeholder` is the name each account was first seeded with. An account that still carries it
 * is renamed; one somebody has renamed since (the Admin account reads "Jessie Uba") is left alone.
 */
const usersToSeed = [
  { firstName: 'Carlo', lastName: 'Pacana', email: 'admin@enlogada.com', role: 'SuperAdmin', contact: '09173104826', placeholder: 'Super Admin' },
  { firstName: 'Liza', lastName: 'Emano', email: 'clinicadmin@enlogada.com', role: 'Admin', contact: '09189273641', placeholder: 'Clinic Manager' },
  { firstName: 'Maria', lastName: 'Santos', email: 'receptionist@enlogada.com', role: 'Receptionist', contact: '09264518237', placeholder: 'Maria Santos' },
  { firstName: 'Joel', lastName: 'Cabahug', email: 'cashier@enlogada.com', role: 'Cashier', contact: '09352716480', placeholder: 'Juan Cashier' },
  { firstName: 'Kristine', lastName: 'Neri', email: 'lab@enlogada.com', role: 'Laboratory Staff', contact: '09457382916', placeholder: 'Doc Lab' },
  { firstName: 'Angela', lastName: 'Roa', email: 'ultrasound@enlogada.com', role: 'Ultrasound Staff', contact: '09561843207', placeholder: 'Sonya Ultrasound' },
  { firstName: 'Paolo', lastName: 'Dagondon', email: 'xray@enlogada.com', role: 'Xray Staff', contact: '09678125394', placeholder: 'Xavier Ray' },
  { firstName: 'Elena', lastName: 'Cabrera', email: 'client@enlogada.com', role: 'Client', contact: '09771946358', placeholder: 'Elena Client' },
];

// Made by hand for combined-role testing (TEST_ACCOUNTS.md), never created here. Renamed only if
// it exists and still carries its placeholder.
const renameOnly = [
  { firstName: 'Rhea', lastName: 'Tan', email: 'multirole@enlogada.com', contact: '09085263719', placeholder: 'Multi Role' },
];

const stillPlaceholder = (user, placeholder) =>
  `${user.first_name} ${user.last_name}`.trim().toLowerCase() === placeholder.toLowerCase();

// The numbers the first seed and old test runs gave accounts, which a demo shows as one number
// shared by half the staff.
const PLACEHOLDER_NUMBERS = new Set(['09171234567', '09170000000', '09998887777']);

const renameIfPlaceholder = async (existing, u) => {
  if (!stillPlaceholder(existing, u.placeholder)) return;
  const name = `${u.firstName} ${u.lastName}`;
  const renaming = `${existing.first_name} ${existing.last_name}` !== name;
  const renumbering = PLACEHOLDER_NUMBERS.has(existing.contact_number) && existing.contact_number !== u.contact;
  if (!renaming && !renumbering) return;
  await userRepository.updateContactInfo(existing.id, u.firstName, u.lastName, renumbering ? u.contact : existing.contact_number);
  logger.info(`Updated ${u.email}: ${renaming ? `${u.placeholder} -> ${name}` : name}${renumbering ? `, number ${u.contact}` : ''}`);
};

const seedUsers = async () => {
  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Password123!', salt);

    for (const u of usersToSeed) {
      const existing = await userRepository.findByEmail(u.email);
      if (!existing) {
        const created = await userRepository.createUser(u.firstName, u.lastName, u.email, passwordHash, u.contact);
        const roleId = await userRepository.findRoleIdByName(u.role);
        if (roleId) {
          await userRepository.assignRoleToUser(created.id, roleId);
        }
        logger.info(`Seeded user: ${u.email} with role: ${u.role}`);
      } else {
        await renameIfPlaceholder(existing, u);
        logger.info(`User ${u.email} already exists.`);
      }
    }

    for (const u of renameOnly) {
      const existing = await userRepository.findByEmail(u.email);
      if (existing) await renameIfPlaceholder(existing, u);
    }

    logger.info('All seed users ready!');
    process.exit(0);
  } catch (err) {
    logger.error('Seeding failed:', err);
    process.exit(1);
  }
};

seedUsers();
