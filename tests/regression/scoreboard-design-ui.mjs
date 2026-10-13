// Read-only UI checks with mocked API data and the supplied HTML design.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SCOREBOARD_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({...(process.env.SCOREBOARD_CHROME_PATH ? { executablePath: process.env.SCOREBOARD_CHROME_PATH } : {}), headless:true});
 try {
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 const requests=[];const errors=[];page.on('pageerror', error=>errors.push(error.message));
 const category={name:'U21 JIU-JITSU NO-GI FEMALE',minWeight:null,maxWeight:48,matchDurationSeconds:300};
 const board={id:'design-review',eventId:'event',categoryId:'cat',fop:'TATAMI 4',status:'FINISHED',resultStatus:'REFEREE_CONFIRMED',resultVersion:1,athlete1Id:'a',athlete2Id:'b',athlete1Score:9,athlete2Score:0,athlete1Advantages:1,athlete2Advantages:0,athlete1Penalties:0,athlete2Penalties:0,category,event:{name:'Event'},matchNumber:1415,matchType:'ROUND_OF_16',round:2,resultData:{scoreboard:{remainingMs:171000,runningSince:null,actions:[]}},serverNow:new Date().toISOString()};
 const athlete1={id:'a',fullName:'TUONG VY P.',country:{code:'VIE',name:'VIETNAM'},federation:{name:'CLB TEST'}};
 const athlete2={id:'b',fullName:'CHEV S.',country:{code:'CAM',name:'CAMBODIA'}};
 await page.addInitScript(()=>localStorage.setItem('cms_token','test'));
 await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()).pathname.replace('/api','');requests.push([req.method(),url]);
 let data={items:[],total:0};
 if(url==='/auth/profile')data={id:'admin',username:'admin',role:'ADMIN'};
 if(url==='/matches/design-review')data={...board,athlete1,athlete2,team1:{name:'TEAM MUST NOT OVERRIDE CLUB'}};
 if(url==='/results/matches/design-review/scoreboard')data=board;
 if(url.includes('/avatar/'))return route.fulfill({status:404,body:''});
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`${process.env.SCOREBOARD_UI_URL || 'http://localhost:3000'}/cms/matches/design-review/scoreboard`);
 await page.getByRole('heading',{name:'TUONG VY P.',exact:true}).waitFor();
 assert.equal(await page.getByText('CLB TEST',{exact:true}).count(),1);
 assert.equal(await page.getByText('CAMBODIA',{exact:true}).count(),1);
 assert.equal(await page.getByText('TEAM MUST NOT OVERRIDE CLUB').count(),0);
 await page.getByText('-48 kg | Vòng 16 #1415',{exact:true}).waitFor();
 const reference=await browser.newPage({viewport:{width:1440,height:900}});
 await reference.setContent(fs.readFileSync(new URL('../../sportdata-scoreboard.html', import.meta.url),'utf8'));
 // Intentional layout changes: no separator and sufficient room for scores 0–50.
 await reference.evaluate(() => { document.querySelector('.separator').remove(); document.querySelector('.scoreboard').style.gridTemplateRows = '40.5% 40.5% 19%';
 document.querySelectorAll('.competitor').forEach(row => row.style.gridTemplateColumns = 'calc(11 * var(--u)) minmax(0, 1fr) calc(31 * var(--u))');
 document.querySelectorAll('.points').forEach(points => points.style.gridTemplateColumns = 'calc(7 * var(--u)) calc(4.6 * var(--u)) minmax(0, 1fr)');
 document.querySelectorAll('.score').forEach(score => score.style.fontSize = 'calc(17 * var(--u))'); });
 for(const viewport of [{width:1440,height:900},{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]){
 await page.setViewportSize(viewport);await reference.setViewportSize(viewport);
 const actual=await page.evaluate(()=>{
 const board=document.querySelector('[data-scoreboard]');const rows=[...board.querySelectorAll('section[aria-label^="Bảng điểm"]')];
 const style=getComputedStyle(board);
 return {font:style.fontFamily,rows:rows.map(el=>({rect:el.getBoundingClientRect().toJSON(),background:getComputedStyle(el).backgroundImage})),footer:board.querySelector('footer').getBoundingClientRect().toJSON(),score:[...board.querySelectorAll('[aria-label^="Điểm"]')].map(el=>({rect:el.getBoundingClientRect().toJSON(),font:getComputedStyle(el).fontSize,color:getComputedStyle(el).color})),clock:{rect:board.querySelector('[role="timer"][aria-label="Thời gian còn lại"]').getBoundingClientRect().toJSON(),font:getComputedStyle(board.querySelector('[role="timer"][aria-label="Thời gian còn lại"]')).fontSize},overflow:board.scrollWidth>board.clientWidth};
 });
 const expected=await reference.evaluate(()=>({rows:[...document.querySelectorAll('.competitor')].map(el=>({rect:el.getBoundingClientRect().toJSON(),background:getComputedStyle(el).backgroundImage})),footer:document.querySelector('footer').getBoundingClientRect().toJSON(),score:[...document.querySelectorAll('.score')].map(el=>({rect:el.getBoundingClientRect().toJSON(),font:getComputedStyle(el).fontSize,color:getComputedStyle(el).color})),clock:{rect:document.querySelector('.timer').getBoundingClientRect().toJSON(),font:getComputedStyle(document.querySelector('.timer-main')).fontSize}}));
 for(let i=0;i<2;i++){
 for(const field of ['x','y','width','height'])assert.ok(Math.abs(actual.rows[i].rect[field]-expected.rows[i].rect[field])<1,`Row ${i} ${field}`);
 assert.equal(actual.rows[i].background,expected.rows[i].background);
 assert.equal(actual.score[i].font,expected.score[i].font);assert.equal(actual.score[i].color,expected.score[i].color);
 }
 for(const field of ['x','y','width','height'])assert.ok(Math.abs(actual.footer[field]-expected.footer[field])<1,`Footer ${field}`);
 assert.equal(actual.clock.font,expected.clock.font);assert.ok(actual.font.startsWith('Arial'));
 assert.equal(actual.overflow,false);
 for(const value of [0, 9, 11, 50]) {
 board.athlete1Score=value;board.athlete2Score=value;
 await page.reload();
 await page.waitForFunction(value => [...document.querySelectorAll('[aria-label^="Điểm"]')].length===2 && [...document.querySelectorAll('[aria-label^="Điểm"]')].every(el=>el.textContent===String(value)), value);
 const bounds=await page.locator('[aria-label^="Điểm"]').evaluateAll(scores=>scores.map(score=>{
 const range=document.createRange();range.selectNodeContents(score);const text=range.getBoundingClientRect(),cell=score.getBoundingClientRect();
 return {left:text.left,right:text.right,cellLeft:cell.left,cellRight:cell.right,screen:innerWidth};
 }));
 for(const bound of bounds){
 assert.ok(bound.left>=bound.cellLeft-1 && bound.right<=bound.cellRight+1, `Score ${value} fits its cell at ${viewport.width}`);
 assert.ok(bound.left>=0 && bound.right<=bound.screen, `Score ${value} fits the screen at ${viewport.width}`);
 }
 }
 console.log(`PASS reference: ${viewport.width}x${viewport.height}, layout/colors/Arial and scores 0, 9, 11, 50 fit without clipping.`);
 }
 await page.setViewportSize({width:1440,height:900});await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
 await page.screenshot({path:'/tmp/sportdata-scoreboard-new-design.png'});
 assert.equal(requests.some(([method,url])=>method==='POST'&&/claim|heartbeat/.test(url)),false);
 await page.keyboard.press('q');
 await page.keyboard.press('s');
 assert.equal(requests.some(([method,url])=>method==='POST'&&url.endsWith('/scoreboard')),false);
 assert.equal(await page.locator('section[aria-label^="Bảng điểm"] button').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS metadata: tatami, athlete club over team, country fallback, weight, round/match, readonly no lease.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
