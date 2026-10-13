// Run after npm run build:backend. Uses in-memory media persistence and no external services.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');

const backendRequire = createRequire(path.resolve(__dirname, '../../apps/backend/package.json'));
const { AthletesService } = backendRequire('./dist/src/athletes/athletes.service.js');
const { ParticipantsService } = backendRequire('./dist/src/participants/participants.service.js');
const { IdentityOcrService } = backendRequire('./dist/src/participants/identity-ocr.service.js');

const files = [
  { mimetype: 'application/pdf', originalname: 'identity.pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF') },
  { mimetype: 'image/jpeg', originalname: 'identity.jpg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
].map((file) => ({ ...file, size: file.buffer.length }));

function fixture(identityOcrEnabled) {
  const media = new Map();
  let uploadCount = 0;
  let integrationReads = 0;
  const settings = {
    get: async () => ({ values: { identityOcrEnabled }, configured: { identityOcrEnabled: false } }),
    integrationValues: async () => {
      integrationReads += 1;
      return {};
    },
  };
  const prisma = {
    participantAccount: { findUnique: async () => ({ id: 'account', isActive: true,
      athlete: { id: 'participant-athlete' } }) },
    $queryRaw: async () => [],
    athleteMedia: {
      findUnique: async ({ where }) => media.get(JSON.stringify(where.athleteId_type)) || null,
      upsert: async ({ where, create, update }) => {
        const key = JSON.stringify(where.athleteId_type);
        const stored = media.get(key);
        const record = stored ? { ...stored, ...update } : { id: `media-${media.size}`, ...create };
        media.set(key, record);
        return record;
      },
    },
  };
  prisma.$transaction = async (operation) => operation(prisma);
  const storage = {
    upload: async (buffer, mimeType, folder) => {
      uploadCount += 1;
      return { key: `${folder}/file-${uploadCount}`, size: buffer.length, mimeType };
    },
    deleteQuietly: async () => {},
    withUpload: async (file, folder, previousKey, persist) => {
      const stored = await storage.upload(file.buffer, file.mimetype, folder);
      return persist(stored.key, stored);
    },
  };
  const ocr = new IdentityOcrService(settings);
  const athletes = new AthletesService(prisma, {}, storage, settings);
  athletes.findOne = async (id) => ({ id });
  const participants = new ParticipantsService(prisma, storage, {}, ocr, {}, settings, {}, {});
  participants.getProfile = async () => ({ hasAthleteProfile: true, athlete: { id: 'participant-athlete' } });
  return { athletes, participants, ocr, media, getUploadCount: () => uploadCount, getIntegrationReads: () => integrationReads };
}

async function main() {
  for (const enabled of [false, true]) {
    const context = fixture(enabled);
    for (const file of files) {
      const preview = await context.participants.previewIdentityOcr('CCCD_FRONT', file);
      assert.equal(preview.status, !enabled || file.mimetype.startsWith('image/') ? 'NOT_CONFIGURED' : 'FAILED');
      if (!enabled) assert.equal(preview.message, undefined, 'OCR disabled must not warn that PDFs need manual review');

      for (const type of ['CCCD_FRONT', 'CCCD_BACK', 'PASSPORT']) {
        const adminDocument = await context.athletes.uploadDocument('admin-athlete', type, file);
        const accountDocument = await context.participants.upsertMedia('account', type, file);
        for (const document of [adminDocument, accountDocument]) {
          assert.equal(document.verificationStatus, enabled ? 'PENDING' : 'VERIFIED');
        }
        for (const athleteId of ['admin-athlete', 'participant-athlete']) {
          const document = context.media.get(JSON.stringify({ athleteId, type }));
          assert.equal(document.verifiedBy, enabled ? null : 'SYSTEM:OCR_DISABLED');
          assert.equal(document.verifiedAt instanceof Date, !enabled);
          assert.equal(Boolean(document.verificationNote), !enabled);
        }
      }
    }
    if (!enabled) assert.equal(context.getIntegrationReads(), 0, 'OCR disabled must never request provider credentials');
    const uploadsBefore = context.getUploadCount();
    const invalidPdf = { ...files[0], buffer: Buffer.from('invalid content') };
    await assert.rejects(context.athletes.uploadDocument('admin-athlete', 'CCCD_FRONT', invalidPdf), /định dạng/);
    await assert.rejects(context.participants.upsertMedia('account', 'CCCD_FRONT', invalidPdf), /định dạng/);
    await assert.rejects(context.participants.previewIdentityOcr('CCCD_FRONT', invalidPdf), /định dạng/);
    assert.equal(context.getUploadCount(), uploadsBefore, 'Invalid PDFs must not reach storage');
  }

  console.log('Identity documents: disabled OCR skips PDF preview failures, auto-verifies create/replace uploads in CMS and participant accounts, and preserves enabled-mode review and file validation.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
