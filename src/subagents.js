import {randomUUID} from 'node:crypto';
const schema=(name,description,properties,required)=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export const subagentTools=[
 schema('spawn_agent','Inicia un hijo en paralelo para una tarea delimitada. El padre sigue trabajando y debe revisar el resultado.',{task:{type:'string'},name:{type:'string'}},['task']),
 schema('agent_status','Consulta progreso e historial reciente del hijo.',{id:{type:'string'}},['id']),
 schema('send_agent','Envía indicaciones a un hijo activo para su siguiente paso, o continúa uno terminado con correcciones.',{id:{type:'string'},message:{type:'string'}},['id','message']),
 schema('wait_agent','Espera el resultado de un hijo para revisarlo.',{id:{type:'string'}},['id']),
 schema('cancel_agent','Cancela un hijo.',{id:{type:'string'}},['id'])
];
export function createSubagents({run,records=[],onChange=()=>{},signal}){
 const states=new Map(records.map(r=>[r.id,{...r,revision:0,status:r.status==='running'?'interrupted':r.status}]));const jobs=new Map(),controllers=new Map();let revision=0,seen=0,spawned=0;
 const snapshot=()=>[...states.values()].map(r=>structuredClone(r));
 function launch(record,text){
  const controller=new AbortController();controllers.set(record.id,controller);record.status='running';record.result=null;record.error=null;onChange(snapshot());
  const childSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const job=(async()=>{try{record.history=await run(record,text,childSignal,()=>{const messages=record.inbox||[];record.inbox=[];return messages;});record.result=record.history.filter(m=>m.role==='assistant'&&!m.tool_calls?.length).at(-1)?.content||'';record.status='completed';}catch(e){record.status=childSignal.aborted?'cancelled':'failed';record.error=e.message;}finally{record.revision=++revision;controllers.delete(record.id);onChange(snapshot());}})();jobs.set(record.id,job);
 }
 const bounded=value=>{const text=String(value||'');return text.length>12000?text.slice(0,12000)+'\n[Resultado recortado; inspecciona archivos y pruebas para verificar el trabajo]':text;};
 const get=id=>{const r=states.get(id);if(!r)throw Error('Subagente desconocido');return r;};
 async function execute(name,args){
  if(name==='spawn_agent'){if(typeof args.task!=='string'||!args.task.trim()||args.task.length>12000)throw Error('Tarea inválida');if(spawned>=8||[...states.values()].filter(r=>r.status==='running').length>=3)throw Error('Máximo 3 hijos activos y 8 por turno');spawned++;const r={id:randomUUID().slice(0,8),name:String(args.name||'Hijo').slice(0,60),task:args.task,history:[],inbox:[],status:'pending'};states.set(r.id,r);launch(r,args.task);return {id:r.id,status:r.status};}
  const r=get(args.id);
  if(name==='send_agent'){if(typeof args.message!=='string'||!args.message.trim()||args.message.length>12000)throw Error('Mensaje inválido');if(r.status==='running'){r.inbox??=[];r.inbox.push(args.message);onChange(snapshot());return {id:r.id,status:r.status,queued:true};}launch(r,args.message);}
  else if(name==='wait_agent')await jobs.get(r.id);
  else if(name==='cancel_agent')controllers.get(r.id)?.abort();
  return {id:r.id,name:r.name,status:r.status,result:bounded(r.result),error:r.error,recent:r.history.slice(-4).map(m=>({role:m.role,content:bounded(m.content)}))};
 }
 const collect=()=>{const updated=[...states.values()].filter(r=>r.revision>seen);seen=revision;return updated.map(({id,name,task,status,result,error})=>({id,name,task,status,result:bounded(result),error}));};
 return {execute,snapshot,collect,active:()=>[...states.values()].filter(r=>r.status==='running').length,async stop(){for(const c of controllers.values())c.abort();await Promise.all([...jobs.values()]);},update(record,history){record.history=history;onChange(snapshot());},async review(){await Promise.all([...jobs.values()]);const reports=collect();return reports.length?reports:null;}};
}
