// Synthetic local QA only. Never migrates, resets, or connects to production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto'),bcrypt=require('bcrypt'),jwt=require('jsonwebtoken');
const {PrismaClient}=require('@prisma/client');
const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/recurring-bills-qa/session.json'),'utf8'));
const url=new URL(original.databaseUrl);
if(url.hostname!=='127.0.0.1'||!/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname))throw Error('Isolated local QA schema only');
const privateFolder=path.join(__dirname,'../.runtime/quarterly-bills-qa'),target=path.join(privateFolder,'session.json');
const folder=path.join(__dirname,'../../mobile/qa/evidence/2026-11-02-quarterly-bills');
fs.mkdirSync(privateFolder,{recursive:true});fs.mkdirSync(folder,{recursive:true});
if(process.argv[2]==='serve'){
  Object.assign(process.env,{DATABASE_URL:original.databaseUrl,JWT_SECRET:original.jwtSecret,PORT:'3304',HOST:'127.0.0.1',GEMINI_API_KEY:'',FEATURE_BANK_NOTIFICATION_AI:'false',MAIL_HOST:'',SMTP_HOST:'',VNPAY_TMN_CODE:'',VNPAY_HASH_SECRET:''});
  require('ts-node/register/transpile-only');require('../src/main.ts');
}else{
 const db=new PrismaClient({datasources:{db:{url:original.databaseUrl}}});
 const save=(name,value)=>fs.writeFileSync(path.join(folder,name),JSON.stringify(value,null,2)+'\n');
 const request=async(route,method='GET',body,id)=>{
   const r=await fetch('http://127.0.0.1:3304'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({userId:id},original.jwtSecret,{expiresIn:'1h'})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:r.status,body:await r.json()};
 };
 const money=async s=>JSON.parse(JSON.stringify({wallet:await db.wallets.findUniqueOrThrow({where:{id:s.walletId},select:{id:true,user_id:true,balance:true}}),transactions:await db.transactions.findMany({where:{wallet_id:s.walletId},orderBy:{id:'asc'}})}));
 (async()=>{try{
   const mode=process.argv[2];
   if(mode==='prepare'&&!fs.existsSync(target)){
     const password='QaOnly_'+randomBytes(12).toString('hex'),stamp=Date.now();
     const user=await db.users.create({data:{email:`qa.quarterly.${stamp}@example.test`,full_name:'Hóa đơn quý QA',password:await bcrypt.hash(password,10),role:'BASIC',currency_default:'VND',profile_setup_completed:true}});
     const apiUser=await db.users.create({data:{email:`qa.quarterly.api.${stamp}@example.test`,full_name:'Đồng bộ quý QA',password:await bcrypt.hash(randomBytes(24).toString('hex'),10),role:'BASIC',currency_default:'VND',profile_setup_completed:true}});
     const wallet=await db.wallets.create({data:{user_id:user.id,name:'Ví hóa đơn quý QA',currency:'VND',balance:5000000}});
     const category=await db.categories.create({data:{user_id:user.id,name:'Hóa đơn QA',type:'EXPENSE',cash_flow_group:'NORMAL',is_system:false}});
     fs.writeFileSync(target,JSON.stringify({databaseUrl:original.databaseUrl,userId:user.id,apiUserId:apiUser.id,walletId:wallet.id,categoryId:category.id,email:user.email,password,jwtSecret:original.jwtSecret}));
   }
   const s=JSON.parse(fs.readFileSync(target,'utf8'));
   assert.match(s.email,/^qa\.quarterly\.\d+@example\.test$/);
   assert.equal((await db.users.findUniqueOrThrow({where:{id:s.userId}})).email,s.email);
   if(mode==='prepare'){
     const fixtures=[
       ['2026-01-31','Internet FPT',300000],['2026-04-30','Cuoc FPT Telecom Internet',330000],['2026-10-31','Thanh toan FPT Internet',300000],
       ['2026-07-05','Music QA',45000],['2026-08-05','Music QA',45000],['2026-10-05','Music QA',45000],
       ['2026-07-01','Netflix goi 1',89000],['2026-08-01','Netflix goi 1',89000],['2026-09-01','Netflix goi 2',89000],['2026-10-01','Netflix goi 2',89000],
       ['2026-07-01','Hoa Lan',100000],['2026-08-01','Hoa Lan',100000],['2026-09-01','Lan Hoa',100000],['2026-10-01','Lan Hoa',100000],
     ];
     for(let i=0;i<fixtures.length;i++){
       const [date,note,amount]=fixtures[i];
       const r=await request('/transactions','POST',{wallet_id:s.walletId,category_id:s.categoryId,amount:String(amount),type:'EXPENSE',note,transaction_date:date,client_request_id:'qa_quarterly_20261102_'+s.userId+'_'+i},s.userId);
       assert.ok([200,201].includes(r.status));
     }
     if(!fs.existsSync(path.join(folder,'sql-before.json')))save('sql-before.json',await money(s));
     const r=await request('/transactions?page=1&limit=100&type=EXPENSE&cash_flow=normal','GET',null,s.userId);
     assert.equal(r.status,200);assert.equal(r.body.meta.total,14);save('history-api.json',r.body);
     save('fixture.json',{userId:s.userId,walletId:s.walletId,transactions:14,synthetic:true});
   }else if(mode==='api'){
     const bill={id:'qa_quarter',label:'Cloud quý QA',cycle:'QUARTERLY',anchorDate:'2026-01-31',startDate:'2027-01-31',kind:'FIXED',minAmount:300000,maxAmount:300000,currency:'VND',note:'',paused:false,archived:false};
     const snapshot={version:1,book:{version:1,bills:[bill],periods:[{billId:bill.id,dueDate:'2027-04-30',status:'SKIPPED'}],suggestions:[{key:'bill-suggest:v1:VND:QUARTERLY:fpt internet',status:'TRACKED',billId:bill.id}]},plans:[]};
     const get=await request('/planning-sync','GET',null,s.apiUserId);assert.equal(get.status,200);
     const put=await request('/planning-sync','PUT',{revision:get.body.revision,snapshot},s.apiUserId);assert.equal(put.status,200);
     const replay=await request('/planning-sync','PUT',{revision:get.body.revision,snapshot},s.apiUserId);assert.equal(replay.status,200);assert.equal(replay.body.revision,put.body.revision);
     const bad=JSON.parse(JSON.stringify(snapshot));bad.book.periods[0].dueDate='2027-02-28';
     const invalid=await request('/planning-sync','PUT',{revision:put.body.revision,snapshot:bad},s.apiUserId);assert.equal(invalid.status,400);
     const roundtrip=await request('/planning-sync','GET',null,s.apiUserId);assert.deepEqual(roundtrip.body.snapshot,snapshot);
     save('api-results.json',{quarterlyRoundtrip:200,identicalReplay:200,nonQuarterPeriod:400,metadataOnly:true,realMySQL:true});
   }else if(mode==='final'){
     const after=await money(s);assert.deepEqual(after,JSON.parse(fs.readFileSync(path.join(folder,'sql-before.json'),'utf8')));save('sql-final.json',after);
   }else throw Error('Unknown QA mode');
   console.log(JSON.stringify({mode,qaUserId:s.userId,productionUntouched:true}));
 }finally{await db.$disconnect();}})().catch(e=>{console.error(JSON.stringify({error:'QUARTERLY_QA_FAILED',code:e.code||e.name}));process.exitCode=1;});
}
