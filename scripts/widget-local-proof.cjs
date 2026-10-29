const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const folder=path.resolve(__dirname,'../.runtime/widget-offline-qa');
const session=JSON.parse(fs.readFileSync(path.join(folder,'session.json'),'utf8'));
if(!/^qa\.widget\.\d+@example\.test$/.test(session.email))throw Error('QA only');
const adb=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const local=path.join(folder,'local-proof-db');fs.mkdirSync(local,{recursive:true});
try{
 for(const name of ['AsyncStorage','AsyncStorage-wal','AsyncStorage-shm']){
  try{fs.writeFileSync(path.join(local,name),execFileSync(adb,['-s','emulator-5554','exec-out','run-as','com.mobile.dev','cat','databases/'+name],{windowsHide:true,stdio:['pipe','pipe','ignore']}));}catch{ }
 }
 const python='C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
 const code=`import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);values=dict(c.execute('SELECT key,value FROM Storage'));auth=json.loads(values.get('quan_ly_chi_tieu_auth_session','{}'));drafts=json.loads(values.get('quan_ly_chi_tieu_offline_transactions_v1_'+sys.argv[2],'[]'));cache=json.loads(values.get('quan_ly_chi_tieu_local_data_'+sys.argv[2],'{}'));print(json.dumps({'userId':auth.get('user',{}).get('id'),'hasProfile':bool(auth.get('user')),'hasSession':bool(auth.get('accessToken')),'server':auth.get('server'),'pending':len(drafts),'statuses':[x.get('status') for x in drafts],'cachedCategories':len(cache.get('categories',[])),'draftServerBound':all(x.get('server')==auth.get('server') for x in drafts)}));c.close()`;
 const result=JSON.parse(execFileSync(python,['-c',code,path.join(local,'AsyncStorage'),String(session.userId)],{encoding:'utf8',windowsHide:true}));
 if(result.userId!==session.userId)throw Error('Wrong app QA identity');
 console.log(JSON.stringify({...result,qaOnly:true,tokensAndNotesIncluded:false}));
}catch{console.error('LOCAL_PROOF_UNAVAILABLE');process.exitCode=1;}
finally{for(const name of ['AsyncStorage','AsyncStorage-wal','AsyncStorage-shm']){const p=path.join(local,name);if(fs.existsSync(p))fs.unlinkSync(p);}}
