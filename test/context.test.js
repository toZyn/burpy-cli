import test from 'node:test';
import assert from 'node:assert/strict';
import {compactHistory,needsCompaction} from '../src/context.js';
import {defaultSettings} from '../src/settings.js';
import {createSubagents} from '../src/subagents.js';
import {runAgent} from '../src/provider.js';
test('compactación conserva últimos turnos íntegros y no modifica historial original',async()=>{
 const history=[{role:'user',content:'Objetivo: conservar config.json'},{role:'assistant',content:null,tool_calls:[{id:'a',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:'a',content:'config'}, {role:'user',content:'Segundo'},{role:'assistant',content:'sí'},{role:'user',content:'Tercero'}];
 const original=structuredClone(history);let input;
 const compact=await compactHistory(history,{summarize:async messages=>{input=messages;return {content:'Objetivo: conservar config.json; archivo leído.'};}});
 assert.deepEqual(history,original);assert.deepEqual(compact.slice(2),history.slice(3));assert.match(compact[0].content,/config.json/);assert.match(input[1].content,/tool_call_id/);
 await assert.rejects(compactHistory(history,{summarize:async()=>({content:''})}),/vacía/);assert.deepEqual(history,original);
 assert.equal(needsCompaction([{content:'x'.repeat(1600000)}],defaultSettings()),true);
});
test('hijo paralelo, correcciones, supervisión y recuperación sin repetir acciones',async()=>{
 let release;const gate=new Promise(r=>release=r);let changes=[];
 const manager=createSubagents({onChange:r=>changes=r,run:async(record,text)=>{await gate;return [...record.history,{role:'user',content:text},{role:'assistant',content:'Resultado '+text}];}});
 const child=await manager.execute('spawn_agent',{task:'Revisar pruebas'});assert.equal((await manager.execute('agent_status',child)).status,'running');
 assert.equal((await manager.execute('send_agent',{id:child.id,message:'Corrige'})).queued,true);
 release();const reports=await manager.review();assert.equal(reports[0].status,'completed');assert.equal(await manager.review(),null);
 await manager.execute('send_agent',{id:child.id,message:'Corrige'});assert.match((await manager.review())[0].result,/Corrige/);assert.ok(changes[0].history.length>=4);
 const restored=createSubagents({records:[{...changes[0],status:'running'}],run:()=>assert.fail('No debe repetir acciones')});assert.equal((await restored.execute('agent_status',child)).status,'interrupted');await manager.stop();
});
test('padre recibe resultado y verifica después de delegar; hijo no tiene herramientas de delegación',async()=>{
 const calls=[];let parent=0;
 const fetcher=async(_url,request)=>{const body=JSON.parse(request.body);calls.push(body);const child=body.messages[0].content.includes('Eres un hijo.');let message;
 if(child){assert.equal(body.tools.some(t=>t.function.name==='spawn_agent'),false);message={role:'assistant',content:'Pruebas revisadas'};}
 else if(parent++===0)message={role:'assistant',content:null,tool_calls:[{id:'spawn',type:'function',function:{name:'spawn_agent',arguments:JSON.stringify({task:'Revisar pruebas'})}}]};
 else message={role:'assistant',content:parent===2?'Esperando resultado':'Resultado verificado'};
 return new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}),{headers:{'content-type':'application/json'}});
 };
 const result=await runAgent({key:'test',history:[],text:'Revisa',plugin:null,fetcher,onText:()=>{},onState:()=>{},onUsage:()=>{},ask:()=>{},executeTool:()=>{}});
 assert.equal(result.at(-1).content,'Resultado verificado');assert.ok(result.some(m=>m.content?.includes('Resultados de hijos')));assert.equal(calls.length,4);
});
test('compactación automática precede solicitud normal y conserva la petición actual',async()=>{
 let compacted=0,requests=0,checkpoints=[];
 const fetcher=async(_url,request)=>{const body=JSON.parse(request.body);requests++;const summary=!body.tools;
 if(!summary){assert.match(body.messages.at(-1).content,/Continúa revisando/);assert.ok(JSON.stringify(body.messages).length<30000);}
 return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:summary?'Memoria: mantener src/config.js y validar npm test.':'Continúo'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
 };
 const history=[{role:'user',content:'Mantén src/config.js'},{role:'assistant',content:'x'.repeat(1600000)},{role:'user',content:'Segunda solicitud'},{role:'assistant',content:'ok'}];
 await runAgent({key:'test',history,text:'Continúa revisando',plugin:null,fetcher,onText:()=>{},onState:()=>{},onUsage:()=>{},onCompact:()=>compacted++,onCheckpoint:h=>checkpoints.push(h)});
 assert.equal(compacted,1);assert.ok(requests>=2);assert.match(checkpoints[0][0].content,/src\/config.js/);assert.equal(history[1].content.length,1600000);
});
import {contextMeter,formatContext,pruneHistory} from '../src/context.js';
test('contador usa contexto actual, actualiza streaming y sustituye estimación con uso real',()=>{
 const initial=contextMeter({messages:[{role:'user',content:'hola'}],limit:10000});const next=contextMeter({messages:[{role:'user',content:'hola'}],generated:'x'.repeat(200),limit:10000});assert.equal(next.tokens-initial.tokens,100);assert.equal(next.estimated,true);
 const actual=contextMeter({messages:[],usage:{prompt_tokens:2000,completion_tokens:500,total_tokens:2500},limit:10000});assert.equal(actual.tokens,2500);assert.equal(actual.percent,25);assert.equal(actual.estimated,false);assert.match(formatContext(actual),/2,500 \/ .*10,000 \(25.0%\)/);
 const cached=contextMeter({usage:{prompt_tokens:2000,completion_tokens:500,prompt_tokens_details:{cached_tokens:1000}},limit:10000});assert.equal(cached.tokens,2500);
});
test('poda antigua conserva pares, skills, errores y últimos turnos sin mutar fuente',()=>{
 const history=[];for(let i=0;i<6;i++){const name=i===1?'skill':'read';history.push({role:'user',content:'turno '+i},{role:'assistant',content:null,tool_calls:[{id:String(i),function:{name,arguments:JSON.stringify({path:'src/file.js'})}}]},{role:'tool',tool_call_id:String(i),content:JSON.stringify(i===2?{error:'x'.repeat(10000)}:{content:'x'.repeat(10000)})});}
 const pruned=pruneHistory(history,8192);assert.equal(pruned.length,history.length);assert.equal(pruned[2].tool_call_id,'0');assert.ok(JSON.parse(pruned[2].content).pruned);assert.equal(pruned[5].content,history[5].content);assert.equal(pruned[8].content,history[8].content);assert.deepEqual(pruned.slice(-6),history.slice(-6));assert.ok(!JSON.parse(history[2].content).pruned);
});
test('turno grande se compacta preservando petición actual y sin resultados huérfanos',async()=>{
 const history=[{role:'user',content:'Objetivo'},{role:'assistant',content:'Respuesta'},{role:'user',content:'Petición actual'},{role:'assistant',content:null,tool_calls:[{id:'x',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:'x',content:'x'.repeat(600000)}];
 const result=await compactHistory(history,{summarize:async()=>({content:'Se leyó src/file.js; no repetir cambios ya hechos.'})});assert.equal(result.at(-1).content,'Petición actual');assert.ok(!result.some(m=>m.role==='tool'));assert.ok(result[0].content.includes('no repetir'));
});
