/**
 * Additive migration [1.51.0] — allow a biophysical score to add itself up.
 *
 * [1.50.0] closed `chk_result_fields_derivation` around the three formulas the clinic's archive
 * evidenced, deliberately: an open enum invites someone to invent clinical arithmetic. The
 * biophysical profile is the first legitimate fourth, and it is the easiest possible case — a sum
 * of four (or five) integers printed directly above it, with no external authority to disagree
 * with, which is the same shape as the ellipsoid volume [1.50.0] already computes.
 *
 * Manning's profile scores each component 0 or 2: fetal tone, gross body movement, fetal breathing
 * movement, amniotic fluid volume, and — only when a non-stress test is done — the NST. So the
 * total is /8 without and /10 with, which is why the clinic bills them as two different products
 * and why they are two field sets rather than one with an optional field.
 *
 * Reverse with:
 *   node src/scripts/migrateBiophysicalScore.js --rollback
 *
 * The rollback refuses if any field is still using BPS_SUM, because dropping the constraint value
 * out from under a live row would leave a field whose declared derivation the schema rejects — the
 * next unrelated ALTER would then fail on data that was written legitimately.
 */
const db = require('../config/database');
const logger = require('../config/logger');

const WITHOUT = `derivation IS NULL OR derivation IN ('ELLIPSOID_VOLUME','EDC_NAEGELE','GA_FROM_MSD')`;
const WITH = `derivation IS NULL OR derivation IN ('ELLIPSOID_VOLUME','EDC_NAEGELE','GA_FROM_MSD','BPS_SUM')`;

async function migrate(client) {
  await client.query(`ALTER TABLE result_fields DROP CONSTRAINT IF EXISTS chk_result_fields_derivation`);
  await client.query(`ALTER TABLE result_fields ADD CONSTRAINT chk_result_fields_derivation CHECK (${WITH})`);
  logger.info('  ~ chk_result_fields_derivation now admits BPS_SUM');
}

async function rollback(client) {
  const { rows } = await client
    .query(`SELECT COUNT(*)::int AS n FROM result_fields WHERE derivation = 'BPS_SUM'`)
    .catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.error(`  ! ${rows[0].n} field(s) still declare BPS_SUM.`);
    logger.error('    Narrowing the constraint now would leave rows the schema rejects, and the');
    logger.error('    next unrelated ALTER on this table would fail on data written legitimately.');
    logger.error('    Remove or re-point those fields first.');
    throw new Error('refusing to narrow the constraint while BPS_SUM is in use');
  }
  await client.query(`ALTER TABLE result_fields DROP CONSTRAINT IF EXISTS chk_result_fields_derivation`);
  await client.query(`ALTER TABLE result_fields ADD CONSTRAINT chk_result_fields_derivation CHECK (${WITHOUT})`);
  logger.info('  ~ chk_result_fields_derivation narrowed back to three formulas');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(`[1.51.0] ${reversing ? 'Rolling back' : 'Applying'} biophysical score derivation…`);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.51.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();
  logger.info('[1.51.0] Done.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.51.0] Migration failed: ${err.message}`);
  process.exit(1);
});
