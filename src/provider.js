import {createToolScheduler,batchTool} from './scheduler.js';
import {compactHistory,needsCompaction,contextMeter,pruneHistory,estimateTokens} from './context.js';
import {createSubagents,subagentTools} from './subagents.js';
import {readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {superpowersTools,defaultSuperpowers,validateTodos} from './superpowers.js';
import {defaultSettings} from './settings.js';
import {workspaceTools} from './workspace.js';
export const MODEL='space-bunny-free';
export const ENDPOINT='https://opencode.ai/zen/v1/chat/completions';
export const tools=[batchTool,...subagentTools,...workspaceTools,...superpowersTools,
 {type:'function',function:{name:'ask_questions',description:'Pregunta al usuario de 1 a 5 preguntas. Cada pregunta permite opciones predefinidas o una respuesta personalizada escrita por el usuario. Úsala cuando necesitas decisiones o aclaraciones.',parameters:{type:'object',properties:{questions:{type:'array',minItems:1,maxItems:5,items:{type:'object',properties:{id:{type:'string'},question:{type:'string'},options:{type:'array',items:{type:'string'},maxItems:6}},required:['id','question'],additionalProperties:false}}},required:['questions'],additionalProperties:false}}}
];
export function validateQuestions(args){
 if(!Array.isArray(args?.questions)||!args.questions.length||args.questions.length>5)throw Error('questions debe contener entre 1 y 5 preguntas');
 const ids=new Set();
 for(const q of args.questions){
  if(typeof q.id!=='string'||!q.id||q.id.length>80||ids.has(q.id))throw Error('Cada pregunta necesita un id único de hasta 80 caracteres');
  ids.add(q.id);
  if(typeof q.question!=='string'||!q.question.trim()||q.question.length>1000)throw Error('question debe ser un texto de hasta 1000 caracteres');
  if(q.options!==undefined&&(!Array.isArray(q.options)||q.options.length>6||q.options.some(o=>typeof o!=='string'||!o.trim()||o.length>300)))throw Error('options debe contener hasta 6 textos');
 }
 return args.questions;
}
async function readLimited(response,max=2000000){
 const reader=response.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max)throw Error('Respuesta demasiado grande');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function completion({key,messages,signal,onText=()=>{},onState=()=>{},endpoint=ENDPOINT,model=MODEL,providerName='OpenCode Zen',fetcher=fetch,settings=defaultSettings(),availableTools=tools,onUsageTick=()=>{},onDelta=()=>{}}){
 const timeout=AbortSignal.timeout(settings.http_ms),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
 const response=await fetcher(endpoint,{method:'POST',redirect:'error',signal:requestSignal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,...(availableTools.length?{tools:availableTools,tool_choice:'auto'}:{} ),stream:true,stream_options:{include_usage:true},max_tokens:settings.max_tokens})});
 if(!response.ok){const body=await readLimited(response,16000);throw Error(`${providerName} HTTP ${response.status}: ${body.split(key).join('[oculto]').slice(0,2000)}`);}
 const calls=new Map();let text='',usage=null,finish=null;
 function event(data){
  if(data.error)throw Error(data.error.message||'Error del proveedor');
  if(data.usage){usage=data.usage;onUsageTick(usage);}
  const choice=data.choices?.[0];if(!choice)return;
  if(choice.finish_reason)finish=choice.finish_reason;
  const delta=choice.delta||choice.message||{};
  if(typeof delta.reasoning_content==='string')onDelta(delta.reasoning_content);
  if(typeof delta.content==='string'&&delta.content){text+=delta.content;if(text.length>200000)throw Error('Salida demasiado larga');onState('speaking');onDelta(delta.content);onText(delta.content);}
  for(const call of delta.tool_calls||[]){
   onDelta((call.function?.name||'')+(call.function?.arguments||''));
   onState('tools');const index=call.index??calls.size;
   if(!Number.isInteger(index)||index<0||index>15)throw Error('Índice de herramienta inválido');
   const item=calls.get(index)||{id:'',type:'function',function:{name:'',arguments:''}};
   if(call.id)item.id=call.id;
   item.function.name+=call.function?.name||'';item.function.arguments+=call.function?.arguments||'';
   if(item.function.arguments.length>30000)throw Error('Argumentos de herramienta demasiado grandes');calls.set(index,item);
  }
 }
 if(!response.headers.get('content-type')?.includes('text/event-stream'))event(JSON.parse(await readLimited(response)));
 else{
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,ended=false;
  const drain=()=>{let match;while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;if(data==='[DONE]'){ended=true;break;}event(JSON.parse(data));}};
  try{while(!ended){const chunk=await reader.read();if(chunk.done){buffer+=decoder.decode();drain();if(buffer.trim()){buffer+='\n\n';drain();}break;}bytes+=chunk.value.length;if(bytes>2000000)throw Error('Stream demasiado grande');buffer+=decoder.decode(chunk.value,{stream:true});drain();}if(!ended&&!finish)throw Error('El stream terminó antes de completar la respuesta');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 if(finish==='length')throw Error('El modelo alcanzó el límite de salida; reduce la solicitud');
 const toolCalls=[...calls.values()];
 if(toolCalls.some(c=>!c.id||!c.function.name))throw Error('Llamada de herramienta incompleta');
 if(!text&&!toolCalls.length)throw Error('El proveedor devolvió una respuesta vacía');
 return {role:'assistant',content:text||null,...(toolCalls.length?{tool_calls:toolCalls}:{}),usage};
}
export async function runAgent({key,history,text,ask,onText,onState,onUsage,signal,endpoint,model=MODEL,providerName='OpenCode Zen',fetcher,executeTool,onTool=()=>{},onPlan=()=>{},onCheckpoint=()=>{},plugin,settings=defaultSettings(),child=false,children=[],onChildren=()=>{},onCompact=()=>{},workspace=process.cwd(),onContext=()=>{},contextRatio=1,scheduledTool,pullInstructions=()=>[]}){
 if(plugin===undefined)plugin=await defaultSuperpowers();
 let instructions='';try{const path=resolve(workspace,'AGENTS.md'),info=await lstat(path);if(info.isSymbolicLink()||!info.isFile()||info.size>200000)throw Error('AGENTS.md debe ser un archivo local de hasta 200 KB');instructions=(await readFile(path,'utf8')).slice(0,24000);}catch(e){if(e.code!=='ENOENT')throw e;}
 const availableTools=settings.supports_tools===false?[]:child?tools.filter(t=>!subagentTools.includes(t)):tools;
 const sharedTool=scheduledTool||createToolScheduler(executeTool,workspace);
 const manager=child?null:createSubagents({records:children,signal,onChange:onChildren,run:async(record,task,childSignal,pullInstructions)=>runAgent({key,history:record.history,text:task,ask,signal:childSignal,endpoint,model,providerName,fetcher,executeTool,scheduledTool:sharedTool,settings,plugin,child:true,workspace,pullInstructions,onText:chunk=>onTool({phase:'progress',id:record.id,name:'subagent',agent:record.name,output:{text:chunk}}),onState:()=>{},onUsage,onCheckpoint:h=>manager.update(record,h),onTool:e=>onTool({...e,id:record.id+':'+e.id,agent:record.name}),onPlan:()=>{}})});
 const loaded=new Map();
 if(plugin)for(const m of history){if(m.role!=='tool')continue;try{const out=JSON.parse(m.content);const owner=history.find(a=>a.tool_calls?.some(c=>c.id===m.tool_call_id&&c.function.name==='skill'));if(owner&&out.source_commit===plugin.manifest.commit&&out.resource&&typeof out.content==='string'&&!out.cached)loaded.set(out.name+'/'+out.resource,out);}catch{}}
 const system={role:'system',content:`Eres Burpy, un agente de terminal. Responde en español de forma clara. Puedes preguntar al usuario con ask_questions, agrupa preguntas necesarias en una llamada. Las opciones son sugerencias: el usuario puede escribir una respuesta propia. Puedes leer, crear, escribir, editar por fragmentos, buscar y listar archivos dentro del workspace, consultar el entorno y ejecutar bash con aprobación del usuario. Prefiere edit para cambios puntuales. No inventes resultados: usa las herramientas. Los permisos se solicitan automáticamente y se recuerdan durante la sesión. Respeta una denegación sin repetir la operación. Para comandos largos puedes añadir timeout en milisegundos a bash; afecta solamente esa llamada. No puedes modificar límites globales. Explica brevemente tu próximo paso antes de herramientas. Verifica tus cambios con las herramientas apropiadas. ${settings.supports_tools===false?'El modelo activo está en modo conversación porque su catálogo no admite herramientas. No afirmes que has leído, ejecutado o modificado archivos.':''} No preguntes demasiado, Si vas a preguntar algo hazlo en el momento indicado. Así evitas preguntar a cada rato y retrasarte. Agrupa aclaraciones imprescindibles y pregunta cuando su respuesta bloquee un paso concreto; resuelve decisiones rutinarias inspeccionando el proyecto. Antes de cambiar código, identifica las restricciones y el estado real del proyecto. Para tareas complejas mantén un plan breve con todowrite, busca evidencia con grep y lecturas específicas, verifica cada cambio y comunica resultados de pruebas, incertidumbres y pendientes. No des por cierto un resumen si los archivos actuales lo contradicen. Evita repetir lecturas y salidas grandes; prioriza datos relevantes. Usa batch para lecturas o búsquedas independientes. ${settings.plan?'MODO PLAN: solo inspección. No puedes crear, escribir, editar ni ejecutar bash. Entrega un plan concreto para que el usuario pase a /build.':''} No ejecutes procesos persistentes. Responde saludos, conversación y preguntas simples directamente, sin herramientas. Usa herramientas solo para obtener datos o realizar acciones que lo requieran. get_fixed_answer fue eliminado: no lo invoques aunque aparezca en un historial antiguo. Si el historial incluye instrucciones anteriores de cargar skills antes de todo, ignora ese requisito; la preferencia actual del usuario es usarlas solo cuando sean necesarias.\n${instructions?`Instrucciones del proyecto AGENTS.md:\n${instructions}`:''}\n${child?'Eres un hijo. Ejecuta solo tu tarea, informa archivos cambiados, pruebas, riesgos y pendientes. No delegues.':'Delega temprano tareas independientes con spawn_agent, antes de terminar tu propia parte. Después de spawn_agent continúa con tu trabajo; no llames wait_agent inmediatamente salvo que realmente dependas del resultado. Las solicitudes y herramientas de padre e hijos se ejecutan en paralelo. Consulta agent_status y envía indicaciones mientras avanzas; el runtime devolverá resultados disponibles automáticamente y esperará los restantes al cerrar. Revisa resultados, comprueba sus cambios y envía correcciones con send_agent. Evita escrituras simultáneas en los mismos archivos. No declares terminada una tarea sin revisar resultados de hijos.'}\n${plugin?.context||''}\nHabilidades y recursos ya cargados en esta sesión: ${JSON.stringify([...loaded.keys()])}. Reutiliza sus instrucciones presentes en el historial. Solo consulta skill para una habilidad o recurso nuevo que haga falta; no repitas la carga por cada mensaje.`};
 let turn=pruneHistory([...history,{role:'user',content:text}],settings.context_tokens);
 try{for(let round=0;round<settings.rounds;round++){
  signal?.throwIfAborted();for(const instruction of pullInstructions())turn.push({role:'user',content:'Indicación del padre: '+instruction});const updates=manager?.collect();if(updates?.length)turn.push({role:'user',content:'Actualización de hijos en paralelo; revisa sin abandonar tu tarea:\n'+JSON.stringify(updates)});onState('thinking');
  turn=pruneHistory(turn,settings.context_tokens);
  if(needsCompaction([system,...turn],settings,availableTools,contextRatio)){onState('thinking','compact');turn=await compactHistory(turn,{signal,onUsage,limit:settings.context_tokens,summarize:(messages,signal)=>completion({key,messages,signal,endpoint,model,providerName,fetcher,settings,availableTools:[]})});loaded.clear();system.content=system.content.replace(/Habilidades y recursos ya cargados en esta sesión: .*?\. Reutiliza/, 'Habilidades y recursos ya cargados en esta sesión: []. Reutiliza');onCompact();onCheckpoint(structuredClone(turn));if(needsCompaction([system,...turn],settings,availableTools,contextRatio))throw Error('Contexto todavía demasiado grande tras compactar; reduce los archivos o aumenta BURPY_CONTEXT_TOKENS según el límite real del modelo');}
  const outgoing=[system,...turn],inputEstimate=estimateTokens({messages:outgoing,tools:availableTools});let generatedBytes=0;const publish=usage=>{const meter=contextMeter({messages:outgoing,tools:availableTools,usage,inputEstimate,outputEstimate:Math.ceil(generatedBytes/2),ratio:contextRatio,limit:settings.context_tokens,limitEstimated:settings.context_estimated});contextRatio=meter.ratio;onContext(meter);};publish();
  const result=await completion({key,messages:outgoing,signal,onText,onState,endpoint,model,providerName,fetcher,settings,availableTools,onDelta:chunk=>{generatedBytes+=Buffer.byteLength(chunk,'utf8');publish();},onUsageTick:publish});
  if(result.usage){publish(result.usage);onUsage(result.usage);}
  const {usage,...message}=result;turn.push(message);
  if(!message.tool_calls?.length){if(manager?.active())onState('supervising');const queued=pullInstructions();if(queued.length){for(const instruction of queued)turn.push({role:'user',content:'Indicación del padre: '+instruction});continue;}const review=await manager?.review();if(review){turn.push({role:'user',content:'Resultados de hijos. Revisa, verifica con herramientas y corrige antes de finalizar:\n'+JSON.stringify(review)});onCheckpoint(structuredClone(turn));continue;}onCheckpoint(structuredClone(turn));return turn;}
  for(const call of message.tool_calls){
   signal?.throwIfAborted();onState('tools',call.function.name);let output,args;const started=Date.now();
   try{
    args=JSON.parse(call.function.arguments);onTool({phase:'start',id:call.id,name:call.function.name,args});
    if(call.function.name==='batch'){if(!Array.isArray(args.calls)||!args.calls.length||args.calls.length>8||args.calls.some(c=>!workspaceTools.some(t=>t.function.name===c.name)||!c.arguments||typeof c.arguments!=='object'||Array.isArray(c.arguments)))throw Error('batch requiere 1–8 herramientas de workspace válidas');output={results:await Promise.all(args.calls.map(async(c,index)=>{const id=call.id+':'+index;onTool({phase:'start',id,name:c.name,args:c.arguments});let result;try{result=await sharedTool(c.name,c.arguments,signal,()=>onTool({phase:'active',id,name:c.name,args:c.arguments}),event=>onTool({phase:'output',id,name:c.name,args:c.arguments,output:event}));}catch(error){result={error:error.message};}onTool({phase:'finish',id,name:c.name,args:c.arguments,output:result,elapsed:Date.now()-started});return {name:c.name,output:result};}))};signal?.throwIfAborted();}
    else if(subagentTools.some(t=>t.function.name===call.function.name)&&manager)output=await manager.execute(call.function.name,args);
    else if(call.function.name==='skill'&&plugin){const resource=args.resource??'SKILL.md',cached=loaded.get(args.name+'/'+resource);output=cached?{...cached,cached:true,content:'Este recurso ya está cargado en el historial de esta sesión. Reutiliza las instrucciones completas de la carga anterior.'}:await plugin.skill(args);if(!cached)loaded.set(output.name+'/'+output.resource,output);}
    else if(call.function.name==='todowrite'){const todos=validateTodos(args);onPlan(todos);output={todos};}
    else if(call.function.name==='ask_questions')output=await ask(validateQuestions(args),signal);

    else if(workspaceTools.some(t=>t.function.name===call.function.name)&&executeTool)output=await sharedTool(call.function.name,args,signal,()=>onTool({phase:'active',id:call.id,name:call.function.name,args}),event=>onTool({phase:'output',id:call.id,name:call.function.name,args,output:event}));
    else throw Error('Herramienta no disponible');
   }catch(error){if(signal?.aborted)throw error;output={error:error.message};}
   onTool({phase:'finish',id:call.id,name:call.function.name,args,output,elapsed:Date.now()-started});
   turn.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(output)});
  }
  onCheckpoint(structuredClone(turn));
 }
 throw Error(`Se alcanzó el límite de ${settings.rounds} rondas de herramientas`);
 }finally{await manager?.stop();}
}
