const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('apps/frontend/src/lib/category-standings.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const helper = { exports: {} };
new Function('exports', compiled.outputText)(helper.exports);
const { categoryMedalStandings } = helper.exports;

// Aggregate bout statistics can put a bronze winner above the silver medalist,
// and can put the other bronze winner below an athlete who won no medal.
const standings = ['gold', 'bronze-a', 'silver', 'other', 'bronze-b', 'sixth']
  .map((id, index) => ({ rank: index + 1, athlete: { id }, wins: 6 - index }));
const bout = (id, first, second, winner, extra = {}) => ({ id, status: 'FINISHED',
  matchType: 'ELIMINATION', athlete1: { id: first }, athlete2: { id: second }, winnerId: winner, ...extra });
const final = bout('final', 'silver', 'gold', 'gold', { matchType: 'FINAL' });
const bronzeMatches = [bout('ba', 'other', 'bronze-a', 'bronze-a'), bout('bb', 'bronze-b', 'sixth', 'bronze-b')];
for (const type of ['REPECHAGE', 'REPECHAGE_QUARTERFINALS']) {
  const draws = [{ type: 'MAIN_TREE', matches: [final] }, { type, matches: bronzeMatches }];
  const result = categoryMedalStandings(standings, draws);
  assert.deepEqual(result.map((row) => [row.athlete.id, row.rank]), [
    ['gold', 1], ['silver', 2], ['bronze-a', 3], ['bronze-b', 3], ['other', 5], ['sixth', 6],
  ]);
  assert.equal(result[1].wins, standings[2].wins, 'keep original bout statistics');
  const unfinished = structuredClone(draws);
  unfinished[1].matches[1].status = 'SCHEDULED';
  assert.equal(categoryMedalStandings(standings, unfinished), standings, 'do not award unpublished bronze results');
}
assert.equal(standings[1].rank, 2, 'do not mutate API data');
assert.equal(categoryMedalStandings(standings, []), standings);
assert.equal(categoryMedalStandings(standings, [{ type: 'ROUND_ROBIN_POOL', matches: [final] }]), standings);
assert.equal(categoryMedalStandings(standings, [{ type: 'DOUBLE_ELIMINATION', matches: [final] }]), standings);

const semifinals = [
  bout('sa', 'bronze-a', 'gold', 'gold', { matchType: 'SEMIFINAL', winnerToMatchId: 'final' }),
  bout('sb', 'silver', 'bronze-b', 'silver', { matchType: 'SEMIFINAL', winnerToMatchId: 'final' }),
];
assert.deepEqual(categoryMedalStandings(standings, [{ type: 'MAIN_TREE', matches: [...semifinals, final] }])
  .slice(0, 4).map((row) => row.rank), [1, 2, 3, 3]);
const teams = [final, ...bronzeMatches].map((match) => ({ ...match,
  team1: match.athlete1, team2: match.athlete2, winnerTeamId: match.winnerId,
  athlete1: null, athlete2: null, winnerId: null,
}));
assert.deepEqual(categoryMedalStandings(standings, [
  { type: 'MAIN_TREE', matches: [teams[0]] }, { type: 'REPECHAGE', matches: teams.slice(1) },
]).slice(0, 4).map((row) => row.rank), [1, 2, 3, 3]);
console.log('PASS: bracket medal order, shared bronze, fifth place, pending results, teams and pool fallback.');
