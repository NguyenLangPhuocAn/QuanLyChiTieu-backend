const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto'),bcrypt=require('bcrypt'),{PrismaClient}=require('@prisma/client');
const file=path.resolve(__dirname,'../.runtime/widget-offline-qa/session.json');
async function main(){
 const base=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../.runtime/recurring-bills-qa/session.json'),'utf8'));
 const url=new URL(base.databaseUrl);if(url.hostname!=='127.0.0.1'||!/^\/nova_qa_bills_20261026_\d+$/.test(url.pathname))throw Error('QA schema only');
 const db=new PrismaClient({datasources:{db:{url:base.databaseUrl}}});
 try{
  let session;
  if(fs.existsSync(file))session=JSON.parse(fs.readFileSync(file,'utf8'));
  else{
   if(!process.argv.includes('--prepare'))throw Error('Explicit preparation required');
   const password='QaOnly_'+randomBytes(12).toString('hex');
   const user=await db.users.create({data:{email:`qa.widget.${Date.now()}@example.test`,full_name:'Widget ngoại tuyến QA',password:await bcrypt.hash(password,10),role:'PREMIUM',currency_default:'VND',profile_setup_completed:true}});
   const wallet=await db.wallets.create({data:{user_id:user.id,name:'Ví Widget QA',currency:'VND',balance:1000000}});
   await db.categories.createMany({data:[{user_id:user.id,name:'Chi widget QA',type:'EXPENSE',cash_flow_group:'NORMAL',is_system:false},{user_id:user.id,name:'Thu widget QA',type:'INCOME',cash_flow_group:'NORMAL',is_system:false}]});
   session={...base,userId:user.id,email:user.email,password,walletId:wallet.id};fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(session));
  }
  if(!/^qa\.widget\.\d+@example\.test$/.test(session.email))throw Error('QA identity only');
  if(process.argv.includes('--prepare'))await db.users.updateMany({where:{id:session.userId,email:session.email},data:{role:'PREMIUM'}});
  const wallet=await db.wallets.findUniqueOrThrow({where:{id:session.walletId}});if(wallet.user_id!==session.userId)throw Error('Wrong owner');
  const rows=await db.transactions.findMany({where:{wallet_id:wallet.id},orderBy:{id:'asc'}});
  console.log(JSON.stringify({fixture:'widget-offline',userId:session.userId,walletId:wallet.id,transactions:rows.map(r=>({id:r.id,amount:Number(r.amount),note:r.note,date:r.transaction_date.toISOString()})),count:rows.length,balance:Number(wallet.balance),qaOnly:true}));
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('WIDGET_QA_FAILED (private details suppressed)');process.exitCode=1;});
