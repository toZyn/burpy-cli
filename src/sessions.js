import {mkdir,readFile,writeFile,rename,unlink,readdir,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
export async function sessionStore(workspace=process.cwd(),base=process.env.BURPY_DATA_DIR||join(process.env.XDG_STATE_HOME||join(homedir(),'.local','state'),'burpy')){
 workspace=await realpath(workspace);const directory=resolve(base,createHash('sha256').update(workspace).digest('hex').slice(0,24));await mkdir(directory,{recursive:true,mode:0o700});let queue=Promise.resolve();
 const validId=id=>typeof id==='string'&&/^[a-f0-9-]{8,36}$/.test(id);
 async function atomic(file,data){const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,data,{flag:'wx',mode:0o600});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}}
 const fresh=()=>({schema:1,id:randomUUID(),workspace,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[],apiHistory:[],todos:[],children:[],compactions:0,inputHistory:[],tokenCount:0,usageKnown:false});
 async function load(id){if(!validId(id))throw Error('ID de sesión inválido');const raw=await readFile(join(directory,id+'.json'),'utf8');if(Buffer.byteLength(raw)>30000000)throw Error('Sesión demasiado grande');const data=JSON.parse(raw);if(data.schema!==1||data.id!==id||data.workspace!==workspace||!Array.isArray(data.messages)||!Array.isArray(data.apiHistory)||!Array.isArray(data.todos)||!Array.isArray(data.inputHistory)||data.messages.some(m=>!m||typeof m.text!=='string'||!['user','assistant','tool'].includes(m.role)))throw Error('Sesión inválida');return data;}
 function save(snapshot,secret=''){
  if(!validId(snapshot.id))return Promise.reject(Error('ID de sesión inválido'));
  const state={schema:1,id:snapshot.id,workspace,model:snapshot.model,providerId:snapshot.providerId,createdAt:snapshot.createdAt,updatedAt:new Date().toISOString(),messages:snapshot.messages,apiHistory:snapshot.apiHistory,todos:snapshot.todos,children:snapshot.children||[],compactions:snapshot.compactions||0,contextUsage:snapshot.contextUsage,inputHistory:snapshot.inputHistory,tokenCount:snapshot.tokenCount,usageKnown:snapshot.usageKnown},raw=JSON.stringify(state,(_key,value)=>typeof value==='string'?(Array.isArray(secret)?secret:[secret]).filter(Boolean).reduce((text,key)=>text.split(key).join('[oculto]'),value):value);
  const task=queue.catch(()=>{}).then(async()=>{await atomic(join(directory,state.id+'.json'),raw);await atomic(join(directory,'latest.json'),JSON.stringify({id:state.id}));});queue=task;return task;
 }
 async function latest(){try{const pointer=JSON.parse(await readFile(join(directory,'latest.json'),'utf8'));return await load(pointer.id);}catch(error){if(error.code==='ENOENT')return null;throw Error(`No se pudo recuperar la sesión: ${error.message}`);}}
 async function list(){const result=[];for(const file of await readdir(directory)){const id=file.replace(/\.json$/,'');if(!file.endsWith('.json')||!validId(id))continue;try{const s=await load(id);result.push({id:s.id,updatedAt:s.updatedAt,title:s.messages.find(m=>m.role==='user')?.text.slice(0,80)||'Sesión nueva',messages:s.messages.length});}catch{}}return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 async function find(prefix){const matches=(await list()).filter(s=>s.id.startsWith(prefix));if(matches.length!==1)throw Error(matches.length?'ID ambiguo':'Sesión no encontrada');return load(matches[0].id);}
 return {fresh,load,save,latest,list,find,directory,flush:()=>queue};
}
