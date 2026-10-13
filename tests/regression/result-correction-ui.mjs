// Uses real result/progression services with mocked APIs; no live competition writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SCOREBOARD_PLAYWRIGHT_MODULE || 'playwright');
const { resultCorrectionFixture } = require('./result-correction-fixture.cjs');
const browser = await chromium.launch({ headless: true, ...(process.env.SCOREBOARD_CHROME_PATH ? { executablePath: process.env.SCOREBOARD_CHROME_PATH } : {}) });
const base = process.env.SCOREBOARD_UI_URL || 'http://localhost:3000';
const errors=[];
try {
 const f=resultCorrectionFixture({source:{athlete1Score:10,athlete2Score:7,winMethod:'POINTS'}});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const date='2035-01-01', start=Date.parse('2035-01-01T02:00:00Z');
 const fops=[{id:'mat',name:'Mat 1'}];
 const config={schemaVersion:1,name:'Applied test schedule',timezone:'Asia/Ho_Chi_Minh',autoContinue:true,
  windows:[{id:'window',localDate:date,fopId:'mat',startLocalTime:'09:00',endLocalTime:'18:00',enabled:true,breaks:[]}],
  blocks:[{id:'block',groupKey:'GI',categoryIds:['cat']}],earliestStarts:[],matchOrders:[],pinnedStarts:[]};
 const proposal={assignments:[{matchId:'source',categoryId:'cat',drawId:'draw',blockId:'block',stageKey:'R32',chainSequence:1,localDate:date,fopId:'mat',start,end:start+300000}],
  unscheduled:[],fops,violations:[],matchDetails:[{id:'source',matchNumber:1,categoryName:'Gi -56kg',round:1,status:'FINISHED',immutable:true,canScore:false,participants:['Athlete A','Athlete B']}]};
 const plan={id:'plan',draft:config,draftVersion:1,appliedRevisionId:'revision',hasDraft:false,applied:{config,proposal}};
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('cms_token','test-token'));
 await page.route('**/api/**',async route=>{
  const req=route.request(), path=new URL(req.url()).pathname.replace('/api','');let data={items:[],total:0};
  try {
   if(path==='/auth/profile')data={id:'admin',username:'admin',role:'ADMIN'};
   else if(path==='/events/event/admin-detail')data={id:'event',name:'Event',sportId:'sport',sport:{id:'sport',name:'Jiu-Jitsu'},sports:[],categories:[{id:'cat',name:'Gi -56kg',sportId:'sport'}],fops,startDate:date,endDate:date,_count:{matches:1,athletes:2,registrations:0}};
   else if(path==='/scheduling/events/event/plans/overview')data={eventId:'event',timezone:config.timezone,days:[date],fops,drafts:[],segments:[{planId:'plan',name:config.name,localDate:date,fopId:'mat',start,end:start+300000,count:1,contents:['Gi -56kg']}]};
   else if(path==='/scheduling/events/event/plans/plan')data=plan;
   else if(path==='/scheduling/events/event/planner-input')data={days:[date],fops,categories:[]};
   else if(path==='/matches/source')data=f.row('source');
   else if(path==='/matches/event/event/category/cat/draws')data={draws:[{id:'draw',name:'Test bracket',type:'MAIN_TREE',bracketSize:4,matches:['source','winner'].map((id,index)=>({...f.row(id),round:index+1,bracketPosition:0}))}]};
   else if(path==='/results/matches/source')data=await f.service.get('source');
   else if(path==='/results/matches/source/correction-preview')data=await f.service.previewCorrection('source','admin',req.postDataJSON());
   else if(path==='/results/matches/source/enter')data=await f.service.enter('source','admin',req.postDataJSON());
   else if(path==='/results/matches/source/referee-confirm'){const dto=req.postDataJSON();data=await f.service.confirm('source','admin',dto.expectedVersion,dto.reason);}
   else if(path==='/results/matches/source/scoreboard')data=await f.scoreboard.get('source');
   else if(path==='/events/event')data={id:'event',name:'Event',categories:[{id:'cat',name:'Gi -56kg'}]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }catch(error){await route.fulfill({status:error.getStatus?.()||500,contentType:'application/json',body:JSON.stringify({message:error.message})});}
 });
 await page.goto(`${base}/cms/events/event?tab=matches`);
 await page.getByRole('button',{name:'Mở lịch',exact:true}).first().click();
 await page.locator('.ant-collapse-header').filter({hasText:'Vòng 32 người'}).click();
 const detailLink=page.getByRole('link',{name:'Chi tiết trận',exact:true});
 assert.ok((await detailLink.getAttribute('href')).includes('returnTo=%2Fcms%2Fevents%2Fevent%3Ftab%3Dmatches'));
 await detailLink.click();
 await page.getByRole('button',{name:'Sửa kết quả',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.getByLabel('Điểm',{exact:true}).nth(0).fill('4');
 await dialog.getByLabel('Điểm',{exact:true}).nth(1).fill('9');
 assert.equal(await dialog.getByLabel('Vận động viên thắng',{exact:true}).isDisabled(),true);
 await dialog.locator('.ant-form-item').filter({has:page.getByText('Vận động viên thắng',{exact:true})}).getByText('Athlete B',{exact:true}).waitFor();
 await dialog.getByLabel('Lý do hiệu chỉnh',{exact:true}).fill('Correct referee input');
 const before=f.state();
 await dialog.getByRole('button',{name:'Tính lại cặp đấu',exact:true}).click();
 await dialog.getByText('Athlete B — Athlete C',{exact:true}).waitFor();
 await dialog.getByText('Athlete D — Athlete A',{exact:true}).waitFor();
 assert.deepEqual(f.state(),before,'Calculating in the UI must not save');
 assert.equal(await dialog.getByRole('button',{name:'Lưu kết quả & cập nhật cặp đấu',exact:true}).isEnabled(),true);
 // Any edit invalidates the displayed plan; calculate again before saving.
 await dialog.getByLabel('Lý do hiệu chỉnh',{exact:true}).fill('Correct referee input after review');
 assert.equal(await dialog.getByRole('button',{name:'Lưu kết quả & cập nhật cặp đấu',exact:true}).isEnabled(),false);
 await dialog.getByRole('button',{name:'Tính lại cặp đấu',exact:true}).click({trial:true});
 await dialog.getByRole('button',{name:'Tính lại cặp đấu',exact:true}).click();
 await dialog.getByText('Athlete B — Athlete C',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Lưu kết quả & cập nhật cặp đấu',exact:true}).click();
 await dialog.getByText('Đã lưu hiệu chỉnh và cập nhật cặp đấu. Kết quả đang chờ trọng tài xác nhận lại.',{exact:true}).waitFor();
 assert.equal(f.row('source').winnerId,'b');assert.equal(f.row('winner').athlete1Id,'b');assert.equal(f.row('loser').athlete2Id,'a');
 await dialog.getByRole('button',{name:'Trọng tài xác nhận lại kết quả đã lưu',exact:true}).click();
 await dialog.getByText('Trọng tài đã xác nhận lại kết quả.',{exact:true}).waitFor();
 assert.equal(f.row('source').resultStatus,'REFEREE_CONFIRMED');
 await page.screenshot({path:'/tmp/sportdata-result-correction.png'});
 await dialog.locator('.ant-modal-close').click();
 await page.getByText('Người thắng:').filter({hasText:'Athlete B'}).waitFor();
 assert.equal(await page.locator('.text-4xl').nth(0).innerText(),'4');
 assert.equal(await page.locator('.text-4xl').nth(1).innerText(),'9');
 await page.goto(`${base}/cms/events/event?tab=matches&categoryId=cat`);
 await page.getByText('Sơ đồ cây',{exact:true}).click();
 const sourceNodes=page.locator('.sportdata-bracket-node[href*="/matches/source/edit"]');
 await sourceNodes.first().waitFor();
 assert.equal(await sourceNodes.nth(0).locator('.sportdata-node-score').innerText(),'4');
 assert.equal(await sourceNodes.nth(1).locator('.sportdata-node-score').innerText(),'9');
 assert.ok((await sourceNodes.nth(1).getAttribute('class')).includes('is-winner'));
 await page.locator('.sportdata-bracket-node[href*="/matches/winner/edit"]').getByText('Athlete B',{exact:true}).waitFor();
 await page.goto(`${base}/cms/matches/source/scoreboard`);
 await page.getByRole('heading',{name:'Athlete B',exact:true}).waitFor();
 assert.equal(await page.locator('[aria-label="Điểm Athlete A"]').innerText(),'4');
 assert.equal(await page.locator('[aria-label="Điểm Athlete B"]').innerText(),'9');
 assert.equal(await page.getByRole('dialog').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS UI result correction: finished-match action, recalculation preview, invalidation on edit, save, winner/loser propagation, referee confirmation and corrected read-only scoreboard.');
} finally { await browser.close(); }
