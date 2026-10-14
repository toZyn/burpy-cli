#!/usr/bin/env node
import {modelProfile,modelRegistry,providers,providerProfile} from './models.js';
import {pickerItems,movePicker,selectedItem} from './picker.js';
import {screenPainter,transcriptLayout} from './terminal.js';
import {banner,clipTerminal} from './banner.js';
import {mouseInput} from './mouse.js';
import {markdownRows,scrollOffset} from './markdown.js';
import {compactHistory,contextMeter,formatContext} from './context.js';
import {sessionStore} from './sessions.js';
import {defaultSuperpowers} from './superpowers.js';
import readline from 'node:readline';
import {displayDetail,moveChoice,selectedAnswer,animationState} from './activity.js';
import {glass} from './glass.js';
import {writeFile} from 'node:fs/promises';
import {runAgent,completion} from './provider.js';
import {defaultSettings} from './settings.js';
import {workspaceRunner} from './workspace.js';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {commands,commandInfo,matchingCommands,clean,wrap,transcript} from './core.js';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Burpy\n\nnode src/cli.js [--plain] [--no-motion] [--model ID]\n\n'+commands.join('  '));process.exit(0);}
const registry=modelRegistry();
const requestedModel=args.includes('--model')?args[args.indexOf('--model')+1]:process.env.BURPY_MODEL;
let profile=null,apiKey='',pickerTask=null,savedModel=null;
let superpowers;try{superpowers=await defaultSuperpowers();}catch(error){console.error(`No se pudo cargar Superpowers: ${error.message}`);process.exit(1);}

const plain=args.includes('--plain')||!process.stdin.isTTY||!process.stdout.isTTY||process.env.TERM==='dumb';
let motion=!args.includes('--no-motion')&&!process.env.NO_MOTION;
const theme={background:'39;41;43',accent:'195;215;169',muted:'169;175;173',text:'232;235;231',success:'137;174;115',mascot:'137;174;115'};
const color=process.env.NO_COLOR===undefined;
const base=color?`\x1b[48;2;${theme.background}m\x1b[38;2;${theme.text}m`:'';
const c=(text,tone='text')=>color?`\x1b[38;2;${theme[tone]}m${text}${base}`:text;
let bodyCount=0,bodyAvailable=1,glassFrame=0,ambient=null,lastActivity=Date.now(),paletteOpen=false,paletteIndex=0,paletteDismissed=null;
const meterFor=options=>contextMeter({...options,limit:profile?.context||1000000,limitEstimated:!profile?.contextKnown});
let bodyRevision=0;
let submitting=false,todos=[],children=[],compactions=0,contextUsage=meterFor(),drawTimer=null;
let messages=[],session=randomUUID(),input=[],cursor=0,history=[],historyIndex=0,draft='',scroll=0,busy=false,timer=null,frame=0,agentState='idle',activeTool='',controller=null,apiHistory=[],tokenCount=0,usageKnown=false,questionTask=null,plainAsk=null,notice='',lastTextAt=0,saveTimer=null,sessionMeta=null,questionFocusRow=0,stateSince=Date.now(),activeActivity=null,closed=false,cache=[];
const spin=['◐','◓','◑','◒'];
let store;try{store=await sessionStore();}catch(error){console.error(`No se pudo abrir el historial: ${error.message}`);process.exit(1);}
function snapshot(){return {...sessionMeta,id:session,model:profile?.id||savedModel?.id,providerId:profile?.providerId||savedModel?.providerId,messages,apiHistory,todos,children,compactions,contextUsage,inputHistory:history.slice(-1000),tokenCount,usageKnown};}
async function persist(){clearTimeout(saveTimer);saveTimer=null;try{await store.save(snapshot(),registry.secrets());}catch(error){notice=`Error al guardar sesión: ${clean(error.message)}`;if(plain)console.error(notice);render();}}
function scheduleSave(){if(closed||saveTimer)return;saveTimer=setTimeout(()=>{saveTimer=null;void persist();},1200);}
function applySession(data){bodyRevision++;savedModel=data.model?{id:data.model,providerId:data.providerId||'opencode'}:null;sessionMeta={createdAt:data.createdAt};session=data.id;messages=data.messages;apiHistory=data.apiHistory;todos=data.todos;children=(data.children||[]).map(r=>({...r,status:r.status==='running'?'interrupted':r.status}));compactions=data.compactions||0;contextUsage=profile&&(data.model||'space-bunny-free')===profile.id&&(data.providerId||'opencode')===profile.providerId&&data.contextUsage&&Number.isFinite(data.contextUsage.tokens)?{...data.contextUsage,limit:profile?.context||1000000,limitEstimated:!profile?.contextKnown,percent:Number((data.contextUsage.tokens/(profile?.context||1000000)*100).toFixed(1))}:meterFor({messages:apiHistory});history=data.inputHistory;historyIndex=history.length;tokenCount=data.tokenCount||0;usageKnown=!!data.usageKnown;scroll=0;}
try{const saved=await store.latest();applySession(saved||store.fresh());if(saved)notice='Sesión anterior recuperada';}catch(error){applySession(store.fresh());notice=clean(error.message);}
await persist();

function notify(text){notice=clean(text);render();}
function cancel(){controller?.abort();finishPicker(null);questionTask?.reject(Error('Preguntas canceladas'));questionTask=null;input=[];cursor=0;render();}
let questionQueue=Promise.resolve();
function askQuestions(...args){const task=questionQueue.catch(()=>{}).then(()=>showQuestions(...args));questionQueue=task;return task;}
async function showQuestions(questions,signal,permission=false,secret=false){
 signal?.throwIfAborted();
 if(plain)return plainAsk(questions,signal);
 paletteOpen=false;input=[];cursor=0;scroll=0;
 return new Promise((resolve,reject)=>{const abort=()=>{if(questionTask?.reject===reject){questionTask=null;render();}reject(Error('Preguntas canceladas'));};signal?.addEventListener('abort',abort,{once:true});const done=value=>{signal?.removeEventListener('abort',abort);resolve(value);};questionTask={questions,index:0,selected:0,permission,secret,answers:{},resolve:done,reject};agentState='asking';render();});
}
function answerQuestion(value){
 const task=questionTask,q=task.questions[task.index];
 value=value||task.defaultAnswer||'';
 const choice=Number(value),answer=q.options?.length&&/^\d+$/.test(value)&&choice>=1&&choice<=q.options.length?q.options[choice-1]:value;
 if(!answer.trim()){notice='Escribe una respuesta o el número de una opción';render();return;}
 task.answers[q.id]=answer;task.index++;task.selected=0;input=[];cursor=0;scroll=0;
 if(task.index===task.questions.length){questionTask=null;agentState='tools';if(!task.permission)messages.push({role:'user',text:Object.entries(task.answers).map(([id,text])=>`${id}: ${text}`).join(' · ')});task.resolve({answers:task.answers});scheduleSave();bodyRevision++;}
 render();
}
const settings=defaultSettings();
const executeTool=await workspaceRunner(process.cwd(),async(request,signal)=>{
 const question=request.command?`Autorizar bash durante esta sesión. Los comandos pueden acceder fuera del workspace. Primer comando:\n${request.command}`:`${request.outside?'Autorizar lectura y cambios en esta carpeta externa durante la sesión':'Autorizar cambios dentro del workspace durante la sesión'}:\n${request.path}`;
 const result=await askQuestions([{id:'approval',question,options:['Cancelar','Permitir durante la sesión']}],signal,true);return result.answers.approval==='Permitir durante la sesión';
},settings,event=>{if(activeActivity){activeActivity.text=(activeActivity.text+(activeActivity.streaming?'':'\n')+event.text).slice(-30000);activeActivity.streaming=true;if(plain)process.stdout.write(event.text);render('body');}});

async function respond(text){
 if(!profile||!apiKey){notify('Conecta un proveedor con /connect y elige un modelo en /model');if(plain)console.log(notice);return;}
 lastActivity=Date.now();messages.push({role:'user',text});scheduleSave();bodyRevision++;scroll=0;busy=true;agentState='thinking';notice='';controller=new AbortController();
 let current=null;
 try{
  const nextHistory=await runAgent({key:apiKey,model:profile.id,endpoint:profile.endpoint,providerName:profile.provider,history:apiHistory,text,signal:controller.signal,ask:askQuestions,executeTool,settings,
   plugin:superpowers,contextRatio:contextUsage.ratio,onContext:meter=>{contextUsage=meter;scheduleSave();render();},children,onChildren:next=>{children=next;scheduleSave();render();},onCompact:()=>{compactions++;contextUsage=meterFor({messages:apiHistory});notify('Contexto compactado · historial completo conservado');},onCheckpoint:next=>{apiHistory=next;scheduleSave();},onPlan:plan=>{todos=plan;scheduleSave();render();},
   onState:(state,tool)=>{if(state==='speaking')return;if(state==='thinking')current=null;if(state!==agentState||tool&&tool!==activeTool)stateSince=Date.now();activeTool=tool||'';agentState=state;render();},
   onTool:event=>{if(event.phase==='output'){const item=messages.findLast(m=>m.id===event.id);if(item){item.text=(item.text+(item.streaming?'':'\n')+event.output.text).slice(-30000);item.streaming=true;}if(plain)process.stdout.write(event.output.text);scheduleSave();render('body');return;}if(event.name==='ask_questions')return;if(event.phase==='active'){activeActivity=messages.findLast(m=>m.id===event.id);agentState='tools';activeTool=event.agent?`${event.agent} · ${event.name}`:event.name;render('body');return;}if(event.phase==='progress'){let item=messages.findLast(m=>m.id===event.id);if(!item){item={role:'tool',id:event.id,name:'subagent',agent:event.agent,text:''};messages.push(item);}item.text=(item.text+event.output.text).slice(-30000);scheduleSave();render('body');return;}if(event.phase==='start'){activeActivity={role:'tool',id:event.id,name:event.name,agent:event.agent,path:event.args?.path||'',text:(event.agent?`Hijo ${event.agent} · `:'')+displayDetail(event.name,event.args),pending:true};messages.push(activeActivity);if(plain)console.log(`\n[${event.name}]\n${activeActivity.text}`);}else{const item=messages.findLast(m=>m.id===event.id);if(item){item.text=displayDetail(event.name,event.args,event.output);item.pending=false;item.failed=!!(event.output?.error||event.output?.denied);item.elapsed=event.elapsed;if(plain)console.log(`\n[${item.failed?'error':'completado'} ${event.name}]\n${item.text}`);}if(activeActivity?.id===event.id)activeActivity=null;}scheduleSave();render('body');},
   onText:chunk=>{lastTextAt=Date.now();if(agentState!=='speaking')stateSince=lastTextAt;agentState='speaking';activeTool='';if(!current){current={role:'assistant',text:''};messages.push(current);}current.text+=chunk;scheduleSave();render('body');},
   onUsage:usage=>{if(Number.isFinite(usage.total_tokens)){tokenCount+=usage.total_tokens;usageKnown=true;}render();}
  });apiHistory=nextHistory;notice='';
 }catch(error){if(current)current.cancelled=true;notice=controller.signal.aborted?'Respuesta cancelada':clean(error.message.split(apiKey).join('[oculto]'));if(plain)console.error(notice);}
 finally{if(activeActivity?.pending){activeActivity.pending=false;activeActivity.failed=true;activeActivity.elapsed=Date.now()-stateSince;activeActivity.text+='\nInterrumpido';activeActivity=null;}busy=false;controller=null;questionTask=null;agentState='idle';lastActivity=Date.now();if(!closed)await persist();render('body');}
}
function activate(next){const key=registry.keyFor(next);if(!key)throw Error('Conecta su proveedor con /connect primero');profile=next;apiKey=key;settings.context_tokens=next.context;settings.context_estimated=!next.contextKnown;settings.supports_tools=next.supportsTools;settings.max_tokens=Math.min(4096,next.maxOutput||4096);contextUsage=meterFor({messages:apiHistory});notify(`${next.provider} · ${next.id}${next.supportsTools?'':' · solo chat'}`);scheduleSave();}
function choose(title,items){
 if(plain){if(!items.length){notify('Conecta un proveedor con /connect para ver sus modelos');return null;}return plainAsk([{id:'choice',question:title,options:items.map(item=>item.label)}]).then(r=>items.find(item=>item.label===r.answers.choice)?.value||null);}
 paletteOpen=false;const previousInput=input;input=[];cursor=0;scroll=0;
 return new Promise(resolve=>{pickerTask={title,items,index:0,resolve,previousInput};render('input');});
}
function finishPicker(value){if(!pickerTask)return;const task=pickerTask;pickerTask=null;input=task.previousInput;cursor=input.length;task.resolve(value);render('input');}
async function connect(provider,keyOverride){
 const previous=profile&&registry.keyFor({...profile,providerId:provider.id});let key=keyOverride;
 if(!key){if(plain){key=process.env[provider.keyEnv]?.trim();if(!key)throw Error(`Define ${provider.keyEnv} y ejecuta /connect ${provider.id}`);}
 else{const fallback=previous||process.env[provider.keyEnv]?.trim();const promise=showQuestions([{id:'key',question:`API key de ${provider.provider} (oculta, solo en memoria)${fallback?' · Enter conserva la clave':''}`}],undefined,true,true);questionTask.defaultAnswer=fallback;const answer=await promise;key=answer.answers.key.trim();}}
 busy=true;agentState='thinking';controller=new AbortController();notice='Conectando '+provider.provider;render();
 try{const models=await registry.connect(provider.id,key,controller.signal);if(closed)return;if(!profile||profile.providerId===provider.id){const next=models.find(m=>m.id===(profile?.id||(savedModel?.providerId===provider.id?savedModel.id:null)))||models.find(m=>m.id==='space-bunny-free')||models[0];if(next)activate(modelProfile(next.id,models));else{profile=null;apiKey='';contextUsage=meterFor({messages:apiHistory});}}notify(`${provider.provider} conectado · ${models.length} modelos gratuitos`);}
 finally{busy=false;agentState='idle';controller=null;render();}
}
async function bootstrap(){
 for(const p of providers){if(closed)return;const key=process.env[p.keyEnv]?.trim();if(key){try{await connect(p,key);}catch(error){notify(error.message);if(plain)console.error(notice);}}}
 const target=requestedModel||(savedModel&&savedModel.providerId+'/'+savedModel.id);if(target){try{activate(modelProfile(target,registry.list()));}catch(error){notify(error.message);}}
 if(!profile)notify('Conecta un proveedor con /connect');
}
async function submit(text){
 text=clean(text).trim();if(!text)return;
 if(text.startsWith('/')){
  const [command,...rest]=text.split(/\s+/);
  if(command==='/exit'){close();return;}
  if(command==='/help'){if(plain)notice=commandInfo.map(c=>`${c.usage} — ${c.description}`).join('\n');else{paletteOpen=true;paletteDismissed=null;}}
  else if(command==='/compact'){
   if(!profile)throw Error('Conecta un proveedor con /connect primero');
   busy=true;agentState='thinking';controller=new AbortController();render();
   try{const next=await compactHistory(apiHistory,{limit:profile.context,signal:controller.signal,summarize:(messages,signal)=>completion({key:apiKey,model:profile.id,endpoint:profile.endpoint,providerName:profile.provider,messages,signal,settings,availableTools:[]}),onUsage:u=>{tokenCount+=u.total_tokens||0;}});apiHistory=next;compactions++;contextUsage=meterFor({messages:apiHistory});notify('Contexto compactado · historial completo conservado');}finally{busy=false;controller=null;agentState='idle';render();}
  }
  else if(command==='/init'){await respond('Inspecciona el proyecto real del directorio actual usando list_files, read, grep y bash si hace falta. Lee manifiestos, estructura, entrada, documentación y pruebas para comprender todo el sistema actual. Genera AGENTS.md en la raíz con propósito, arquitectura, módulos y funcionamiento, flujos principales, configuración y variables (sin secretos), instalación, ejecución, pruebas, convenciones, limitaciones verificadas y reglas prácticas para futuros agentes. No confundas el proyecto actual con Burpy. Si AGENTS.md ya existe, léelo y actualízalo conservando instrucciones y secciones útiles; usa edit para cambios puntuales. No inventes funcionalidades, documenta solo lo comprobado y señala incertidumbres. Verifica el archivo final.');return;}
  else if(command==='/agents'){const summary=children.map(r=>`${r.id} · ${r.name} · ${r.status}\n${r.task}\n${(r.result||r.error||'').slice(0,4000)}`).join('\n\n')||'Sin subagentes en esta sesión';messages.push({role:'assistant',text:summary});notify('Subagentes de la sesión');}
  else if(command==='/clear'){cache=snapshot();messages=[];apiHistory=[];todos=[];children=[];compactions=0;contextUsage=meterFor();notify('Conversación limpia · /undo para restaurarla');}
  else if(command==='/undo'){if(cache?.messages){const previous=snapshot();applySession(cache);cache=previous;executeTool.revoke();settings.auto=false;}notify('Conversación restaurada');}
  else if(command==='/new'){cache=snapshot();await persist();applySession(store.fresh());executeTool.revoke();settings.auto=false;notify('Nueva sesión · la anterior sigue guardada');}
  else if(command==='/sessions'){const list=await store.list();const text=list.map(item=>`${item.id.slice(0,8)}  ${item.id===session?'● ':''}${item.title}\n  ${item.updatedAt} · ${item.messages} entradas`).join('\n\n')||'Sin sesiones guardadas';if(plain)notice=text;else messages.push({role:'assistant',text});scroll=0;}
  else if(command==='/resume'){if(!rest[0])notify('Uso: /resume ID');else{await persist();const saved=await store.find(rest[0]);cache=snapshot();applySession(saved);executeTool.revoke();settings.auto=false;notify('Sesión recuperada');}}
  else if(command==='/plan'){settings.plan=true;notify('Modo plan · inspección sin cambios');}
  else if(command==='/build'){settings.plan=false;notify('Modo build · herramientas con permisos de sesión');}
  else if(command==='/diff'){const changes=executeTool.changes();messages.push({role:'assistant',text:changes.length?changes.map(change=>'### '+change.path+' · +'+change.added+' −'+change.removed+'\n\n````diff\n'+change.preview+'\n````').join('\n\n'):'Sin cambios de archivos registrados en este proceso.'});notify('Cambios realizados · create/write/edit');}
  else if(command==='/auto'){if(!['on','off'].includes(rest[0]))notify(`Autoaprobación: ${settings.auto?'on':'off'} · /auto on|off`);else{settings.auto=rest[0]==='on';if(!settings.auto)executeTool.revoke('workspace:write');notify(`Autoaprobación ${settings.auto?'activada dentro del workspace':'desactivada'}`);}}
  else if(command==='/permissions'){if(rest[0]==='reset'){executeTool.revoke();settings.auto=false;notify('Permisos revocados');}else notify(executeTool.permissions().join(' · ')||'Sin permisos recordados');}
  else if(command==='/skills'){const text=superpowers.catalog.map(s=>`${s.name}\n  ${s.description}`).join('\n\n');if(plain)notice=text;else messages.push({role:'assistant',text});scroll=0;}
  else if(command==='/superpowers')notify(`Superpowers ${superpowers.manifest.version} · activo · ${superpowers.catalog.length} habilidades · ${superpowers.manifest.commit.slice(0,12)}`);
  else if(command==='/connect'){const provider=rest[0]?providerProfile(rest[0]):await choose('Conectar proveedor',providers.map(p=>({id:p.id,label:p.provider,description:registry.connected(p.id)?'Conectado · actualizar clave y catálogo':'API key propia',value:p})));if(provider)await connect(provider);}
  else if(command==='/model'){
   const models=registry.list();
   if(rest[0])activate(modelProfile(rest[0],models));
   else{const next=await choose('Modelos gratuitos',models.map(p=>({id:p.providerId+'/'+p.id,label:p.id,description:`${p.provider} · ${p.contextKnown?'':'≈'}${p.context.toLocaleString('en-US')} · ${p.supportsTools?'agente':'chat'}${profile?.providerId===p.providerId&&profile?.id===p.id?' · actual':''}`,value:p})));if(next)activate(modelProfile(next.id,[next]));}
  }
  else if(command==='/motion'){motion=!motion;notify(`Animaciones ${motion?'activadas':'desactivadas'}`);}
  else if(command==='/export'){
   busy=true;agentState='tools';render();
   const path=resolve(rest.join(' ')||`burpy-${session}-${Date.now()}.md`);
   try{await writeFile(path,`# Burpy · ${session}\n\n${transcript(messages)}\n`,{flag:'wx',mode:0o600});notice=`Guardado: ${path}`;}catch(error){notice=`No se pudo exportar: ${error.message}`;}finally{busy=false;agentState='idle';render();}
  }else notify('Comando desconocido · /help muestra los disponibles');
 }else {await respond(text);return;}
 bodyRevision++;
 if(!closed)await persist();
 render();
}
async function handleSubmit(text){if(submitting)return;submitting=true;try{await submit(text);}catch(error){notify(error.message);}finally{submitting=false;}}
const painter=screenPainter(process.stdout,{base,synchronized:process.env.BURPY_SYNC_OUTPUT!=='0'});
const layout=transcriptLayout((m,inner)=>{
 const line=(text,tone='text')=>c(clipTerminal(text,inner+4),tone);
 if(m.role==='tool')return [line(`  ${m.pending?'◌':m.failed?'!':'✓'} ${m.agent?m.agent+' · ':''}${m.name} ${m.path||''} ${m.pending?'en curso':`${((m.elapsed||0)/1000).toFixed(1)} s`}`,m.failed?'muted':'accent'),...wrap(m.text,inner-2).map(t=>line('    '+t,'muted')),''];
 return [line(`  ${m.role==='user'?'› Tú':'● Burpy'}${m.cancelled?' · cancelado':''}`,m.role==='user'?'muted':'accent'),...(m.role==='assistant'?markdownRows(m.text||'Preparando respuesta…',inner,{color,reset:base}).map(t=>'  '+t):wrap(m.text,inner).map(t=>line('  '+t))),''];
});
function render(reason){if(reason==='body')bodyRevision++;if(plain||closed)return;if(reason==='input'&&drawTimer){clearTimeout(drawTimer);drawTimer=null;}if(drawTimer)return;drawTimer=setTimeout(()=>{drawTimer=null;draw();},reason==='input'?0:32);}
function draw(){
 if(plain||closed)return;
 const padding=(process.stdout.columns||80)>=40?2:1,top=(process.stdout.rows||24)>=18?2:1;
 const width=Math.max(8,(process.stdout.columns||80)-padding*2-1),height=Math.max(5,(process.stdout.rows||24)-top-1),inner=Math.max(4,width-4);
 const fit=text=>clipTerminal(text,width);
 const line=(text,tone='text')=>c(fit(text),tone);
 const narrow=width<64,compact=height<25;
 const sheen=(text,offset=0)=>glass(text,motion?glassFrame:0,color,offset)+base;
 const rail=()=>sheen(' '+ '─'.repeat(Math.max(1,width-2)));
 const info=text=>sheen(' │ ',12)+line(text,'muted');
 const visibleState=agentState==='speaking'&&Date.now()-lastTextAt>500?'thinking':agentState;
 const mascotState=animationState({busy,state:agentState,lastTextAt,lastActivity});
 const header=questionTask||pickerTask?[line(' Burpy','accent')]:banner({width,height,state:mascotState,frame:motion?Math.floor(glassFrame):1,color,reset:base,version:'1.7.0',model:profile?.id||'Sin modelo',provider:profile?.provider||'Sin conexión',path:clean(process.cwd()),paint:c});
 const details=!profile?'Sin conexión':width>=64?`${profile.id} · ${formatContext(contextUsage)} · ${session.slice(0,8)}${settings.plan?' · plan':settings.auto?' · auto':''}`:`${formatContext(contextUsage)}`;
 const footerRows=5,available=Math.max(1,height-header.length-footerRows);
 const choices=matchingCommands(input.join('').startsWith('/')?input.join(''):'');
 paletteIndex=Math.max(0,Math.min(paletteIndex,choices.length-1));
 const body=(paletteOpen||questionTask||pickerTask)?[]:layout.rows(messages,inner,bodyRevision);
 if(!messages.length&&!paletteOpen&&!questionTask&&!pickerTask&&body.length===0)body.push('',line('  ¿Qué vamos a construir?','accent'));
 if(paletteOpen){
  body.length=0;
  const count=Math.max(1,Math.floor((available-2)/2)),offset=Math.max(0,paletteIndex-count+1);
  body.push(line('  Comandos','accent'));
  if(!choices.length)body.push(line('  No hay comandos que coincidan.','muted'));
  for(let i=offset;i<Math.min(choices.length,offset+count);i++){
   const item=choices[i];
   body.push(line(`  ${i===paletteIndex?'❯':' '} ${item.name.padEnd(9)} ${item.description}`,i===paletteIndex?'accent':'text'));
   body.push(line(`    Uso: ${item.usage}`,'muted'));
  }
 }
 if(pickerTask){
  body.length=0;const items=pickerItems(pickerTask,input.join(''));selectedItem(pickerTask,input.join(''));const count=Math.max(1,Math.floor((available-2)/2)),offset=Math.max(0,pickerTask.index-count+1);
  body.push(line('  '+pickerTask.title,'accent'));
  if(!items.length)body.push(...wrap(pickerTask.items.length?'Sin coincidencias':'Conecta un proveedor con /connect para ver sus modelos.',inner).map(t=>line('  '+t,'muted')));
  for(let i=offset;i<Math.min(items.length,offset+count);i++){if(i===pickerTask.index)body.push(...wrap('❯ '+items[i].label,inner-2).slice(0,2).map(t=>line('  '+t,'accent')));else body.push(line('    '+items[i].label));body.push(line('    '+items[i].description,'muted'));}
 }
 if(questionTask){
  body.length=0;const q=questionTask.questions[questionTask.index];
  if(questionTask.questions.length>1)body.push(line(`  ${questionTask.index+1} de ${questionTask.questions.length}`,'muted'));
  body.push(...wrap(q.question,inner).map(t=>line('  '+t)));
  for(const [i,option] of (questionTask.secret?[]:[...(q.options||[]),'Respuesta personalizada…']).entries()){if(i===questionTask.selected)questionFocusRow=body.length;body.push(...wrap(`${i===questionTask.selected?'❯':' '} ${option}`,inner).map(t=>line('  '+t,i===questionTask.selected?'accent':'muted')));}

 }
 if(!questionTask&&!paletteOpen&&!pickerTask){if(scroll>0&&bodyCount&&body.length!==bodyCount)scroll+=body.length-bodyCount;scroll=scrollOffset(scroll,0,body.length,available);bodyCount=body.length;bodyAvailable=available;}
 const end=paletteOpen||pickerTask?available:questionTask?Math.min(body.length,Math.max(available,questionFocusRow+2)+scroll):Math.max(available,body.length-scroll),view=body.slice(Math.max(0,end-available),end);
 while(view.length<available)view.push('');
 const currentTodo=todos.find(t=>t.status==='in_progress');
 const runningChildren=children.filter(r=>r.status==='running');
 const status=busy?`${motion?spin[Math.floor(glassFrame)%4]:'●'} ${{thinking:'Pensando',supervising:'Colaborando con hijos',speaking:'Escribiendo',tools:activeTool?`Herramienta · ${activeTool}`:'Usando herramientas',asking:'Esperando tus respuestas'}[visibleState]||'Trabajando'} · ${Math.floor((Date.now()-stateSince)/1000)} s${runningChildren.length?` · ${runningChildren.length} hijos activos`:''} · Esc cancela`:`${scroll?'Historial':'Listo'} · ${motion?'animación activa':'sin animación'}`;
 const room=Math.max(1,width-4),start=Math.max(0,cursor-room+1),visible=input.slice(start,start+room).join('');
 const prompt=c(' ❯ ','success')+(input.length?(questionTask?.secret?'•'.repeat(input.slice(start,start+room).length):visible):c(questionTask?.secret?'API key…':questionTask?'Respuesta personalizada…':pickerTask?'Filtrar…':'Escribe un mensaje…','accent'));
 const footer=[line('  '+(questionTask||pickerTask?'':busy?status:notice|| (todos.length?`${todos.filter(t=>t.status==='completed').length}/${todos.length} tareas${currentTodo?' · '+currentTodo.text:''}`:'')),'muted'),rail(),prompt,rail(),line(questionTask||pickerTask?'': ' '+details,'muted')];
 const rows=[...Array(top).fill(''),...[...header,...view,...footer].slice(0,height).map(l=>' '.repeat(padding)+l),''];
 const row=top+header.length+available+3;
 painter.paint({rows,position:!busy||questionTask?[row,padding+4+cursor-start]:null});
}
function close(code=0){
 if(closed)return;closed=true;clearTimeout(drawTimer);clearTimeout(saveTimer);if(busy){for(const m of messages)if(m.pending){m.pending=false;m.failed=true;m.elapsed=Date.now()-stateSince;m.text+='\nInterrumpido al cerrar';}const last=messages.at(-1);if(last?.role==='assistant')last.cancelled=true;}void persist();controller?.abort();questionTask?.reject(Error('Salida'));clearInterval(timer);clearInterval(ambient);apiKey='';registry.clear();finishPicker(null);painter.close();
 if(!plain){process.stdin.setRawMode(false);process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1000l\x1b[?1006l\x1b[?1049l');process.stdin.pause();}
 process.exitCode=code;
}
if(plain){
 await bootstrap();
 const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity}),iterator=rl[Symbol.asyncIterator]();
 plainAsk=async(questions,signal)=>{const answers={};for(const q of questions){signal?.throwIfAborted();console.log(q.question);q.options?.forEach((o,i)=>console.log(`${i+1}. ${o}`));const next=await iterator.next();if(next.done)throw Error('Entrada cerrada');const n=Number(next.value);answers[q.id]=q.options?.[n-1]||next.value;}return {answers};};
 while(true){const next=await iterator.next();if(next.done||next.value.trim()==='/exit')break;await handleSubmit(next.value);if(next.value.startsWith('/'))console.log(notice);else{const last=messages.filter(m=>m.role==='assistant').at(-1);if(last)console.log(last.text);}}
 await persist();await store.flush();rl.close();
}else{
 const keys=mouseInput(delta=>{if(paletteOpen||pickerTask)return;if(questionTask)scroll=Math.max(0,scroll-delta);else scroll=scrollOffset(scroll,delta,bodyCount,bodyAvailable);render('input');});process.stdin.pipe(keys);readline.emitKeypressEvents(keys,{escapeCodeTimeout:50});process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h');
 keys.on('keypress',(text,key={})=>{
  lastActivity=Date.now();
  if(key.ctrl&&['c','d'].includes(key.name)){close();return;}
  if(pickerTask){
   if(key.name==='escape'){finishPicker(null);return;}
   if(['up','down','tab','pageup','pagedown'].includes(key.name)){movePicker(pickerTask,['up','pageup'].includes(key.name)?-1:1,input.join(''));render('input');return;}
   if(key.name==='return'){const item=selectedItem(pickerTask,input.join(''));if(item)finishPicker(item.value);return;}
  }
  if((busy||submitting)&&!questionTask&&!pickerTask&&!['pageup','pagedown'].includes(key.name)){if(key.name==='escape')cancel();return;}
  if(key.ctrl&&key.name==='p'&&!questionTask&&!pickerTask){paletteOpen=!paletteOpen;paletteDismissed=paletteOpen?null:input.join('');paletteIndex=0;render('input');return;}
  if(paletteOpen){
   const choices=matchingCommands(input.join('').startsWith('/')?input.join(''):'');
   if(key.name==='escape'){paletteOpen=false;paletteDismissed=input.join('');render('input');return;}
   if(['up','down'].includes(key.name)){
    if(choices.length)paletteIndex=(paletteIndex+(key.name==='up'?-1:1)+choices.length)%choices.length;
    render('input');return;
   }
   if(['return','tab'].includes(key.name)&&choices.length){
    if(!busy){input=Array.from(choices[paletteIndex].name+(choices[paletteIndex].name==='/export'?' ':''));cursor=input.length;paletteOpen=false;paletteDismissed=input.join('');}
    render('input');return;
   }
  }
  if(questionTask&&['up','down','tab'].includes(key.name)){moveChoice(questionTask,key.name==='up'?-1:1);scroll=0;render('input');return;}
  if(questionTask&&key.name==='escape'){cancel();return;}

  if(key.name==='return'){const value=input.join('');input=[];cursor=0;if(value.trim()&&!questionTask?.secret){history.push(value);historyIndex=history.length;}if(questionTask)answerQuestion(selectedAnswer(questionTask,value));else void handleSubmit(value);}
  else if(key.name==='escape'){input=[];cursor=0;}
  else if(key.name==='left')cursor=Math.max(0,cursor-1);
  else if(key.name==='right')cursor=Math.min(input.length,cursor+1);
  else if(key.name==='home'||key.ctrl&&key.name==='a')cursor=0;
  else if(key.name==='end'||key.ctrl&&key.name==='e')cursor=input.length;
  else if(key.name==='backspace'){if(cursor>0)input.splice(--cursor,1);}
  else if(key.name==='delete')input.splice(cursor,1);
  else if(key.ctrl&&key.name==='u'){input=[];cursor=0;}
  else if(key.name==='up'||key.name==='down'){
   if(historyIndex===history.length)draft=input.join('');
   historyIndex=Math.max(0,Math.min(history.length,historyIndex+(key.name==='up'?-1:1)));
   input=Array.from(historyIndex===history.length?draft:history[historyIndex]||'');cursor=input.length;
  }else if(questionTask&&key.name==='pageup')scroll=Math.max(0,scroll-5);
  else if(questionTask&&key.name==='pagedown')scroll+=5;
  else if(key.name==='pageup')scroll=scrollOffset(scroll,5,bodyCount,bodyAvailable);
  else if(key.name==='pagedown')scroll=Math.max(0,scroll-5);
  else if(key.name==='tab'){const match=commands.filter(v=>v.startsWith(input.join('')));if(match.length===1){input=Array.from(match[0]);cursor=input.length;}else notice=match.join(' · ');}
  else if(text&&!key.ctrl&&!key.meta){const value=Array.from(clean(text));input.splice(cursor,0,...value.slice(0,12000-input.length));cursor=Math.min(input.length,cursor+value.length);}
  const value=input.join('');
  if(!questionTask&&!pickerTask&&value!==paletteDismissed){paletteOpen=value.startsWith('/')&&!/\s/.test(value);paletteIndex=0;}
  render('input');
 });
 process.stdout.on('resize',()=>{painter.invalidate();bodyRevision++;render();});process.on('SIGTERM',()=>close());process.on('SIGHUP',()=>close());process.on('SIGINT',()=>close());
 process.on('uncaughtException',error=>{close(1);console.error(error.message);});
 process.on('exit',()=>{if(!closed){process.stdin.setRawMode(false);process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1000l\x1b[?1006l\x1b[?1049l');}});
 void bootstrap();
 ambient=setInterval(()=>{if(motion)glassFrame+=1;if(busy||motion)render();},64);
 render();
}
