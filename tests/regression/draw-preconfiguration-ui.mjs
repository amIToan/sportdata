// Read-only browser checks with mocked API fixtures. Requires Playwright and a running frontend.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DRAW_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.DRAW_CHROME_PATH ? { executablePath: process.env.DRAW_CHROME_PATH } : {}) });
const errors=[];
const event={id:'ui-pre',name:'Pre-matches UI Test',categories:[{id:'cat',name:'Hạng mở',sport:{name:'Test sport'}}],fops:[],startDate:'2026-11-01',endDate:'2026-11-03'};
const entries=['A','B','C','D','E'].map((name,index)=>({id:`entry-${name}`,type:'INDIVIDUAL',status:'VERIFIED',seed:index+1,athlete:{id:name,fullName:`VĐV ${name}`}}));
const preview=[{id:'preview-draw',name:'Preview UI tree',type:'MAIN_TREE',sortOrder:10,bracketSize:8,matches:[{id:'m1',round:1,bracketPosition:0,matchDate:event.startDate,athlete1:entries[0].athlete,athlete2:entries[2].athlete,athlete1Score:0,athlete2Score:0,status:'SCHEDULED',winnerToMatchId:'m2',winnerToSide:'ATHLETE1'},{id:'m2',round:2,bracketPosition:0,matchDate:event.startDate,athlete1Score:0,athlete2Score:0,status:'SCHEDULED'}]}];
let config={pairs:[],revision:0,seedingMode:'STANDARD',stale:true,preview:[]};
let saves=0,privateCalls=0;
let lastPreviewType,lastGeneratedType;
async function pageFor(privileged,count=5,started=false){
 let generated=started;
 let drawVersion=0;
 const pageEntries=Array.from({length:count},(_,index)=>({id:`entry-${String.fromCharCode(65+index)}`,type:'INDIVIDUAL',status:'VERIFIED',seed:index+1,athlete:{id:String.fromCharCode(65+index),fullName:`VĐV ${String.fromCharCode(65+index)}`}}));
 const configurations=new Map();
 const configurationFor=type=>{
  if(!configurations.has(type))configurations.set(type,{pairs:[],revision:0,seedingMode:'STANDARD',groupCount:1,stale:true,preview:[]});
  return configurations.get(type);
 };
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',err=>errors.push(err.message));
 await page.addInitScript(()=>localStorage.setItem('cms_token','test-token'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api','');let body={};
  if(path==='/auth/profile')body={id:privileged?'private-user':'ordinary-user',name:'Test Operator',role:privileged?'ADMIN':'GAMES_ADMIN',permissions:privileged?['DRAW_PRECONFIGURE']:[]};
  else if(path==='/events/ui-pre/admin-detail')body=event;
  else if(path.includes('/entries'))body=pageEntries;
  else if(path.endsWith('/preconfiguration')){
   privateCalls++;
   const type=req.method()==='PATCH'?req.postDataJSON().drawType:url.searchParams.get('drawType');
   config=configurationFor(type);
   if(req.method()==='PATCH'){
    const input=req.postDataJSON();assert.equal(input.revision,config.revision);saves++;
    config={...config,...input,revision:config.revision+1,preview:[],stale:true};
    configurations.set(type,config);
   }
   body=config;
  }else if(path.endsWith('/preview-draw')){
   privateCalls++;const input=req.postDataJSON();lastPreviewType=input.type;config=configurationFor(input.type);
   assert.equal(input.revision,config.revision);
   const usesRoundRobin=input.type==='ROUND_ROBIN_POOL'||(['REPECHAGE','REPECHAGE_ROUND_OF_16'].includes(input.type)&&count<6);
   const currentPreview=preview.map(draw=>({...draw,type:usesRoundRobin?'ROUND_ROBIN_POOL':'MAIN_TREE'}));
   if(input.type==='DOUBLE_ELIMINATION'||(['REPECHAGE','REPECHAGE_ROUND_OF_16'].includes(input.type)&&count>=6))currentPreview.push({...preview[0],id:'secondary',name:'Preview UI secondary',type:input.type,matches:[]});
   config={...config,name:input.name,revision:config.revision+1,stale:false,preview:currentPreview};configurations.set(input.type,config);body=config;
  }else if(path.endsWith('/history')){privateCalls++;body=[];}
  else if(path.endsWith('/draw-state'))body={version:`draw-${drawVersion}`,canRevert:generated&&!started,drawCount:generated?1:0,groupCount:0,matchCount:generated?3:0,reason:started?'Hạng đấu đã có trận bắt đầu hoặc ghi nhận kết quả; không thể thu hồi nhánh.':null};
  else if(path.endsWith('/revert-draw')){
   assert.equal(req.postDataJSON().version,`draw-${drawVersion}`);assert.ok(!started);
   generated=false;drawVersion++;
   for(const [type,current] of configurations)configurations.set(type,{...current,stale:true,preview:[],revision:current.revision+1});
   body={removedDraws:1,removedMatches:3};
  }
  else if(path.endsWith('/generate-draw')){lastGeneratedType=req.postDataJSON().type;generated=true;drawVersion++;body={draws:[]};}
  else if(path.endsWith('/draws'))body={draws:[]};
  else if(path.includes('/registrations'))body=[];
  else if(path.startsWith('/matches'))body={data:[],meta:{total:0}};
  await route.fulfill({status:req.method()==='POST'?201:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(`${process.env.DRAW_UI_URL || 'http://localhost:3000'}/cms/events/ui-pre?tab=bracket`);
 await page.getByRole('button',{name:'Sinh nhánh đấu tự động'}).waitFor();
 return page;
}
try{
 const page=await pageFor(true);
 await page.getByRole('button',{name:'Thêm cặp',exact:true}).click();
 await page.getByRole('combobox',{name:'VĐV thứ nhất cặp 1',exact:true}).fill('VĐV A');
 await page.getByRole('combobox',{name:'VĐV thứ nhất cặp 1',exact:true}).press('Enter');
 assert.equal(saves,0,'Selecting one athlete must not persist an incomplete pair');
 await page.getByRole('combobox',{name:'VĐV thứ hai cặp 1',exact:true}).fill('VĐV C');
 await page.getByRole('combobox',{name:'VĐV thứ hai cặp 1',exact:true}).press('Enter');
 await page.getByText('Đã lưu',{exact:true}).waitFor();
 assert.deepEqual(config.pairs,[{entry1Id:'entry-A',entry2Id:'entry-C'}]);
 assert.equal(saves,1);
 await page.getByRole('button',{name:'Preview cây đấu',exact:true}).click();
 await page.getByText('Preview UI tree',{exact:true}).waitFor();
 await page.locator('.ant-modal-close').click();
 await page.getByRole('button',{name:'Xóa cặp',exact:true}).click();
 await page.getByText('Đã lưu',{exact:true}).waitFor();
 assert.deepEqual(config.pairs,[]);assert.equal(saves,2);
 await page.getByRole('button',{name:'Thêm cặp',exact:true}).click();
 await page.getByRole('combobox',{name:'VĐV thứ nhất cặp 1',exact:true}).fill('VĐV B');
 await page.getByRole('combobox',{name:'VĐV thứ nhất cặp 1',exact:true}).press('Enter');
 await page.getByRole('combobox',{name:'VĐV thứ hai cặp 1',exact:true}).fill('VĐV D');
 await page.getByRole('combobox',{name:'VĐV thứ hai cặp 1',exact:true}).press('Enter');
 await page.getByText('Đã lưu',{exact:true}).waitFor();
 assert.deepEqual(config.pairs,[{entry1Id:'entry-B',entry2Id:'entry-D'}]);
 await page.getByText('Pre-matches · Cặp đặt trước',{exact:true}).click();
 await page.addStyleTag({content:'nextjs-portal { display: none !important; }'});
 await page.evaluate(()=>window.scrollTo(0,0));
 if (process.env.DRAW_SCREENSHOT_PATH) await page.screenshot({path:process.env.DRAW_SCREENSHOT_PATH,fullPage:true});

 const allRules=await pageFor(true,16);
 for(const [title,type] of [['Loại trực tiếp','MAIN_TREE'],['Loại kép','DOUBLE_ELIMINATION'],['Repechage Brackets','REPECHAGE'],['Repechage 1/8','REPECHAGE_ROUND_OF_16'],['Đấu vòng tròn','ROUND_ROBIN_POOL']]){
  await allRules.getByRole('button',{name:new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
  const add=allRules.getByRole('button',{name:'Thêm cặp',exact:true});
  await add.waitFor();
  const pre=await allRules.getByText('Pre-matches · Cặp đặt trước',{exact:true}).boundingBox();
  const rules=await allRules.getByText('2. Chọn thể thức',{exact:true}).boundingBox();
  assert.ok(pre.y<rules.y,`${title}: Pre-matches must precede the rules section`);
  if(!await allRules.getByRole('combobox',{name:'VĐV thứ nhất cặp 1',exact:true}).count()){
   await add.click();
   for(const [label,name] of [['VĐV thứ nhất cặp 1','VĐV A'],['VĐV thứ hai cặp 1','VĐV C']]){
    const select=allRules.getByRole('combobox',{name:label,exact:true});
    await select.fill(name);await select.press('Enter');
   }
   await allRules.getByText('Đã lưu',{exact:true}).waitFor();
  }
  lastPreviewType=undefined;
  await allRules.getByRole('button',{name:'Preview cây đấu',exact:true}).click();
  await allRules.getByText('Preview UI tree',{exact:true}).waitFor();
  assert.equal(lastPreviewType,type,`${title}: preview must use the selected rule`);
  if(type==='ROUND_ROBIN_POOL')assert.equal(await allRules.getByText('Vô địch',{exact:true}).count(),0,'Round robin must show fixtures rather than a knockout champion');
  if(['DOUBLE_ELIMINATION','REPECHAGE','REPECHAGE_ROUND_OF_16'].includes(type))await allRules.getByText('Preview UI secondary',{exact:true}).waitFor();
  await allRules.locator('.ant-modal-close').click();
  lastGeneratedType=undefined;
  const generation=allRules.waitForResponse(response=>response.url().endsWith('/generate-draw')&&response.request().method()==='POST');
  await allRules.getByRole('button',{name:'Sinh nhánh đấu tự động',exact:true}).click();
  await generation;
  assert.equal(lastGeneratedType,type,`${title}: generation must use the selected rule`);
  await allRules.getByRole('button',{name:'Thu hồi nhánh đấu',exact:true}).click();
  const reversion=allRules.waitForResponse(response=>response.url().endsWith('/revert-draw'));
  await allRules.getByRole('button',{name:'Thu hồi nhánh',exact:true}).click();await reversion;
  await allRules.getByRole('button',{name:'Thu hồi nhánh đấu',exact:true}).waitFor({state:'hidden'});
 }
 assert.equal(await allRules.getByRole('button',{name:/Tuyệt đối \/ Open Weight/}).count(),0);
 for (const [label,smallType] of [['Repechage Brackets','REPECHAGE'],['Repechage 1/8','REPECHAGE_ROUND_OF_16']]) {
 const small=await pageFor(true,5);
 await small.getByRole('button',{name:new RegExp(label)}).click();
 await small.getByText('Dưới 6 VĐV: tự động dùng vòng tròn. Cặp đặt trước áp dụng ở lượt đấu đầu.',{exact:true}).waitFor();
 await small.getByRole('button',{name:'Preview cây đấu',exact:true}).click();
 await small.getByText('Preview UI tree',{exact:true}).waitFor();
 assert.equal(lastPreviewType,smallType,'Under-six fallback must retain its own Repechage configuration');
 assert.equal(await small.getByText('Vô địch',{exact:true}).count(),0,'Under-six Repechage must show round-robin fixtures');
 await small.locator('.ant-modal-close').click();
 }
 const tooSmall=await pageFor(true,3);
 await tooSmall.getByRole('button',{name:/Loại kép/}).click();
 await tooSmall.getByText('Pre-matches · Cặp đặt trước',{exact:true}).waitFor();
 assert.equal(await tooSmall.getByRole('button',{name:'Preview cây đấu',exact:true}).isDisabled(),true);
 assert.equal(await tooSmall.getByRole('button',{name:'Sinh nhánh đấu tự động',exact:true}).isDisabled(),true);
 const before=privateCalls;
 const ordinary=await pageFor(false);
 assert.equal(await ordinary.getByText('Pre-matches · Cặp đặt trước',{exact:true}).count(),0);
 assert.equal(await ordinary.getByRole('button',{name:'Preview cây đấu',exact:true}).count(),0);
 assert.equal(privateCalls,before,'Ordinary UI should never load private configuration');
 assert.equal(await ordinary.getByRole('button',{name:'Sinh nhánh đấu tự động',exact:true}).isDisabled(),false);
 const blocked=await pageFor(true,5,true);
 const blockedUndo=blocked.getByRole('button',{name:'Thu hồi nhánh đấu',exact:true});
 await blockedUndo.waitFor();assert.equal(await blockedUndo.isDisabled(),true);
 await blocked.getByText('Hạng đấu đã có trận bắt đầu hoặc ghi nhận kết quả; không thể thu hồi nhánh.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: browser autosaves complete CompetitionEntry pairs and deletion; preview renders; event manager never fetches private data.');
 console.log('PASS: revert confirmation for event managers; revert is disabled once a bout starts.');
 console.log('PASS: all five rules show Pre-matches above the rules, use matching preview/generation types, and handle Repechage under six and double elimination under four.');
}finally{await browser.close();}
