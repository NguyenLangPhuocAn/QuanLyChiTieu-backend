const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client'),jwt=require('jsonwebtoken');
const owner=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/widget-categories-qa/session.json'),'utf8'));
const session=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/recurring-bills-qa/session.json'),'utf8'));
const url=new URL(session.databaseUrl);
if(url.hostname!=='127.0.0.1'||!/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)||owner.userId!==8||!/^qa\.widgetcategories\.\d+@example\.test$/.test(owner.email))throw Error('Isolated QA8 only');
const db=new PrismaClient({datasources:{db:{url:session.databaseUrl}}});
const folder=path.join(__dirname,'../../mobile/qa/evidence/2026-11-02-repeat-transaction');
const call=async(body)=>{const r=await fetch('http://127.0.0.1:3303/transactions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({userId:8},session.jwtSecret,{expiresIn:'1h'})},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
const snapshot=async()=>JSON.parse(JSON.stringify({wallet:await db.wallets.findUniqueOrThrow({where:{id:8},select:{id:true,user_id:true,balance:true}}),rows:await db.transactions.findMany({where:{wallet_id:8},orderBy:{id:'asc'}})}));
const save=(name,value)=>fs.writeFileSync(path.join(folder,name),JSON.stringify(value,null,2)+'\n');
(async()=>{try{
 assert.equal((await db.users.findUniqueOrThrow({where:{id:8}})).email,owner.email);fs.mkdirSync(folder,{recursive:true});
 const stage=process.argv[2];
 if(stage==='prepare'){
  if(fs.existsSync(path.join(folder,'sql-before.json'))){console.log('Existing QA baseline retained.');return;}
  save('sql-before-fixture.json',await snapshot());
  const category=await db.categories.findFirstOrThrow({where:{user_id:8,type:'EXPENSE',cash_flow_group:'NORMAL',name:'Ăn uống'}});
  const created=await call({wallet_id:8,category_id:category.id,amount:'79000',type:'EXPENSE',note:'Ca phe nhap lai QA',transaction_date:'2026-11-02',receipt_items:[{name:'Bac xiu (2)',amount:94000}],tags:['QA'],client_request_id:'qa_repeat_source_20261102_8'});
  assert.ok([200,201].includes(created.status));save('source.json',{id:created.body.id,categoryId:category.id,amount:79000});save('sql-before.json',await snapshot());
 }else if(stage==='final'||stage==='preview'){
  const before=JSON.parse(fs.readFileSync(path.join(folder,'sql-before.json'))),after=await snapshot(),source=JSON.parse(fs.readFileSync(path.join(folder,'source.json')));
  for(const old of before.rows)assert.deepEqual(after.rows.find(r=>r.id===old.id),old);
  if(stage==='preview'){assert.deepEqual(after,before);save('sql-preview.json',after);}
  else{
   const extra=after.rows.filter(r=>!before.rows.some(old=>old.id===r.id));assert.equal(extra.length,1);assert.equal(Number(extra[0].amount),-79000);assert.equal(Number(after.wallet.balance),Number(before.wallet.balance)-79000);
   assert.deepEqual(extra[0].receipt_items,[{name:'Bac xiu (2)',amount:94000}]);assert.equal(extra[0].receipt_image,null);
   const marker=await db.notifications.findFirstOrThrow({where:{user_id:8,source_type:'CLIENT_TRANSACTION_REQUEST',source_id:extra[0].id}});
   const requestId=marker.dedupe_key.replace(/^client:/,'');
   const payload={wallet_id:8,category_id:extra[0].category_id,amount:'79000',type:'EXPENSE',note:extra[0].note,transaction_date:extra[0].transaction_date.slice(0,10),receipt_items:extra[0].receipt_items,tags:['qa'],client_request_id:requestId};
   // Marker prefixes are checked against the service before replay.
   if(!/^[a-zA-Z0-9_-]{16,64}$/.test(requestId))throw Error('Unexpected QA request marker');
   const replay=await Promise.all([call(payload),call(payload)]);assert.ok(replay.every(r=>[200,201].includes(r.status)&&r.body.id===extra[0].id));assert.deepEqual(await snapshot(),after);
   save('sql-final.json',after);save('replay.json',{sourceId:source.id,newId:extra[0].id,replayedIds:replay.map(r=>r.body.id),originalUnchanged:true,noExtraMoney:true});
  }
 }else throw Error('Unknown stage');
 console.log(JSON.stringify({stage,qaUserId:8,sourceUnchanged:true}));
}finally{await db.$disconnect();}})().catch(e=>{console.error(JSON.stringify({error:'REPEAT_QA_FAILED',code:e.code||e.name,location:e.stack?.split('\n').find(l=>l.includes('repeat-transaction-qa.cjs:')), ...(e.code==='ERR_ASSERTION'?{actual:e.actual,expected:e.expected}:{})}));process.exitCode=1;});
