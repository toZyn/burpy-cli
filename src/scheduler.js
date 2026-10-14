import {resolve} from 'node:path';
export function createToolScheduler(execute,workspace=process.cwd()){
 const files=new Map(),waiting=[];let processes=0;
 async function run(name,args,signal,activate,onOutput){signal?.throwIfAborted();let release;if(name==='bash'){if(processes>=4)await new Promise(resolve=>waiting.push(resolve));else processes++;release=()=>{const next=waiting.shift();if(next)next();else processes--;};}try{signal?.throwIfAborted();activate?.();return await execute(name,args,signal,undefined,onOutput);}finally{release?.();}}
 return (name,args,signal,activate,onOutput)=>{
  const key=['read','create','write','edit'].includes(name)?resolve(workspace,args.path||'.'):null;
  if(!key)return run(name,args,signal,activate,onOutput);
  const task=(files.get(key)||Promise.resolve()).catch(()=>{}).then(()=>run(name,args,signal,activate,onOutput));files.set(key,task);
  void task.finally(()=>{if(files.get(key)===task)files.delete(key);}).catch(()=>{});return task;
 };
}
export const batchTool={type:'function',function:{name:'batch',description:'Ejecuta hasta 8 herramientas independientes en paralelo. Prefiere lotes para lecturas y búsquedas. Cambios al mismo archivo se ordenan. Sin preguntas, skills, batch anidado ni delegación.',parameters:{type:'object',properties:{calls:{type:'array',minItems:1,maxItems:8,items:{type:'object',properties:{name:{type:'string'},arguments:{type:'object'}},required:['name','arguments'],additionalProperties:false}}},required:['calls'],additionalProperties:false}}};
