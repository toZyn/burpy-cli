import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completion,runAgent,validateQuestions,MODEL} from '../src/provider.js';
const jsonResponse=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
test('stream SSE fragmentado, UTF8 y uso real',async()=>{
 const events=[{choices:[{delta:{content:'Hola, Perú'}}]},{choices:[{delta:{},finish_reason:'stop'}],usage:{total_tokens:17}}].map(d=>`data: ${JSON.stringify(d)}\r\n\r\n`).join('')+'data: [DONE]\r\n\r\n';
 const bytes=new TextEncoder().encode(events);let captured='',body;
 const result=await completion({key:'test',messages:[],onText:t=>captured+=t,fetcher:async(_url,options)=>{body=JSON.parse(options.body);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}),{headers:{'content-type':'text/event-stream'}});}});
 assert.equal(captured,'Hola, Perú');assert.equal(result.usage.total_tokens,17);assert.equal(body.model,MODEL);assert.ok(!body.tools.some(t=>t.function.name==='set_limits'));assert.ok(body.tools.find(t=>t.function.name==='bash').function.parameters.properties.timeout);
});
test('preguntas se devuelven como tool result con historial',async()=>{
 let n=0;const payloads=[];const states=[];
 const history=await runAgent({plugin:null,key:'test',history:[],text:'Pregunta y saluda',fixedAnswers:{saludo:'Texto exacto'},signal:new AbortController().signal,onText:()=>{},onState:s=>states.push(s),onUsage:()=>{},ask:async questions=>({answers:{color:questions[0].options[1]}}),fetcher:async(_url,o)=>{
  payloads.push(JSON.parse(o.body));n++;
  if(n===1)return jsonResponse({choices:[{message:{tool_calls:[{id:'a',type:'function',function:{name:'ask_questions',arguments:JSON.stringify({questions:[{id:'color',question:'Color?',options:['Azul','Verde']}]})}}]},finish_reason:'tool_calls'}]});
  return jsonResponse({choices:[{message:{content:'Texto exacto'},finish_reason:'stop'}],usage:{total_tokens:11}});
 }});
 assert.equal(n,2);assert.equal(history.at(-1).content,'Texto exacto');assert.match(payloads[1].messages.find(m=>m.tool_call_id==='a').content,/Verde/);assert.ok(states.includes('tools'));
});
test('errores HTTP ocultan clave, stream incompleto no se acepta',async()=>{
 await assert.rejects(completion({key:'secret',messages:[],fetcher:async()=>new Response('secret limite',{status:429})}),/\[oculto\]/);
 await assert.rejects(completion({key:'test',messages:[],fetcher:async()=>new Response('data: {"choices":[{"delta":{"content":"parcial"}}]}\n\n',{headers:{'content-type':'text/event-stream'}})}),/antes de completar/);
});
test('validación de preguntas y cancelación',async()=>{assert.throws(()=>validateQuestions({questions:[]}));assert.throws(()=>validateQuestions({questions:[{id:'a',question:'?'},{id:'a',question:'?'}]}));const c=new AbortController();c.abort();await assert.rejects(runAgent({plugin:null,key:'test',history:[],text:'hola',fixedAnswers:{},signal:c.signal,onState:()=>{},onText:()=>{},onUsage:()=>{}}));});
test('contexto publica crecimiento del stream y uso exacto; no acumula turnos',async()=>{
 const meters=[];const fetcher=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'Hola'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:' mundo'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1200,completion_tokens:8,total_tokens:1208}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 const opts={plugin:null,key:'test',fetcher,text:'Hola',onText:()=>{},onState:()=>{},onUsage:()=>{},onContext:m=>meters.push(m)};const history=await runAgent({...opts,history:[]});assert.ok(meters[2].tokens>meters[1].tokens);assert.equal(meters.at(-1).tokens,1208);assert.equal(meters.at(-1).estimated,false);await runAgent({...opts,history,text:'Continúa'});assert.equal(meters.at(-1).tokens,1208);
});
