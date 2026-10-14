// Run: node --test apps/backend/scripts/match-export.test.cjs
require('ts-node').register({ project: require('node:path').resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MatchExportService } = require('../src/matches/match-export.service.ts');
const { MatchesService } = require('../src/matches/matches.service.ts');

const athlete1 = { id: 'a', fullName: 'Nguyễn Văn An' };
const athlete2 = { id: 'b', fullName: 'Trần Minh Bình' };
const match = { scheduleOrder: 1, category: { name: 'Nam −85 kg' }, matchNumber: 5, round: 2,
  matchDate: new Date('2026-10-14T00:00:00Z'), startTime: new Date('2026-10-14T03:05:00Z'),
  athlete1, athlete2, athlete1Score: 2.5, athlete2Score: 1, winnerId: 'a', status: 'FINISHED',
  fopRecord: { name: 'Thảm 1' }, id: 'hidden-id', notes: 'hidden-notes', winnerToMatchId: 'hidden-link' };

test('CSV has exactly the ten table columns and display values, with all filtered pages', async () => {
  const query = { categoryIds: 'cat', athleteName: 'Nguyễn', hideByes: true, scheduleOrder: 'desc', page: 2, limit: 50 };
  const service = new MatchExportService({ event: { findUnique: async () => ({ id: 'event' }) } }, {
    findAll: async (received, unpublished, allRows) => {
      assert.deepEqual(received, { ...query, eventId: 'event', pagination: 'page', page: 1 });
      assert.equal(unpublished, true); assert.equal(allRows, true);
      return { items: Array.from({ length: 63 }, (_, index) => ({ ...match, scheduleOrder: 63 - index })) };
    },
  });
  const bytes = await service.csv('event', query);
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
  const lines = bytes.toString('utf8').slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 64);
  assert.equal(lines[0], '"Thứ tự thi đấu","Hạng đấu","#","Vòng","Ngày / giờ","VĐV 1","VĐV 2","Điểm","Sân","Trạng thái"');
  assert.equal(lines[1], '"63","Nam −85 kg","5","2","10:05 14/10/2026","Nguyễn Văn An Thắng","Trần Minh Bình","2,5 – 1","Thảm 1","Đã hoàn thành"');
  assert.ok(lines[63].startsWith('"1","Nam −85 kg"'));
  assert.doesNotMatch(bytes.toString(), /hidden-id|hidden-notes|hidden-link/);
});

test('CSV mirrors team, pending and empty cells and escapes spreadsheet values', async () => {
  const service = new MatchExportService({ event: { findUnique: async () => ({ id: 'event' }) } }, {
    findAll: async () => ({ items: [{ ...match, scheduleOrder: null, category: null, matchNumber: null, round: null,
      startTime: null, athlete1: null, athlete2: null, team1: { name: 'Hidden team name', members: [
        { athlete: { fullName: 'Tên, "A"' } }, { athlete: { fullName: 'Tên B' } },
      ] }, fopRecord: null, fop: null, status: 'SCHEDULED' },
      { ...match, athlete1: { fullName: '=FORMULA()' }, athlete2: { fullName: 'Hai\ndòng' } }] }),
  });
  const text = (await service.csv('event', {})).toString();
  assert.ok(text.includes('"Chưa xếp giờ","—","","","14/10/2026 · Chưa xếp giờ","Tên, ""A"" / Tên B","Chờ xác định","—","Chưa chọn sân","Sắp diễn ra"'));
  assert.ok(text.includes(`"'=FORMULA()"`));
  assert.ok(text.includes('"Hai\ndòng"'));
  assert.doesNotMatch(text, /Hidden team name/);
});

test('unpaginated schedule export retains rows after page 50 and unscheduled matches', async () => {
  const rows = Array.from({ length: 63 }, (_, index) => ({ id: String(index), startTime: new Date(2026, 9, 14, 8, index) }));
  rows.push({ id: 'pending', startTime: null });
  const service = new MatchesService({ match: { findMany: async (args) => args.include
    ? rows.filter((match) => args.where.id.in.includes(match.id)).reverse()
    : args.select.startTime ? rows : rows.map(({ id }) => ({ id })).reverse() } });
  const result = await service.findAll({ eventId: 'event', scheduleOrder: 'asc', page: 2, limit: 50 }, true, true);
  assert.equal(result.items.length, 64);
  assert.equal(result.items[62].scheduleOrder, 63);
  assert.equal(result.items[63].scheduleOrder, null);
});

