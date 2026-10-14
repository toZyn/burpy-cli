import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../src/provider.js';
import {createToolScheduler} from '../src/scheduler.js';
import {banner} from '../src/banner.js';
import stringWidth from 'string-width';
import {contextMeter,contextLimit,formatContext} from '../src/context.js';
const response=message=>new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}),{headers:{'content-type':'application/json'}});
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
test('1M es límite predeterminado y porcentaje se recalcula sobre contexto real',()=>{assert.equal(contextLimit(),1000000);const meter=contextMeter({usage:{prompt_tokens:3682,completion_tokens:0}});assert.equal(meter.percent,0.4);assert.equal(formatContext(meter),'3,682 / 1,000,000 (0.4%)');assert.equal(meter.limitEstimated,false);});
test('banner lado a lado cabe en terminales pequeñas, anchas y sin color',()=>{
 for(const color of [true,false])for(const [width,height] of [[100,42],[58,30],[42,26],[32,18],[24,12],[18,9]]){const rows=banner({width,height,color,model:'space-bunny-free',path:'/data/data/com.termux/files/home/project'});assert.ok(rows.every(row=>stringWidth(row)<=width));assert.ok(rows.length<height-4);assert.match(rows[0].replace(/\x1b\[[\d;]*m/g,''),/Burpy/);if(width>=24&&height>=12){assert.equal(rows.length,width<76||height<31?6:12);assert.ok(rows.some(row=>row.includes('project'))||width===24);}}
});
test('herramientas de padre y hijo se solapan realmente; cambios al mismo archivo se ordenan',async()=>{
 let release;const childGate=new Promise(r=>release=r),events=[];
 const execute=createToolScheduler(async(name,args)=>{events.push(args.owner+' inicia');if(args.owner==='hijo')await childGate;events.push(args.owner+' termina');return {ok:true};});
 const child=execute('bash',{owner:'hijo'});await execute('read',{owner:'padre',path:'src/a.js'});assert.deepEqual(events,['hijo inicia','padre inicia','padre termina']);release();await child;
 let finish;const gate=new Promise(r=>finish=r),fileEvents=[];const files=createToolScheduler(async(_name,args)=>{fileEvents.push(args.owner);if(args.owner==='uno')await gate;});const first=files('write',{path:'a.js',owner:'uno'});const second=files('edit',{path:'a.js',owner:'dos'});await Promise.resolve();await Promise.resolve();assert.deepEqual(fileEvents,['uno']);finish();await Promise.all([first,second]);assert.deepEqual(fileEvents,['uno','dos']);
});
test('padre trabaja mientras bash hijo sigue activo, y le envía instrucciones antes de terminar',async()=>{
 let release,started;const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r);let parentCalls=0,childCalls=0,childId;const events=[],payloads=[];
 const fetcher=async(_url,options)=>{const body=JSON.parse(options.body);payloads.push(body);const child=body.messages[0].content.includes('Eres un hijo.');
 if(child){childCalls++;if(childCalls===1)return response({tool_calls:[call('c','bash',{command:'trabajo del hijo'})]});assert.ok(body.messages.some(m=>m.content?.includes('Indicación del padre: Verifica pruebas')));return response({content:'Hijo comprobado'});}
 parentCalls++;if(parentCalls===1)return response({tool_calls:[call('spawn','spawn_agent',{task:'Revisa módulo',name:'Revisor'})]});
 if(parentCalls===2){await begun;childId=JSON.parse(body.messages.find(m=>m.tool_call_id==='spawn').content).id;return response({tool_calls:[call('read','read',{path:'src/main.js'}),call('send','send_agent',{id:childId,message:'Verifica pruebas'})]});}
 if(parentCalls===3){release();return response({content:'Padre completó su parte'});}return response({content:'Padre revisó hijo'});
 };
 const result=await runAgent({key:'test',history:[],text:'Colabora',plugin:null,fetcher,onState:()=>{},onText:()=>{},onUsage:()=>{},executeTool:async(name)=>{if(name==='bash'){events.push('hijo empieza');started();await gate;events.push('hijo termina');return {output:'ok',exit_code:0};}events.push('padre lee');return {content:'main'};}});
 assert.deepEqual(events,['hijo empieza','padre lee','hijo termina']);assert.equal(childCalls,2);assert.ok(result.some(m=>/Resultados de hijos|Actualización de hijos/.test(m.content||'')));assert.equal(result.at(-1).content,'Padre revisó hijo');
});
test('batch solapa lecturas y regresa resultados al modelo',async()=>{
 let active=0,max=0,calls=0;const outputs=[];
 const result=await runAgent({key:'test',history:[],text:'Lee ambos',plugin:null,onState:()=>{},onText:()=>{},onUsage:()=>{},onTool:e=>outputs.push(e),executeTool:async(_name,args)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return {path:args.path,content:'ok'};},fetcher:async(_url,options)=>{const body=JSON.parse(options.body);if(!calls++)return response({tool_calls:[call('batch','batch',{calls:[{name:'read',arguments:{path:'a.js'}},{name:'read',arguments:{path:'b.js'}}]})]});const result=JSON.parse(body.messages.at(-1).content);assert.equal(result.results.length,2);return response({content:'Ambos leídos'});}});
 assert.equal(max,2);assert.equal(result.at(-1).content,'Ambos leídos');assert.equal(outputs.filter(e=>e.phase==='start'&&e.name==='read').length,2);
});
import {createSubagents} from '../src/subagents.js';
test('recuperación no repite resultados completados y cancelación espera herramientas activas',async()=>{
 const manager=createSubagents({records:[{id:'old',history:[],status:'completed',result:'ya revisado',revision:5}],run:async()=>[]});assert.deepEqual(manager.collect(),[]);assert.deepEqual(manager.collect(),[]);assert.equal(await manager.review(),null);await manager.stop();
 const scheduler=createToolScheduler(async(_name,_args,signal)=>new Promise(resolve=>{signal.addEventListener('abort',()=>resolve({cancelled:true}),{once:true});}));const controller=new AbortController();const task=scheduler('bash',{},controller.signal);controller.abort();assert.equal((await task).cancelled,true);
});
