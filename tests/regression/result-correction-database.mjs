// Build first. Uses a disposable schema on LOCAL PostgreSQL; drops it in finally.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const { Client } = require('pg');
const { parse } = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const { ResultsService } = require('./dist/src/results/results.service.js');
const { MatchesService } = require('./dist/src/matches/matches.service.js');
const settings = parse(readFileSync(new URL('../../.env', import.meta.url)));
const source = new URL(process.env.DATABASE_URL || settings.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Local database required');
const schema=`result_test_${randomUUID().replaceAll('-','')}`;
const url=new URL(source);url.searchParams.set('schema',schema);
const control=new Client({connectionString:source.toString()});
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
await control.connect();
try{
 await control.query(`CREATE SCHEMA "${schema}"`);
 const migration=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema','apps/backend/prisma/schema.prisma'],{cwd:new URL('../../',import.meta.url),env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8'});
 assert.equal(migration.status,0,'Test schema migrations failed');
 const country=await db.country.create({data:{code:'TST',name:'Test country'}});
 const sport=await db.sport.create({data:{code:'RESULT-TEST',name:'Result test'}});
 const category=await db.category.create({data:{sportId:sport.id,name:'Test category',gender:'MIXED'}});
 const event=await db.event.create({data:{name:'Result correction regression',sportId:sport.id,startDate:new Date('2035-01-01'),endDate:new Date('2035-01-02')}});
 const athletes=[];
 for(const name of ['A','B','C','D'])athletes.push(await db.athlete.create({data:{firstName:name,lastName:'Test',fullName:`Athlete ${name}`,gender:'MALE',countryId:country.id}}));
 const base={eventId:event.id,categoryId:category.id,matchDate:new Date('2035-01-01')};
 const winner=await db.match.create({data:{...base,matchNumber:2,athlete1Id:athletes[0].id,athlete2Id:athletes[2].id}});
 const loser=await db.match.create({data:{...base,matchNumber:3,athlete1Id:athletes[3].id,athlete2Id:athletes[1].id}});
 const root=await db.match.create({data:{...base,matchNumber:1,status:'FINISHED',resultStatus:'REFEREE_CONFIRMED',resultVersion:1,
  athlete1Id:athletes[0].id,athlete2Id:athletes[1].id,winnerId:athletes[0].id,winMethod:'POINTS',athlete1Score:10,athlete2Score:8,
  winnerToMatchId:winner.id,winnerToSide:'ATHLETE1',loserToMatchId:loser.id,loserToSide:'ATHLETE2',resultEnteredAt:new Date(),
  resultData:{scoreboard:{remainingMs:0,runningSince:null,actions:[]}}}});
 const service=new ResultsService(db,new MatchesService(db));
 const payload={expectedVersion:1,winnerId:athletes[1].id,winMethod:'POINTS',athlete1Score:4,athlete2Score:9,reason:'Correct referee input'};
 const before=await db.match.findMany({where:{eventId:event.id},orderBy:{id:'asc'}});
 const preview=await service.previewCorrection(root.id,'test-admin',payload);
 assert.equal(preview.changes.length,2);
 assert.deepEqual(await db.match.findMany({where:{eventId:event.id},orderBy:{id:'asc'}}),before,'PostgreSQL preview must roll back');
 assert.equal(await db.resultRevision.count(),0,'Preview must not leave an audit row');
 const saved=await service.enter(root.id,'test-admin',{...payload,progressionToken:preview.token});
 assert.equal(saved.resultStatus,'ENTERED');
 assert.equal((await db.match.findUnique({where:{id:winner.id}})).athlete1Id,athletes[1].id);
 assert.equal((await db.match.findUnique({where:{id:loser.id}})).athlete2Id,athletes[0].id);
 assert.equal(await db.resultRevision.count(),1);
 await db.match.update({where:{id:winner.id},data:{status:'RUNNING'}});
 const blockedBefore=await db.match.findMany({where:{eventId:event.id},orderBy:{id:'asc'}});
 await assert.rejects(service.previewCorrection(root.id,'test-admin',{...payload,expectedVersion:saved.resultVersion,athlete1Score:10,winnerId:athletes[0].id}),error=>error.getStatus()===409);
 assert.deepEqual(await db.match.findMany({where:{eventId:event.id},orderBy:{id:'asc'}}),blockedBefore);
 assert.equal(await db.resultRevision.count(),1);
 console.log('PASS PostgreSQL result correction: preview rollback, atomic winner/loser apply, audit preservation and rejection when the next match is running.');
}finally{
 await db.$disconnect();
 await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
 await control.end();
}
