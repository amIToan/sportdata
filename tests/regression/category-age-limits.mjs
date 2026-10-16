// Run after npm run build:backend. No live database access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { resolveEventAgeLimits } = require('./dist/src/events/event-age-limits.js');
const { assertAthleteEligibility } = require('./dist/src/competitions/athlete-eligibility.js');
const { ParticipantsService } = require('./dist/src/participants/participants.service.js');
const { CategoriesService } = require('./dist/src/categories/categories.service.js');
const { CreateCategoryDto } = require('./dist/src/categories/dto/create-category.dto.js');
const { UpdateCategoryDto } = require('./dist/src/categories/dto/update-category.dto.js');
const { validateSync } = require('class-validator');
const participants = Object.create(ParticipantsService.prototype);
const category = { gender: 'MALE', minAge: 18, maxAge: 21, minWeight: null, maxWeight: null };
const eventDate = new Date('2035-10-16T00:00:00Z');

// Both registration and competition/draw eligibility must use the birthday,
// include both age boundaries, and respect the event's age policy.
for (const check of [
  (athlete, limits) => participants.validateAthleteForCategory(athlete, { ...category, ...limits }, eventDate),
  (athlete, limits) => assertAthleteEligibility(athlete, { ...category, ...limits }, eventDate),
]) {
  const checkBirthDate = (date, limits) => check({ gender: 'MALE', birthDate: new Date(date) }, limits);
  const limits = resolveEventAgeLimits({ ageLimitMode: 'CATEGORY', minAge: 30, maxAge: 40 }, category);
  assert.deepEqual(limits, { minAge: 18, maxAge: 21 });
  assert.doesNotThrow(() => checkBirthDate('2017-10-16', limits));
  assert.throws(() => checkBirthDate('2017-10-17', limits), /tuổi/);
  assert.doesNotThrow(() => checkBirthDate('2013-10-17', limits));
  assert.throws(() => checkBirthDate('2013-10-16', limits), /tuổi/);
  const custom = resolveEventAgeLimits({ ageLimitMode: 'CUSTOM', minAge: 30, maxAge: 40 }, category);
  assert.deepEqual(custom, { minAge: 30, maxAge: 40 });
  assert.throws(() => checkBirthDate('2017-10-16', custom), /tuổi/);
  assert.doesNotThrow(() => checkBirthDate('2000-10-16', custom));
  const unrestricted = resolveEventAgeLimits({ ageLimitMode: 'UNRESTRICTED', minAge: 30, maxAge: 40 }, category);
  assert.deepEqual(unrestricted, { minAge: null, maxAge: null });
  assert.doesNotThrow(() => checkBirthDate('2025-10-16', unrestricted));
  assert.doesNotThrow(() => checkBirthDate('1980-10-16', unrestricted));
  assert.throws(() => check({ gender: 'MALE', birthDate: null }, limits), /ngày sinh/);
}

// Clearing saved bounds must pass validation and reach persistence as null.
for (const Dto of [CreateCategoryDto, UpdateCategoryDto]) {
  for (const bounds of [{ minAge: 18, maxAge: 21 }, { minAge: null, maxAge: null }]) {
    const dto = Object.assign(new Dto(), { name: 'Test', sportId: 'sport', gender: 'MALE', ...bounds });
    assert.deepEqual(validateSync(dto), []);
  }
}
const writes = [];
const categories = new CategoriesService({ category: {
  findUnique: async () => ({ id: 'category', name: 'Test', sportId: 'sport', minAge: 18, maxAge: 21 }),
  findFirst: async () => null,
  create: async ({ data }) => { writes.push(data); return data; },
  update: async ({ data }) => { writes.push(data); return data; },
} });
await categories.create({ name: 'Test', sportId: 'sport', gender: 'MALE', minAge: 18, maxAge: 21 });
await categories.update('category', { minAge: null, maxAge: null });
assert.equal(writes[0].minAge, 18);
assert.equal(writes[0].maxAge, 21);
assert.equal(writes[1].minAge, null);
assert.equal(writes[1].maxAge, null);
console.log('PASS: age boundaries, birthdays, event age policies, required birth dates, create/update DTOs and clearing saved age limits.');
