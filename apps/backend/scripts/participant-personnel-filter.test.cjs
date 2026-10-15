const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../tsconfig.json') });
const { validate } = require('class-validator');
const { ParticipantAccountsService } = require('../src/participants/participant-accounts.service');
const { ListParticipantAccountsDto } = require('../src/participants/dto/list-participant-accounts.dto');
const { DeletePersonnelDto } = require('../src/participants/dto/delete-personnel.dto');

async function main() {
  const calls = [];
  const transaction = { participantAccount: {
    findMany: async (args) => { calls.push(args); return []; },
    count: async (args) => { calls.push(args); return 0; },
  } };
  const service = new ParticipantAccountsService({ $transaction: (work) => work(transaction) }, {}, {});
  const query = Object.assign(new ListParticipantAccountsDto(), { accountGroup: 'PERSONNEL' });
  assert.equal((await validate(query)).length, 0);
  await service.list(query);
  const groupFilter = { OR: [
    { accountType: { in: ['REFEREE', 'TEAM_LEADER', 'COACH'] } },
    { accountTypes: { hasSome: ['REFEREE', 'TEAM_LEADER', 'COACH'] } },
  ] };
  assert.deepEqual(calls[0].where.AND, [groupFilter]);
  assert.deepEqual(calls[1].where, calls[0].where);
  assert.deepEqual(calls[2].where.AND[0], calls[0].where);
  assert.deepEqual(calls[3].where.AND[0], calls[0].where);
  calls.length = 0;
  await service.list(Object.assign(new ListParticipantAccountsDto(), {
    accountGroup: 'PERSONNEL', accountType: 'COACH', federationId: 'example-unit',
  }));
  assert.ok(calls[0].where.AND.some((filter) => filter.federationId === 'example-unit'));
  assert.deepEqual(calls[0].where.AND[0], { OR: [{ accountType: 'COACH' }, { accountTypes: { has: 'COACH' } }] });
  assert.deepEqual(calls[0].where.AND[1], groupFilter);
  calls.length = 0;
  await service.list(new ListParticipantAccountsDto());
  assert.deepEqual(calls[0].where.AND, []);
  assert.ok((await validate(Object.assign(new ListParticipantAccountsDto(), { accountGroup: 'UNKNOWN' }))).length > 0);
  const deletes = [];
  const deletionTransaction = { participantAccount: {
    count: async () => 2,
    deleteMany: async (args) => { deletes.push(args); return { count: 2 }; },
  } };
  const deletionService = new ParticipantAccountsService({ $transaction: (work) => work(deletionTransaction) }, {}, {});
  const ids = ['person-one', 'person-two'];
  await assert.rejects(deletionService.deletePersonnel({}), /Chọn danh sách/);
  await assert.rejects(deletionService.deletePersonnel({ all: true, ids }), /Chọn danh sách/);
  assert.equal(deletes.length, 0);
  assert.deepEqual(await deletionService.deletePersonnel({ ids }), { deleted: 2 });
  assert.deepEqual(deletes[0].where, { ...groupFilter, id: { in: ids } });
  await deletionService.deletePersonnel({ all: true });
  assert.deepEqual(deletes[1].where, groupFilter);
  deletionTransaction.participantAccount.count = async () => 1;
  await assert.rejects(deletionService.deletePersonnel({ ids }), /không thuộc danh sách/);
  assert.equal(deletes.length, 2);
  assert.ok((await validate(Object.assign(new DeletePersonnelDto(), { ids: ['duplicate', 'duplicate'] }))).length > 0);
  assert.ok((await validate(Object.assign(new DeletePersonnelDto(), { all: 'true' }))).length > 0);
  assert.equal((await validate(Object.assign(new DeletePersonnelDto(), { ids }))).length, 0);
  const historyQueries = [];
  const event = { id: 'event-one', name: 'Event one', startDate: new Date('2026-10-10'), endDate: new Date('2026-10-11'), location: null };
  const historyTransaction = {
    participantAccount: { findUnique: async () => ({ id: 'person-one', athlete: { id: 'own-athlete' } }) },
    eventParticipation: { findMany: async (args) => {
      historyQueries.push(args.where);
      return [{ id: 'participation', role: 'REFEREE', status: 'CONFIRMED', referenceCode: 'REF-1', createdAt: new Date(), event, federation: null }];
    } },
    eventRegistration: { findMany: async (args) => {
      historyQueries.push(args.where);
      return ['own-athlete', 'other-athlete'].map((athleteId) => ({
        id: athleteId, athleteId, status: 'SUBMITTED', ticketCode: athleteId, createdAt: new Date(), event,
        category: { name: 'Category' }, athlete: { fullName: athleteId }, federation: null,
      }));
    } },
  };
  const historyService = new ParticipantAccountsService({ $transaction: (work) => work(historyTransaction) }, {}, {});
  const history = await historyService.eventHistory('person-one');
  assert.equal(history.total, 1);
  assert.deepEqual(history.items[0].entries.map((entry) => entry.role), ['REFEREE', 'ATHLETE', 'REGISTRANT']);
  assert.deepEqual(historyQueries[0], { accountId: 'person-one' });
  assert.deepEqual(historyQueries[1], { OR: [{ accountId: 'person-one' }, { athleteId: 'own-athlete' }] });
  historyTransaction.participantAccount.findUnique = async () => null;
  await assert.rejects(historyService.eventHistory('missing'), /Không tìm thấy hồ sơ/);
  assert.equal(historyQueries.length, 2);
  console.log('Personnel directory filters and validation passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
