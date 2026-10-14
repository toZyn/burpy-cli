import {defaultSettings} from './settings.js';
import {readFile,writeFile,realpath,lstat,readdir,rename,unlink} from 'node:fs/promises';
import {resolve,relative,dirname,basename,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
const fn=(name,description,properties,required=Object.keys(properties))=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const string={type:'string'};
export const workspaceTools=[
 fn('read','Lee un archivo UTF-8 de hasta 200000 bytes. Usa offset (línea inicial, desde 1) y limit para lecturas específicas. Predeterminado 200 líneas, máximo 2000; continúa con next_offset si hay más.',{path:string,offset:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:2000}},['path']),
 fn('create','Crea un archivo nuevo; falla si ya existe.',{path:string,content:string}),
 fn('write','Escribe o reemplaza un archivo completo. Prefiere edit para modificar partes.',{path:string,content:string}),
 fn('edit','Reemplaza un fragmento literal único, sin reescribir el contenido restante. old_text debe coincidir exactamente una vez.',{path:string,old_text:string,new_text:string}),
 fn('grep','Busca texto literal en los archivos del workspace. Omite binarios, dependencias y directorios ocultos. Devuelve hasta 100 coincidencias.',{pattern:string,path:string},['pattern']),
 fn('list_files','Lista nombres y tipos de entradas de una carpeta del workspace.',{path:string},[]),
 fn('system_info','Consulta plataforma, CPUs y memoria total/libre del equipo.',{},[]),
 fn('bash','Ejecuta bash. timeout es opcional, en milisegundos, solo para esta llamada; no modifica la configuración. No ejecutes procesos persistentes.',{command:string,timeout:{type:'integer',minimum:100,maximum:600000}},['command'])
];
export async function workspaceRunner(root=process.cwd(),approve=async()=>false,settings=defaultSettings(),onOutput=()=>{}){
 root=await realpath(root);
 const grants=new Set(),approvals=new Map(),changes=new Map();
 async function permission(request,scope,signal){
  if(grants.has(scope))return true;
  if(!approvals.has(scope)){const pending=Promise.resolve().then(()=>approve({...request,scope},signal)).then(allowed=>{if(allowed)grants.add(scope);return allowed;});approvals.set(scope,pending);void pending.finally(()=>{if(approvals.get(scope)===pending)approvals.delete(scope);}).catch(()=>{});}
  const allowed=await approvals.get(scope);signal?.throwIfAborted();return allowed;
 }
 const within=p=>{const rel=relative(root,p);return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!rel.startsWith(sep));};
 async function pathFor(value,allowNew=false){
  if(typeof value!=='string'||value.includes('\0')||value.length>4096)throw Error('path inválido');
  const path=resolve(root,value),outside=!within(path);
  const parts=(outside?path:relative(root,path)).split(sep).filter(Boolean);let ancestor=outside?sep:root;
  for(const part of parts.slice(0,-1)){ancestor=resolve(ancestor,part);if((await lstat(ancestor)).isSymbolicLink())throw Error('No se permiten enlaces simbólicos');}
  try{const stat=await lstat(path);if(stat.isSymbolicLink())throw Error('No se permiten enlaces simbólicos');return await realpath(path);}catch(error){if(error.code!=='ENOENT'||!allowNew)throw error;const parent=await realpath(dirname(path));return resolve(parent,basename(path));}

 }
 async function textAt(path){const stat=await lstat(path);if(!stat.isFile()||stat.size>200000)throw Error('Se requiere un archivo de hasta 200000 bytes');const data=await readFile(path);if(data.length>200000)throw Error('Archivo demasiado grande (máximo 200000 bytes)');if(data.includes(0))throw Error('Archivo binario');return data.toString('utf8');}
 async function commit(path,content){
  if(typeof content!=='string'||Buffer.byteLength(content)>200000)throw Error('content debe ser texto de hasta 200000 bytes');
  const tmp=resolve(dirname(path),`.burpy-${randomUUID()}.tmp`);
  let mode=0o600;try{mode=(await lstat(path)).mode&0o777;}catch{}
  try{await writeFile(tmp,content,{flag:'wx',mode});await rename(tmp,path);}finally{await unlink(tmp).catch(()=>{});}
 }
 const run=async(name,args,signal,_activate,outputForCall)=>{
  signal?.throwIfAborted();
  if(settings.plan&&['create','write','edit','bash'].includes(name))throw Error('Modo plan: solo inspección; usa /build para permitir cambios y comandos');
  if(['read','create','write','edit','list_files','grep'].includes(name)){
   const target=resolve(root,args.path||'.'),outside=!within(target),mutation=['create','write','edit'].includes(name);
   if(outside||(mutation&&!settings.auto)){
    if(!await permission({tool:name,path:target,outside,mutation},outside?`external:${dirname(target)}`:'workspace:write',signal))throw Error(`Permiso rechazado${outside?' fuera del workspace':''}`);
    signal?.throwIfAborted();
   }
  }
  if(name==='system_info')return {platform:os.platform(),architecture:os.arch(),cpus:os.cpus().length,total_memory_bytes:os.totalmem(),free_memory_bytes:os.freemem(),workspace:root};
  if(name==='read'){const offset=args.offset??1,limit=args.limit??200;if(!Number.isInteger(offset)||offset<1||!Number.isInteger(limit)||limit<1||limit>2000)throw Error('offset y limit inválidos');const text=await textAt(await pathFor(args.path)),lines=text.split('\n'),selected=lines.slice(offset-1,offset-1+limit);return {path:args.path,content:selected.join('\n'),offset,lines:selected.length,total_lines:lines.length,...(offset-1+limit<lines.length?{next_offset:offset+limit}:{})};}
  if(name==='create'){const path=await pathFor(args.path,true);if(typeof args.content!=='string'||Buffer.byteLength(args.content)>200000)throw Error('content inválido');await writeFile(path,args.content,{flag:'wx',mode:0o600});recordChange(path,'',args.content);return {created:args.path};}
  if(name==='write'){const path=await pathFor(args.path,true);let before='';try{before=await textAt(path);}catch(e){if(e.code!=='ENOENT')throw e;}await commit(path,args.content);recordChange(path,before,args.content);return {written:args.path};}
  if(name==='edit'){
   const path=await pathFor(args.path),text=await textAt(path);
   if(typeof args.old_text!=='string'||!args.old_text||typeof args.new_text!=='string')throw Error('old_text y new_text obligatorios');
   const index=text.indexOf(args.old_text);if(index<0)throw Error('old_text no coincide');if(text.indexOf(args.old_text,index+1)>=0)throw Error('old_text coincide varias veces; proporciona un fragmento único');
   const after=text.slice(0,index)+args.new_text+text.slice(index+args.old_text.length);await commit(path,after);recordChange(path,text,after);return {edited:args.path,replacements:1};
  }
  if(name==='list_files'){const path=await pathFor(args.path||'.');return {entries:(await readdir(path,{withFileTypes:true})).slice(0,200).map(e=>({name:e.name,type:e.isDirectory()?'directory':e.isSymbolicLink()?'symlink':'file'}))};}
  if(name==='grep'){
   if(typeof args.pattern!=='string'||!args.pattern||args.pattern.length>1000)throw Error('pattern inválido');
   const start=await pathFor(args.path||'.'),matches=[],skipped=[];let files=0,nodes=0;
   async function visit(path){signal?.throwIfAborted();if(files>=500||matches.length>=100||nodes++>=2000)return;const stat=await lstat(path);if(stat.isSymbolicLink())return;if(stat.isDirectory()){for(const e of await readdir(path,{withFileTypes:true})){if(e.name.startsWith('.')||['node_modules','vendor','dist'].includes(e.name))continue;await visit(resolve(path,e.name));}}else if(stat.isFile()){files++;try{const text=await textAt(path);for(const [i,line] of text.split('\n').entries())if(line.includes(args.pattern)&&matches.length<100)matches.push({path:relative(root,path),line:i+1,text:line.slice(0,500)});}catch{skipped.push(relative(root,path));}}}
   await visit(start);return {matches,files_scanned:files,truncated:files>=500||matches.length>=100||nodes>=2000,skipped};
  }
  if(name==='bash'){
   if(typeof args.command!=='string'||!args.command.trim()||args.command.length>12000)throw Error('command inválido');
   const timeout=args.timeout??settings.bash_ms;
   if(!Number.isInteger(timeout)||timeout<100||timeout>600000)throw Error('timeout debe estar entre 100 y 600000 ms');
   const allowed=await permission({tool:name,command:args.command,outside:true},'bash:session',signal);signal?.throwIfAborted();if(!allowed)return {denied:true,message:'Usuario rechazó la ejecución'};
   return new Promise((resolveResult,reject)=>{
    const env={PATH:process.env.PATH,HOME:os.homedir(),LANG:process.env.LANG||'C.UTF-8',TERM:'dumb',TMPDIR:os.tmpdir()};
    const child=spawn('bash',['-lc',args.command],{cwd:root,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    let output='',bytes=0,truncated=false,timedOut=false;
    const kill=()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
    const timer=setTimeout(()=>{timedOut=true;kill();},timeout),abort=()=>kill();signal?.addEventListener('abort',abort,{once:true});
    const collect=chunk=>{bytes+=chunk.length;if(bytes>settings.output_bytes){truncated=true;kill();return;}const text=chunk.toString('utf8');output+=text;(outputForCall||onOutput)({tool:name,text});};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.on('error',e=>{cleanup();reject(e);});child.on('close',(code,termSignal)=>{cleanup();if(signal?.aborted)reject(Error('Comando cancelado'));else resolveResult({exit_code:code,signal:termSignal,output,truncated,timed_out:timedOut,timeout});});
   });
  }
  throw Error('Herramienta no disponible');
 };
 function recordChange(path,before,after){if(changes.size>=100&&!changes.has(path))return;changes.set(path,{path,before:changes.get(path)?.before??before,after});}
 run.changes=()=>[...changes.values()].filter(c=>c.before!==c.after).map(c=>{const before=c.before?c.before.split('\n'):[],after=c.after?c.after.split('\n'):[];let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;let endOld=before.length,endNew=after.length;while(endOld>start&&endNew>start&&before[endOld-1]===after[endNew-1]){endOld--;endNew--;}return {path:relative(root,c.path),added:endNew-start,removed:endOld-start,preview:[...before.slice(start,endOld).map(l=>'− '+l),...after.slice(start,endNew).map(l=>'+ '+l)].join('\n').slice(0,20000)};});
 run.revoke=scope=>scope?grants.delete(scope):grants.clear();run.permissions=()=>[...grants];return run;
}
