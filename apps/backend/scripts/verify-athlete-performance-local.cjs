// Read-only integration check; run inside the backend container.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const athlete = await prisma.athlete.findFirst({ where: { fullName: { contains: '595574' } }, select: { id: true } })
      || await prisma.athlete.findFirstOrThrow({ where: { OR: [{ matchesAsAthlete1: { some: {} } }, { matchesAsAthlete2: { some: {} } }] }, select: { id: true } });
    const response = await fetch(`http://127.0.0.1:4000/api/athletes/${athlete.id}/performance`);
    assert.equal(response.status, 200);
    const performance = await response.json();
    assert.equal(performance.eventCount, performance.events.length);
    for (const key of ['totalMatches', 'wins', 'losses', 'draws', 'pendingResults', 'goldMedals', 'silverMedals', 'bronzeMedals']) {
      assert.equal(typeof performance[key], 'number');
      assert.equal(performance[key], performance.events.reduce((sum, event) => sum + event[key], 0));
    }
    assert.equal(performance.totalMatches, performance.wins + performance.losses + performance.draws + performance.pendingResults);
    const history = await (await fetch(`http://127.0.0.1:4000/api/matches?athleteId=${athlete.id}&status=FINISHED&hideByes=true&limit=10`)).json();
    assert.ok(Array.isArray(history.items));
    assert.equal((await fetch(`http://frontend:3000/athletes/${athlete.id}`)).status, 200);
    console.log(JSON.stringify({ verified: true, totalMatches: performance.totalMatches, wins: performance.wins, losses: performance.losses, pendingResults: performance.pendingResults, eventCount: performance.eventCount, medals: [performance.goldMedals, performance.silverMedals, performance.bronzeMedals] }));
  } finally { await prisma.$disconnect(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
