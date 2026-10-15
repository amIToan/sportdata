// Build backend first, then node --test apps/backend/scripts/smoke-athlete-performance.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { AthletePerformanceService, matchOutcome } = require('../dist/src/athletes/athlete-performance.service.js');
const event = { id: 'event', name: 'Giải toàn quốc', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-03') };
const category = { id: 'category', name: '-62 kg', sportId: 'sport' };
const bout = (updates = {}) => ({ id: 'match', eventId: event.id, categoryId: category.id, event, category, status: 'FINISHED', resultStatus: 'PUBLISHED', matchType: 'ELIMINATION', athlete1Id: 'athlete', athlete2Id: 'opponent', winnerId: 'athlete', team1: null, team2: null, participants: [], ...updates });
const fixture = ({ matches = [], statistics = [], draws = [], registrations = [] } = {}) => new AthletePerformanceService({
  athlete: { findUnique: async () => ({ events: [event], statistics }) },
  match: { findMany: async () => matches },
  eventRegistration: { findMany: async () => registrations },
  competitionEntry: { findMany: async () => [] },
  draw: { findMany: async () => draws },
});

test('lifetime totals use all bouts, exclude byes/cancelled and separate unpublished results', async () => {
  const matches = Array.from({ length: 25 }, (_, index) => bout({ id: `match-${index}` }));
  matches.push(bout({ id: 'loss', winnerId: 'opponent' }), bout({ id: 'draw', winnerId: null }), bout({ id: 'draft', resultStatus: 'DRAFT' }), bout({ id: 'bye', athlete2Id: null }), bout({ id: 'cancelled', status: 'CANCELLED' }), bout({ id: 'scheduled', status: 'SCHEDULED' }));
  const result = await fixture({ matches }).get('athlete');
  assert.equal(result.totalMatches, 28); assert.equal(result.wins, 25); assert.equal(result.losses, 1); assert.equal(result.draws, 1); assert.equal(result.pendingResults, 1);
  assert.equal(result.upcomingMatches, 1); assert.equal(result.eventCount, 1); assert.equal(result.winRate, 93);
  assert.equal(result.events[0].categories.length, 1);
});

test('team membership and ranked multi-participant results count the correct outcome', () => {
  const match = bout({ athlete1Id: null, athlete2Id: null, winnerId: null, winnerTeamId: 'team', team1: { id: 'team', members: [{ athleteId: 'athlete' }] } });
  assert.equal(matchOutcome(match, 'athlete'), 'win');
  assert.equal(matchOutcome({ ...match, winnerTeamId: 'other' }, 'athlete'), 'loss');
  assert.equal(matchOutcome(bout({ winnerId: null, matchType: 'HEAT', participants: [{ athleteId: 'athlete', rank: 2 }] }), 'athlete'), 'loss');
  assert.equal(matchOutcome(bout({ winnerId: null, matchType: 'HEAT' }), 'athlete'), 'pending');
});

test('published final awards merge with legacy medals without double counting', async () => {
  const final = bout({ matchType: 'FINAL', winnerToMatchId: null });
  const draws = [{ id: 'draw', eventId: event.id, categoryId: category.id, divisionId: null, type: 'MAIN_TREE', matches: [final] }];
  const statistics = [{ event, eventId: event.id, sportId: 'sport', goldMedals: 1, silverMedals: 0, bronzeMedals: 0 }];
  const result = await fixture({ matches: [final], draws, statistics }).get('athlete');
  assert.equal(result.goldMedals, 1); assert.equal(result.events[0].achievements[0].label, 'Huy chương Vàng');
  const pending = await fixture({ matches: [{ ...final, resultStatus: 'APPROVED' }], draws: [{ ...draws[0], matches: [{ ...final, resultStatus: 'APPROVED' }] }] }).get('athlete');
  assert.equal(pending.goldMedals, 0); assert.equal(pending.wins, 0);
  const correctedFinal = { ...final, winnerId: 'opponent' };
  const corrected = await fixture({ matches: [correctedFinal], draws: [{ ...draws[0], matches: [correctedFinal] }], statistics }).get('athlete');
  assert.equal(corrected.goldMedals, 0); assert.equal(corrected.silverMedals, 1);
});

test('participation history includes confirmed registration even before any bout', async () => {
  const other = { ...event, id: 'other', name: 'Giải khác' };
  const result = await fixture({ registrations: [{ event: other, category }] }).get('athlete');
  assert.equal(result.eventCount, 2); assert.equal(result.totalMatches, 0);
  assert.equal(result.events.find((item) => item.event.id === 'other').categories[0].id, 'category');
});
