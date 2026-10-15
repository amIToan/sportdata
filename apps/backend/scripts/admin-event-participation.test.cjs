const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../tsconfig.json')});
const {EventParticipationsService}=require('../src/participants/event-participations.service');
(async()=>{
let queued=0, saved;
const media=['AVATAR','CCCD_FRONT','CCCD_BACK'].map(type=>({type,storageKey:'local:file-'+type,mimeType:'image/jpeg',size:100,verificationStatus:type==='AVATAR'?null:'VERIFIED'}));
const account={id:'person',isActive:true,displayName:'Example Person',email:'person@example.com',phone:'123',accountType:'REFEREE',accountTypes:['REFEREE'],verificationStatus:'VERIFIED',identityType:'CCCD',documentEncrypted:'encrypted',media,athlete:null,eventParticipations:[],federationId:null};
const transaction={event:{findUnique:async()=>({id:'event',participatingFederations:[]})},participantAccount:{findUnique:async()=>account},eventParticipation:{create:async({data})=>{saved=data;return {...data,id:'participation'};}}};
const service=new EventParticipationsService({$transaction:work=>work(transaction)},{enqueueTicket:async()=>{queued++;}},{},{decrypt:()=> '123456789012'},{});
const dto={eventId:'event',accountId:'person',role:'REFEREE'};
let result=await service.createAdmin(dto,'admin');assert.equal(result.status,'CONFIRMED');assert.equal(result.emailQueued,true);assert.equal(queued,1);assert.equal(saved.media.create.length,3);
account.media[1].verificationStatus='PENDING';result=await service.createAdmin(dto,'admin');assert.equal(result.status,'SUBMITTED');assert.equal(queued,1);
account.media=[];result=await service.createAdmin(dto,'admin');assert.equal(result.status,'SUBMITTED');assert.equal(queued,1);
await assert.rejects(service.createAdmin({...dto,role:'COACH'},'admin'),/không phù hợp/);
account.isActive=false;await assert.rejects(service.createAdmin(dto,'admin'),/ngừng hoạt động/);
console.log('CMS personnel registration: auto approval, pending profiles and role validation passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
