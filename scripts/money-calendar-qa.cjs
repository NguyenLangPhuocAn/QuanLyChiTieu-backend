// Read-only evidence: forecasts and widget navigation must never change money.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const session=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/recurring-bills-qa/session.json'),'utf8'));
const owner=JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/widget-categories-qa/session.json'),'utf8'));
const url=new URL(session.databaseUrl);
if(url.hostname!=='127.0.0.1'||!/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname)||owner.userId!==8||owner.walletId!==8)throw Error('Existing isolated QA8 only');
const db=new PrismaClient({datasources:{db:{url:session.databaseUrl}}});
const folder=path.join(__dirname,'../../mobile/qa/evidence/2026-10-30-money-calendar-widget-full');
async function run(){try{
 const stage=process.argv[2];assert.ok(['before','final'].includes(stage));
 const wallet=await db.wallets.findUniqueOrThrow({where:{id:8}});assert.equal(wallet.user_id,8);
 const rows=await db.transactions.findMany({where:{wallet_id:8},select:{id:true,amount:true,category_id:true},orderBy:{id:'asc'}});
 const loans=await db.loan_debts.findMany({where:{user_id:8,deleted_at:null},select:{id:true,type:true,principal_amount:true},orderBy:{id:'asc'}});
 const snapshot=JSON.parse(JSON.stringify({qaUserId:8,walletId:8,balance:Number(wallet.balance),rows,loans}));
 if(stage==='final')assert.deepEqual(snapshot,JSON.parse(fs.readFileSync(path.join(folder,'sql-before.json'),'utf8')));
 fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'sql-'+stage+'.json'),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({stage,balance:snapshot.balance,transactionIds:rows.map(r=>r.id),loanIds:loans.map(l=>l.id),unchanged:stage==='final'}));
}finally{await db.$disconnect();}}
run().catch(()=>{console.error('MONEY_CALENDAR_QA_FAILED (private details suppressed)');process.exitCode=1;});
