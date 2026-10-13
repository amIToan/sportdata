// Run after npm run build:backend. Verifies the runtime OCR switch without external services.
const assert = require('node:assert/strict');
const { SystemSettingsService } = require('../../apps/backend/dist/src/system-settings/system-settings.service');

async function main() {
  const stores = Object.fromEntries(['athleteMedia', 'eventParticipationMedia', 'participantAccountMedia'].map((name) => [name, [
    { type: 'AVATAR', verificationStatus: null },
    { type: 'CCCD_FRONT', verificationStatus: 'PENDING' },
    { type: 'CCCD_BACK', verificationStatus: 'PENDING' },
    { type: 'PASSPORT', verificationStatus: 'PENDING' },
    { type: 'PASSPORT', verificationStatus: 'REJECTED' },
  ]]));
  let settings;
  const prisma = {
    systemSetting: { upsert: async ({ update }) => { settings = update; } },
    ...Object.fromEntries(Object.entries(stores).map(([name, rows]) => [name, { updateMany: async ({ where, data }) => {
      const pending = rows.filter((row) => where.type.in.includes(row.type) && row.verificationStatus === where.verificationStatus);
      pending.forEach((row) => Object.assign(row, data));
      return { count: pending.length };
    } }])),
  };
  const service = new SystemSettingsService(prisma);
  service.get = async () => settings;
  await service.update({ identityOcrEnabled: false });
  for (const [name, rows] of Object.entries(stores)) {
    assert.equal(rows[0].verificationStatus, null, `${name}: avatars are unaffected`);
    assert.equal(rows[4].verificationStatus, 'REJECTED', `${name}: rejected documents stay rejected`);
    for (const row of rows.slice(1, 4)) {
      assert.equal(row.verificationStatus, 'VERIFIED', `${name}: all pending identity files are auto-approved`);
      assert.equal(row.verifiedBy, 'SYSTEM:OCR_DISABLED');
      assert.ok(row.verifiedAt instanceof Date);
    }
  }
  assert.ok(stores.participantAccountMedia[1].verificationNote);
  stores.participantAccountMedia[1].verificationStatus = 'PENDING';
  await service.update({ identityOcrEnabled: true });
  assert.equal(stores.participantAccountMedia[1].verificationStatus, 'PENDING', 'Enabling OCR keeps documents awaiting review');
  console.log('PASS: disabling OCR approves pending account, athlete and event documents while retaining other states.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
