// Read-only DB evidence for the Android widget close-failure QA flow.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/recurring-bills-qa/session.json'),'utf8'));
const owner=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/widget-categories-qa/session.json'),'utf8'));
const url=new URL(base.databaseUrl);
if(url.hostname!=='127.0.0.1'||!/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)||owner.userId!==8||owner.walletId!==8)throw Error('Existing QA8 only');
const db=new PrismaClient({datasources:{db:{url:base.databaseUrl}}});
const output=path.join(__dirname,'../../mobile/qa/evidence/2026-10-30-widget-retry');
async function main(){try{
 const stage=process.argv[2];assert.ok(['before','accepted','final'].includes(stage));
 const wallet=await db.wallets.findUniqueOrThrow({where:{id:8}});assert.equal(wallet.user_id,8);
 const rows=await db.transactions.findMany({where:{wallet_id:8},select:{id:true,amount:true,category_id:true,note:true},orderBy:{id:'asc'}});
 const result={qaUserId:8,walletId:8,balance:Number(wallet.balance),rows};
 if(stage!=='before'){
  const before=JSON.parse(fs.readFileSync(path.join(output,'sql-before.json'),'utf8'));
  const added=rows.filter(r=>!before.rows.some(b=>b.id===r.id));
  assert.equal(added.length,1);assert.equal(added[0].note,'Widget retry QA');
  assert.equal(String(added[0].amount),'-1250');assert.equal(result.balance,before.balance-1250);
  if(stage==='final')assert.deepEqual(JSON.parse(JSON.stringify(result)),JSON.parse(fs.readFileSync(path.join(output,'sql-accepted.json'),'utf8')));
 }
 fs.mkdirSync(output,{recursive:true});
 const target=path.join(output,'sql-'+stage+'.json');
 fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({stage,balance:result.balance,transactionIds:rows.map(r=>r.id)}));
}finally{await db.$disconnect();}}
main().catch(()=>{console.error('WIDGET_RETRY_QA_FAILED (private details suppressed)');process.exitCode=1;});
