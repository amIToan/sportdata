const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { promises: fs } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');
const { BackupService } = require('../dist/src/backup/backup.service');

async function main() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'sportdata-backup-test-'));
  const file = join(directory, 'fixture.jsonl.gz');
  const service = new BackupService({});
  const business = { table: 'Example', columns: ['id'] };
  const staging = {
    table: '_StorageMigrationFiles',
    columns: ['tableName', 'recordId', 'keyColumn', 'mimeType', 'data'],
  };
  async function write(schema, rows, corrupt = false) {
    const lines = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
    const counts = Object.fromEntries(schema.map((table) => [table.table, 0]));
    for (const row of rows) counts[row.table]++;
    await fs.writeFile(file, gzipSync([
      JSON.stringify({ type: 'sportdata-backup', format: 'sportdata-jsonl', version: 1,
        createdAt: '2026-10-14T00:00:00Z', schema }),
      lines.trimEnd(),
      JSON.stringify({ type: 'end', rows: rows.length, tables: counts,
        sha256: corrupt ? 'invalid' : createHash('sha256').update(lines).digest('hex') }),
    ].filter(Boolean).join('\n') + '\n'));
  }
  const row = { type: 'row', table: 'Example', data: { id: 'example' } };
  const stagedRow = { type: 'row', table: staging.table, data: {
    tableName: 'Example', recordId: 'example', keyColumn: 'imageStorageKey',
    mimeType: 'image/png', data: { $sportdataBytes: 'AQID' },
  } };
  try {
    await write([business, staging], [row, stagedRow]);
    let result = await service.validateBackup(file, [business]);
    assert.equal(result.hasStorageMigrationFiles, true);
    assert.equal(result.tables._StorageMigrationFiles, 1);

    const migrated = { ...staging, columns: [...staging.columns, 'migratedKey'] };
    await write([business, migrated], [row, { ...stagedRow,
      data: { ...stagedRow.data, migratedKey: 'r2:legacy-file' } }]);
    result = await service.validateBackup(file, [business, staging]);
    assert.equal(result.rows, 2);

    await write([business], [row]);
    result = await service.validateBackup(file, [business, migrated]);
    assert.equal(result.hasStorageMigrationFiles, false);

    await write([business, staging], [row, stagedRow], true);
    await assert.rejects(service.validateBackup(file, [business]), /checksum/);
    await write([business, staging, staging], [row]);
    await assert.rejects(service.validateBackup(file, [business]), /không hợp lệ/);
    await write([business, { ...staging, columns: [...staging.columns, 'unknown'] }], [row]);
    await assert.rejects(service.validateBackup(file, [business]), /không hợp lệ/);
    await write([business], [row]);
    await assert.rejects(service.validateBackup(file,
      [{ ...business, columns: ['id', 'requiredColumn'] }]), /Backup thiếu cột/);
    console.log('Backup compatibility: 7 checks passed');
  } finally {
    await fs.unlink(file).catch(() => undefined);
    await fs.rmdir(directory);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
