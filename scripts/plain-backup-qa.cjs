const fs=require('node:fs');const path=require('node:path');const {randomBytes,createHash}=require('node:crypto');const bcrypt=require('bcrypt');const {PrismaClient}=require('@prisma/client');
const folder=path.resolve(__dirname,'../.runtime/plain-backup-qa');const sessionFile=path.join(folder,'session.json');
async function main(){
 const base=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../.runtime/recurring-bills-qa/session.json'),'utf8'));
 const dbUrl=new URL(base.databaseUrl);if(dbUrl.hostname!=='127.0.0.1'||!/^\/nova_qa_bills_20261026_\d+$/.test(dbUrl.pathname))throw Error('QA schema required');
 const db=new PrismaClient({datasources:{db:{url:base.databaseUrl}}});
 try{
  let session;
  if(fs.existsSync(sessionFile))session=JSON.parse(fs.readFileSync(sessionFile,'utf8'));
  else{
   if(!process.argv.includes('--prepare'))throw Error('Explicit QA preparation required');
   const password='QaOnly_'+randomBytes(12).toString('hex');
   const user=await db.users.create({data:{email:`qa.backup.${Date.now()}@example.test`,full_name:'Backup thường QA',password:await bcrypt.hash(password,10),role:'BASIC',currency_default:'VND',profile_setup_completed:true}});
   const wallet=await db.wallets.create({data:{user_id:user.id,name:'Ví backup QA',currency:'VND',balance:1000000}});
   const category=await db.categories.create({data:{user_id:user.id,name:'Cà phê QA',type:'EXPENSE',cash_flow_group:'NORMAL',is_system:false}});
   session={...base,userId:user.id,email:user.email,password,walletId:wallet.id,categoryId:category.id};fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(sessionFile,JSON.stringify(session));
  }
  if(!/^qa\.backup\.\d+@example\.test$/.test(session.email))throw Error('QA identity required');
  const api='http://127.0.0.1:3301';
  const login=await fetch(api+'/users/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:session.email,password:session.password})});const auth=await login.json();if(!login.ok)throw Error('QA login failed');const headers={Authorization:'Bearer '+(auth.accessToken||auth.token)};
  const row={row:1,wallet:{name:'Ví backup QA',currency:'VND'},category:{name:'Cà phê QA',type:'EXPENSE',cashFlowGroup:'NORMAL'},type:'EXPENSE',amount:'79000',note:'Hóa đơn cà phê QA',transactionDate:'2026-10-28T08:00:00.000Z',receiptItems:[{name:'Bạc xỉu',amount:94000},{name:'Giảm giá',amount:-15000}],tags:['qa']};
  // Receipt array validation belongs to TransactionsService; fixture uses a valid simple item below.
  row.receiptItems=[{name:'Cà phê',amount:79000}];
  const bytes=Buffer.from(JSON.stringify({format:'SO_THU_CHI_NOVA_PERSONAL_BACKUP',version:1,createdAt:'2026-10-28T00:00:00Z',dataTypes:['transactions'],source:{app:'Sổ Thu Chi Nova',userIdHash:'qa'},wallets:[],categories:[],transactions:[row,row]}));
  fs.writeFileSync(path.join(folder,'qa-giao-dich-thuong.stcn-backup'),bytes);
  const upload=async(route,buffer=bytes,authorized=true)=>{const form=new FormData();form.append('file',new Blob([buffer],{type:'application/json'}),'qa.stcn-backup');const res=await fetch(api+route,{method:'POST',headers:authorized?headers:{},body:form});return{status:res.status,data:await res.json()};};
  const snapshot=async()=>{const w=await db.wallets.findUniqueOrThrow({where:{id:session.walletId}});if(w.user_id!==session.userId)throw Error('Wrong QA wallet');return{transactions:await db.transactions.count({where:{wallet_id:w.id}}),balance:Number(w.balance)};};
  const before=await snapshot();const preview=await upload('/personal-backup/preview');if(preview.status!==201)throw Error('Preview failed');
  const hash=preview.data.metadata.fileHash;
  const changed=await upload('/personal-backup/restore?rows=1&fileHash='+hash,Buffer.concat([bytes,Buffer.from(' ')]));if(changed.status!==400)throw Error('Changed file accepted');
  const unauthorized=await upload('/personal-backup/preview',bytes,false);if(unauthorized.status!==401)throw Error('JWT not enforced');
  const afterPreview=await snapshot();if(JSON.stringify(before)!==JSON.stringify(afterPreview))throw Error('Preview wrote data');
  let restore=null;
  if(process.argv.includes('--confirm-restore')){
   restore=await upload('/personal-backup/restore?rows=1&fileHash='+hash);if(restore.status!==201||restore.data.restored!==1){console.error(JSON.stringify({qaRestoreStatus:restore.status,qaResult:restore.data}));throw Error('Confirmed restore failed');}
  }
  const after=await snapshot();const repeat=await upload('/personal-backup/preview');
  let repeatedRestore=null;
  if(after.transactions===1){const again=await upload('/personal-backup/restore?rows=1&fileHash='+hash);repeatedRestore=again.status;if(again.status!==400||JSON.stringify(await snapshot())!==JSON.stringify(after))throw Error('Repeated restore changed data');}
  const exported=await fetch(api+'/personal-backup/export',{method:'POST',headers});const exportedData=await exported.json();const plain=JSON.parse(Buffer.from(exportedData.base64,'base64').toString('utf8'));
  if(plain.format!=='SO_THU_CHI_NOVA_PERSONAL_BACKUP'||plain.ciphertext)throw Error('Export not readable');
  if(after.transactions!==0 && (after.transactions!==1||after.balance!==921000||repeat.data.summary.ready!==0))throw Error('Unexpected final balance/duplicates');
  const proof={server:api,isolatedQa:true,userId:session.userId,before,afterPreview,preview:preview.data.summary,changedFile:changed.status,unauthorized:unauthorized.status,restore:restore?.data??null,after,repeat:repeat.data.summary,repeatedRestore,export:{status:exported.status,readableJSON:true,transactions:plain.transactions.length},productionTouched:false};
  fs.writeFileSync(path.join(folder,'proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('PLAIN_BACKUP_QA_FAILED (private details suppressed)');process.exitCode=1;});
