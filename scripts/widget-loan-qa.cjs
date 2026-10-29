// Read existing QA8 only. --replay resends only already-created widget loans.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/recurring-bills-qa/session.json'),'utf8'));
const owner=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/widget-categories-qa/session.json'),'utf8'));
const url=new URL(base.databaseUrl);
if(url.hostname!=='127.0.0.1'||!/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)||owner.userId!==8||owner.walletId!==8||!/^qa\.widgetcategories\.\d+@example\.test$/.test(owner.email))throw Error('QA scope required');
const db=new PrismaClient({datasources:{db:{url:base.databaseUrl}}});
const output=path.join(__dirname,'../../mobile/qa/evidence/2026-10-30-widget-loan');
async function snapshot(){
 const wallet=await db.wallets.findUniqueOrThrow({where:{id:8}});assert.equal(wallet.user_id,8);
 const loans=await db.loan_debts.findMany({where:{user_id:8,deleted_at:null},select:{id:true,type:true,person_name:true,principal_amount:true,opening_wallet_id:true,opening_transaction_id:true,due_date:true,note:true},orderBy:{id:'asc'}});
 const rows=await db.transactions.findMany({where:{wallet_id:8},select:{id:true,amount:true,currency:true,category_id:true,transaction_date:true,receipt_image:true},orderBy:{id:'asc'}});
 const categories=await db.categories.findMany({where:{id:{in:rows.map(r=>r.category_id).filter(Boolean)}},select:{id:true,name:true,cash_flow_group:true}});
 return {qaUserId:8,walletId:8,balance:Number(wallet.balance),loans,rows,categories};
}
const request=async(route,token,body)=>{
 const response=await fetch('http://127.0.0.1:3302'+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 return {status:response.status,body:await response.json()};
};
async function main(){try{
 const stage=process.argv[2];if(!['before','borrowed','lent','final'].includes(stage))throw Error('QA stage required');
 const before=await snapshot();
 let replay;
 if(process.argv.includes('--replay')){
  const login=await request('/users/login',null,{email:owner.email,password:owner.password});
  if(login.status!==201&&login.status!==200)throw Error('QA_LOGIN_FAILED');
  const token=login.body.accessToken||login.body.token;if(!token)throw Error('QA_TOKEN_MISSING');
  const selected=before.loans.filter(l=>['Widget Vay QA','Widget Cho vay QA'].includes(l.person_name));
  assert.equal(selected.length,2);
  const checks=[];
  for(const loan of selected){
   const marker=await db.notifications.findFirst({where:{user_id:8,source_id:loan.id,source_type:'CLIENT_LOAN_DEBT_REQUEST'}});
   if(!marker?.dedupe_key.startsWith('loan_client:'))throw Error('QA_MARKER_MISSING');
   const row=before.rows.find(r=>r.id===loan.opening_transaction_id);if(!row)throw Error('QA_OPENING_MISSING');
   const body={person_name:loan.person_name,type:loan.type,principal_amount:String(loan.principal_amount),wallet_id:8,transaction_date:row.transaction_date.toISOString().slice(0,10),due_date:loan.due_date?.toISOString().slice(0,10)||null,note:loan.note||undefined,client_request_id:marker.dedupe_key.slice('loan_client:'.length)};
   const repeated=await Promise.all([request('/loan-debts/quick-entry',token,body),request('/loan-debts/quick-entry',token,body)]);
   assert.ok(repeated.every(r=>[200,201].includes(r.status)&&r.body.id===loan.id));
   const changed=await request('/loan-debts/quick-entry',token,{...body,principal_amount:String(Number(loan.principal_amount)+1)});assert.equal(changed.status,409);
   const missing={...body};delete missing.client_request_id;
   const noKey=await request('/loan-debts/quick-entry',token,missing);assert.equal(noKey.status,400);
   checks.push({loanId:loan.id,replayedIds:repeated.map(r=>r.body.id),changedStatus:changed.status,missingKeyStatus:noKey.status});
  }
  const after=await snapshot();assert.deepEqual(after,before);
  replay={checks,rowsAndBalancesUnchanged:true};
 }
 const result={...(await snapshot()),...(replay?{replay}:{})};
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'sql-'+stage+'.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({stage,balance:result.balance,loanIds:result.loans.map(l=>l.id),transactionIds:result.rows.map(r=>r.id),replayPassed:!!replay}));
}finally{await db.$disconnect();}}
main().catch(()=>{console.error('WIDGET_LOAN_QA_FAILED (private details suppressed)');process.exitCode=1;});
