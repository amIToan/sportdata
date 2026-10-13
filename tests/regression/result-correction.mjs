// Build the backend first. Runs actual result/progression services with rollback fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resultCorrectionFixture } = require('./result-correction-fixture.cjs');

const f = resultCorrectionFixture();
const original = f.state();
const preview = await f.service.previewCorrection('source', 'admin', f.payload);
assert.equal(preview.changes.length,2);
assert.equal(preview.token.length,64);
assert.deepEqual(f.state(),original,'Preview must roll back all match, pair and revision writes');
assert.equal(f.revisions().length,0);
assert.equal(preview.changes.find(row=>row.id==='winner').after.athlete1Id,'b');
assert.equal(preview.changes.find(row=>row.id==='loser').after.athlete2Id,'a');
const saved = await f.service.enter('source','admin',{...f.payload,progressionToken:preview.token});
assert.equal(saved.resultStatus,'ENTERED');
assert.equal(f.row('winner').athlete1Id,'b');
assert.equal(f.row('loser').athlete2Id,'a');
assert.equal(f.row('winner').startTime,original.find(row=>row.id==='winner').startTime);
assert.deepEqual(f.row('source').resultData.scoreboard.actions,original.find(row=>row.id==='source').resultData.scoreboard.actions);
assert.equal(f.revisions()[0].reason,f.payload.reason);
const board = await f.scoreboard.get('source');
assert.equal(board.proposedWinnerId,'b','Corrected result overrides historical submission winner');
assert.equal(board.proposedWinMethod,'POINTS');
assert.equal((await f.service.confirm('source','admin',saved.resultVersion)).resultStatus,'REFEREE_CONFIRMED');
await assert.rejects(f.service.enter('source','admin',{...f.payload,progressionToken:preview.token}),error=>error.getStatus()===409);

for(const status of ['RUNNING','FINISHED']){
 const blocked=resultCorrectionFixture({winner:{status,resultStatus:status==='FINISHED'?'REFEREE_CONFIRMED':'DRAFT'}});
 const before=blocked.state();
 await assert.rejects(blocked.service.previewCorrection('source','admin',blocked.payload),error=>error.getStatus()===409&&error.message.includes('#2'));
 assert.deepEqual(blocked.state(),before);
 await assert.rejects(blocked.service.enter('source','admin',blocked.payload));
 assert.deepEqual(blocked.state(),before);
}
for(const change of [{status:'RUNNING'}, {athlete2Id:'z'}, {resultVersion:7}]){
 const stale=resultCorrectionFixture();
 const p=await stale.service.previewCorrection('source','admin',stale.payload);
 stale.change('winner',change);
 const before=stale.state();
 await assert.rejects(stale.service.enter('source','admin',{...stale.payload,progressionToken:p.token}),error=>error.getStatus()===409);
 assert.deepEqual(stale.state(),before);
}
{
 const stale=resultCorrectionFixture();const p=await stale.service.previewCorrection('source','admin',stale.payload);
 await assert.rejects(stale.service.enter('source','admin',{...stale.payload,athlete1Score:5,progressionToken:p.token}),error=>error.getStatus()===409);
}
{
 const unchanged=resultCorrectionFixture({winner:{status:'RUNNING'}});
 const payload={...unchanged.payload,winnerId:'a',athlete1Score:20,athlete2Score:9};
 const p=await unchanged.service.previewCorrection('source','admin',payload);
 assert.equal(p.changes.length,0);
 unchanged.change('winner',{resultVersion:8});
 await unchanged.service.enter('source','admin',{...payload,progressionToken:p.token});
 assert.equal(unchanged.row('winner').athlete1Id,'a');
}
for(const resultStatus of ['APPROVED','PUBLISHED','LOCKED']){
 const locked=resultCorrectionFixture({source:{resultStatus}});
 await assert.rejects(locked.service.previewCorrection('source','admin',locked.payload));
 const reopened=await locked.service.reopen('source','admin',5,'Correct a saved result');
 const payload={...locked.payload,expectedVersion:reopened.resultVersion};
 const p=await locked.service.previewCorrection('source','admin',payload);
 await locked.service.enter('source','admin',{...payload,progressionToken:p.token});
 assert.equal(locked.row('source').winnerId,'b');
}
for(const invalid of [{winnerId:'outsider'}, {winnerId:'a'}, {athlete1Score:10,athlete2Score:7}, {reason:''}, {athlete1Score:51}, {athlete2Penalties:5}, {winMethod:'SUBMISSION',athlete2Score:9}]){
 const bad=resultCorrectionFixture();const before=bad.state();
 await assert.rejects(bad.service.previewCorrection('source','admin',{...bad.payload,...invalid}));assert.deepEqual(bad.state(),before);
}
{
 const walkover=resultCorrectionFixture({winner:{athlete2Id:null,status:'FINISHED',resultStatus:'DRAFT',winMethod:'WALKOVVER',winnerId:'a',resultEnteredAt:null},final:{athlete1Id:'a'}});
 const p=await walkover.service.previewCorrection('source','admin',walkover.payload);
 assert.ok(p.changes.some(change=>change.id==='final'&&change.after.athlete1Id==='b'));
 await walkover.service.enter('source','admin',{...walkover.payload,progressionToken:p.token});
 assert.equal(walkover.row('final').athlete1Id,'b');assert.equal(walkover.row('winner').winnerId,'b');
 const blocked=resultCorrectionFixture({winner:{athlete2Id:null,status:'FINISHED',resultStatus:'DRAFT',winMethod:'WALKOVVER',winnerId:'a',resultEnteredAt:null},final:{athlete1Id:'a',status:'RUNNING'}});
 const before=blocked.state();await assert.rejects(blocked.service.previewCorrection('source','admin',blocked.payload),error=>error.message.includes('#4'));assert.deepEqual(blocked.state(),before);
}
console.log('PASS result correction: rollback preview, winner/loser pairs, atomic apply, preserved audit/scoreboard history, stale snapshots, played-match guards, score-only edits, reopen and automatic walkover cascades.');

// Existing bad correction: scores changed from 2–7 to 10–7, but B remained winner.
// The loser has already advanced through an automatic bye in the repechage tree.
{
 const legacy=resultCorrectionFixture({
  source:{athlete1Score:10,athlete2Score:7,winnerId:'b',winMethod:'POINTS'},
  winner:{athlete1Id:'b'},
  loser:{athlete1Id:null,athlete2Id:'a',status:'FINISHED',resultStatus:'DRAFT',winnerId:'a',winMethod:'WALKOVVER',resultEnteredAt:null,winnerToMatchId:'final',winnerToSide:'ATHLETE1'},
  final:{athlete1Id:'a'},
 });
 const payload={...legacy.payload,athlete1Score:10,athlete2Score:7,winnerId:'a'};
 const before=legacy.state();
 const preview=await legacy.service.previewCorrection('source','admin',payload);
 assert.deepEqual(legacy.state(),before);
 assert.deepEqual(preview.changes.map(change=>change.id).sort(),['final','loser','winner']);
 await legacy.service.enter('source','admin',{...payload,progressionToken:preview.token});
 assert.equal(legacy.row('source').winnerId,'a');
 assert.equal(legacy.row('winner').athlete1Id,'a');
 assert.equal(legacy.row('loser').athlete2Id,'b');
 assert.equal(legacy.row('loser').winnerId,'b');
 assert.equal(legacy.row('final').athlete1Id,'b');
 console.log('PASS legacy 10–7 correction: saved winner, next winner match, repechage bye and its descendant all repaired.');
}
