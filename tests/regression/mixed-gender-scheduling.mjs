// Build backend first. Uses the real generator and snapshot adapter, no database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { MatchesService } = require('./dist/src/matches/matches.service.js');
const { previewSnapshot } = require('./dist/src/scheduling/planner/snapshot-planner.js');
const { categoryWeight, compareCategoryWeights, contentGroupKey } = require('./dist/src/scheduling/planner/main-tree.js');
const generator = new MatchesService({});

function fixture(type = 'ROUND_ROBIN_POOL') {
  const common = { sportId: 'jj', discipline: 'NEWAZA', uniform: 'GI', minAge: 18, maxAge: null, beltLevel: null };
  const categories = [
    { ...common, id: 'male94', name: 'Nam +94 kg', gender: 'MALE', minWeight: 94, maxWeight: null, weightKind: 'OVER' },
    { ...common, id: 'female57', name: 'Nữ -57 kg', gender: 'FEMALE', maxWeight: 57, weightKind: 'CAPPED' },
    { ...common, id: 'female63', name: 'Nữ -63 kg', gender: 'FEMALE', maxWeight: 63, weightKind: 'CAPPED' },
  ];
  const event = { id: 'event', startDate: new Date('2026-10-11T00:00:00+07:00'),
    endDate: new Date('2026-10-13T00:00:00+07:00'), categories, fops: [{ id: 'mat', name: 'Thảm 1' }] };
  const snapshot = { event, matches: [], draws: [], entries: [], teams: [], heats: [], groups: [],
    owners: [], plans: [], slots: [], rules: [{ sportId: 'jj', matchDurationMinutes: 5, turnaroundMinutes: 0, minRestMinutes: 0 }] };
  for (const category of categories) {
    const entries = Array.from({ length: type === 'MAIN_TREE' ? 8 : 5 }, (_, i) => ({ id: `${category.id}-e${i}`,
      athleteId: `${category.id}-a${i}`, categoryId: category.id, status: 'VERIFIED', seed: null,
      athlete: { id: `${category.id}-a${i}`, countryId: 'VN', federationId: null } }));
    const plan = generator.buildDrawPlan({ event, category, entries, eligibleEntries: entries, fops: [] },
      { type, athleteIds: entries.map((entry) => entry.athleteId), seedingMode: 'ORDERED' }, []);
    snapshot.entries.push(...entries);
    snapshot.matches.push(...plan.matches.map((match) => ({ ...match, participants: [], resultStatus: 'DRAFT' })));
    snapshot.draws.push(...plan.draws.map((draw) => ({ ...draw, categoryId: category.id })));
  }
  const config = { schemaVersion: 1, name: 'Mixed gender', timezone: 'Asia/Ho_Chi_Minh', autoContinue: true,
    windows: ['11', '12', '13'].map((day) => ({ id: `w${day}`, localDate: `2026-10-${day}`, fopId: 'mat',
      startLocalTime: '09:00', endLocalTime: '18:00', enabled: true, breaks: [] })),
    blocks: [{ id: 'male', groupKey: contentGroupKey(categories[0]), categoryIds: ['male94'] },
      { id: 'female', groupKey: contentGroupKey(categories[1]), categoryIds: ['female63', 'female57'] }],
    earliestStarts: [], pinnedStarts: [], matchOrders: [] };
  return { snapshot, config };
}

for (const type of ['ROUND_ROBIN_POOL', 'REPECHAGE', 'REPECHAGE_QUARTERFINALS', 'MAIN_TREE']) {
  const f = fixture(type);
  const expected = [...f.snapshot.matches].sort((a, b) => a.round - b.round
    || ['female57', 'female63', 'male94'].indexOf(a.categoryId) - ['female57', 'female63', 'male94'].indexOf(b.categoryId)
    || a.bracketPosition - b.bracketPosition).map((match) => match.id);
  for (const reverse of [false, true]) {
    const config = structuredClone(f.config);
    if (reverse) config.blocks.reverse();
    const proposal = previewSnapshot(f.snapshot, config, 'new-plan');
    assert.equal(proposal.canApply, true, JSON.stringify(proposal.violations));
    assert.deepEqual(proposal.assignments.map((item) => item.matchId), expected,
      `${type}: each round must run Female -57, Female -63, Male +94 even if Male block was selected first`);
  }
}
for (const type of ['ROUND_ROBIN_POOL', 'REPECHAGE', 'REPECHAGE_QUARTERFINALS', 'MAIN_TREE']) {
  for (const metadata of ['female-missing', 'all-missing', 'inconsistent-kind', 'zero-minimum']) {
    const f = fixture(type);
    for (const category of f.snapshot.event.categories) {
      if (metadata === 'all-missing' || metadata === 'female-missing' && category.gender === 'FEMALE') {
        category.minWeight = null; category.maxWeight = null; category.weightKind = null;
      }
      if (metadata === 'inconsistent-kind') category.weightKind = 'OVER';
      if (metadata === 'zero-minimum' && category.gender === 'MALE') category.minWeight = 0;
    }
    const result = previewSnapshot(f.snapshot, f.config, 'new-plan');
    assert.equal(result.canApply, true, JSON.stringify(result.violations));
    const rounds = new Map();
    for (const item of result.assignments) {
      const ids = rounds.get(item.stageKey) || [];
      if (!ids.includes(item.categoryId)) ids.push(item.categoryId);
      rounds.set(item.stageKey, ids);
    }
    for (const ids of rounds.values()) assert.deepEqual(ids, ['female57', 'female63', 'male94'],
      `${type}/${metadata}: +94 kg must follow -57 and -63 kg within every round`);
  }
}
assert.equal(categoryWeight({ name: 'U21 Nữ −57 kg' }).value, 57);
assert.equal(categoryWeight({ name: 'Nữ -63,5 kg' }).value, 63.5);
assert.equal(categoryWeight({ name: 'U21 Nam' }).kind, 3, 'age alone is not a weight');
assert.equal(categoryWeight({ name: 'Tuyệt đối', weightKind: 'OPEN' }).kind, 2);
assert.ok(compareCategoryWeights(categoryWeight({ name: 'Nam +55 kg' }), categoryWeight({ name: 'Nữ -63 kg' })) < 0,
  'numeric kg order must take priority over capped/over flags');
// Different disciplines still follow the user's block order.
const separated = fixture();
const male = separated.snapshot.event.categories[0];
male.discipline = 'FIGHTING';
separated.config.blocks[0].groupKey = contentGroupKey(male);
const separate = previewSnapshot(separated.snapshot, separated.config, 'new-plan');
assert.equal(separate.canApply, true);
assert.ok(separate.assignments.slice(0, 10).every((item) => item.categoryId === 'male94'));

// Same discipline but different age groups retain their explicit content order.
const ages = fixture();
ages.snapshot.event.categories[0].minAge = 30;
ages.config.blocks[0].groupKey = contentGroupKey(ages.snapshot.event.categories[0]);
const ageOrder = previewSnapshot(ages.snapshot, ages.config, 'new-plan');
assert.equal(ageOrder.canApply, true);
assert.ok(ageOrder.assignments.slice(0, 10).every((item) => item.categoryId === 'male94'));
console.log('PASS: mixed genders use one round/weight order for round-robin, both under-six repechage and knockouts; discipline and age boundaries stay ordered.');
