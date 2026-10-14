import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {defaultSuperpowers,loadSuperpowers,validateTodos,metadata} from '../src/superpowers.js';
import {runAgent} from '../src/provider.js';
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const call=(name,args,id='a')=>json({choices:[{message:{tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]});
const done=()=>json({choices:[{message:{content:'Hecho'},finish_reason:'stop'}]});
const base={key:'test',history:[],text:'Corrige el fallo',fixedAnswers:{},onState:()=>{},onText:()=>{},onUsage:()=>{},ask:async()=>({answers:{}})};
test('plugin oficial: catálogo completo, referencias y scripts',async()=>{
 const p=await defaultSuperpowers();assert.equal(p.catalog.length,15);assert.equal(p.manifest.commit.length,40);assert.match(p.context,/executing-plans/);assert.match(p.context,/ofrece spawn_agent/);
 const debug=await p.skill({name:'systematic-debugging'});assert.match(debug.content,/Root Cause/i);assert.ok(debug.resources.includes('root-cause-tracing.md'));
 assert.match((await p.skill({name:'systematic-debugging',resource:'root-cause-tracing.md'})).content,/Tracing/i);
 await assert.rejects(p.skill({name:'unknown'}),/desconocida/);
 for(const resource of ['../LICENSE','/etc/passwd','scripts/../../../x','SKILL.md\\x'])await assert.rejects(p.skill({name:'brainstorming',resource}),/relativa/);
});
test('integridad al cargar y consultar: cambios o enlaces externos se rechazan',async()=>{
 const root=await mkdtemp(join(tmpdir(),'burpy-plugin-')),path=join(root,'skills','using-superpowers','SKILL.md');
 try{
  const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'skills','using-superpowers'),{recursive:true});
  const content='---\nname: using-superpowers\ndescription: Bootstrap\n---\nContent';await writeFile(path,content);
  const manifest={version:'fixture',commit:'test',files:{'skills/using-superpowers/SKILL.md':createHash('sha256').update(content).digest('hex')}};await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
  const p=await loadSuperpowers(root);await writeFile(path,'changed');await assert.rejects(p.skill({name:'using-superpowers'}),/modificado/);await assert.rejects(loadSuperpowers(root),/modificado/);
  await rm(path);await symlink('/etc/hosts',path);await assert.rejects(p.skill({name:'using-superpowers'}),/externo/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('skill pertinente elegida por el modelo se conserva entre turnos',async()=>{
 let n=0,executed=0;const payloads=[];
 const fetcher=async(_url,options)=>{const body=JSON.parse(options.body);payloads.push(body);n++;if(n===1)return call('skill',{name:'systematic-debugging'});if(n===2)return call('read',{path:'x'},'b');return done();};
 const history=await runAgent({...base,fetcher,executeTool:async()=>{executed++;return {content:'x'};}});
 assert.equal(payloads[0].tool_choice,'auto');assert.match(payloads[0].messages[0].content,/using-superpowers/);
 assert.equal(payloads[1].tool_choice,'auto');const loaded=JSON.parse(payloads[1].messages.find(m=>m.role==='tool').content);assert.match(loaded.content,/systematic-debugging/);assert.equal(executed,1);
 await runAgent({...base,history,text:'Ahora otra tarea',fetcher:async(_u,o)=>{const body=JSON.parse(o.body);assert.equal(body.tool_choice,'auto');assert.match(body.messages[0].content,/systematic-debugging\/SKILL.md/);return done();}});

});
test('saludo directo sin skill ni herramientas, incluso con sesión vacía',async()=>{
 let calls=0,text='';await runAgent({...base,text:'hola',onText:t=>text+=t,fetcher:async(_u,o)=>{calls++;const body=JSON.parse(o.body);assert.equal(body.tool_choice,'auto');assert.ok(!body.tools.some(t=>t.function.name==='get_fixed_answer'));assert.match(body.messages[0].content,/sin herramientas/);return done();},onTool:()=>assert.fail('Un saludo no necesita herramienta')});assert.equal(calls,1);assert.equal(text,'Hecho');
});
test('herramienta de trabajo puede ejecutarse directamente sin cargar skill',async()=>{
 let n=0,executed=0;const history=await runAgent({...base,executeTool:async()=>{executed++;return {content:'archivo'};},fetcher:async()=>++n===1?call('read',{path:'x'}):done()});assert.equal(executed,1);assert.equal(n,2);assert.ok(!history.some(m=>m.content?.includes('Consulta primero')));
});
test('plan validado se muestra y regresa al modelo como resultado real',async()=>{
 let n=0,plan;
 const history=await runAgent({...base,onPlan:p=>plan=p,fetcher:async()=>{n++;if(n===1)return call('skill',{name:'writing-plans'});if(n===2)return call('todowrite',{todos:[{id:'1',text:'Inspeccionar',status:'in_progress'}]},'b');return done();}});
 assert.equal(plan[0].status,'in_progress');assert.deepEqual(JSON.parse(history.filter(m=>m.role==='tool').at(-1).content).todos,plan);
 assert.throws(()=>validateTodos({todos:[{id:'x',text:'A',status:'pending'},{id:'x',text:'B',status:'completed'}]}),/duplicado/);
 assert.throws(()=>validateTodos({todos:[{id:'x',text:'A',status:'in_progress'},{id:'y',text:'B',status:'in_progress'}]}),/una tarea/);
});
test('metadata admite descripciones multilínea y CRLF',()=>{const info=metadata('---\r\nname: x\r\ndescription: >\r\n  Uno\r\n  dos\r\n---\r\nBody');assert.equal(info.description,'Uno dos');assert.equal(info.body,'Body');});
test('skill selectiva conserva narración visible y se reutiliza sin releer',async()=>{
 let n=0;const log=[];
 const history=await runAgent({...base,onState:s=>log.push(s),onText:t=>log.push('visible:'+t),onTool:e=>log.push(e.phase+':'+e.name),fetcher:async()=>{n++;if(n===1)return json({choices:[{message:{content:'texto oculto',tool_calls:[{id:'sp',type:'function',function:{name:'skill',arguments:'{"name":"systematic-debugging"}'}}]},finish_reason:'tool_calls'}]});return done();}});
 assert.ok(log.includes('visible:texto oculto'));assert.ok(log.indexOf('tools')<log.indexOf('start:skill'));
 const real=await defaultSuperpowers(),plugin={...real,skill:async()=>{throw Error('No debe releerse');}};n=0;
 const next=await runAgent({...base,history,plugin,fetcher:async()=>++n===1?call('skill',{name:'systematic-debugging'},'cached'):done()});assert.equal(JSON.parse(next.filter(m=>m.role==='tool').at(-1).content).cached,true);
});
