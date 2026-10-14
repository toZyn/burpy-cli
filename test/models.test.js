import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogModels,modelProfile,modelRegistry,providers} from '../src/models.js';
import {completion,runAgent} from '../src/provider.js';
import {defaultSettings} from '../src/settings.js';
import {pickerItems,movePicker,selectedItem} from '../src/picker.js';
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const response=message=>json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]});
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const orCatalog={data:[{id:'vendor/coder:free',context_length:262144,supported_parameters:['tools'],pricing:{prompt:'0',completion:'0'}},{id:'vendor/chat:free',context_length:65536,supported_parameters:[]}]};
test('catálogo incorpora free por proveedor, contexto real y capacidades; excluye de pago y protocolos ajenos',()=>{
 assert.deepEqual(providers.map(p=>p.id),['opencode','openrouter']);const zen=catalogModels('opencode',{data:[{id:'space-bunny-free'},{id:'big-pickle'},{id:'mimo-v2.5-free'},{id:'jev-1.13-free'},{id:'muse-spark-1.3-contributor-free'},{id:'paid'}]});assert.deepEqual(zen.map(p=>p.id),['space-bunny-free','big-pickle','mimo-v2.5-free']);assert.equal(zen[0].context,1000000);assert.equal(zen[0].contextKnown,true);
 const or=catalogModels('openrouter',{data:[...orCatalog.data,{id:'vendor/paid:free',pricing:{prompt:'1',completion:'0'}},{id:'vendor/paid',pricing:{prompt:'0',completion:'0'}},{id:'unsafe\x1b:free'}]});assert.equal(or.length,2);assert.equal(or.find(p=>p.id==='vendor/coder:free').context,262144);assert.equal(or.find(p=>p.id==='vendor/chat:free').supportsTools,false);assert.throws(()=>modelProfile('qwen3.8-27b-abliterated',zen));
});
test('/connect habilita solo modelos del proveedor conectado y autentica OpenRouter antes del catálogo',async()=>{
 const requests=[],registry=modelRegistry({fetcher:async(url,options)=>{requests.push({url,key:options.headers.Authorization});return url.endsWith('/key')?json({data:{label:'test'}}):json(url.includes('openrouter')?orCatalog:{data:[{id:'space-bunny-free'},{id:'mimo-v2.5-free'}]});}});assert.deepEqual(registry.list(),[]);await registry.connect('opencode','zen-secret');assert.equal(registry.list().length,2);assert.ok(registry.list().every(p=>p.providerId==='opencode'));await registry.connect('openrouter','or-secret');assert.equal(registry.list().length,4);assert.equal(requests[1].url,'https://openrouter.ai/api/v1/key');assert.equal(requests[1].key,'Bearer or-secret');const p=modelProfile('vendor/coder:free',registry.list());assert.equal(registry.keyFor(p),'or-secret');registry.clear();assert.deepEqual(registry.list(),[]);assert.deepEqual(registry.secrets(),[]);
});
test('clave inválida, fallo de catálogo y cancelación no activan modelos ni sustituyen conexión existente',async()=>{
 let fail=false;const registry=modelRegistry({fetcher:async(url)=>fail?new Response('error',{status:401}):json(url.endsWith('/key')?{data:{}}:orCatalog)});await registry.connect('openrouter','good');fail=true;await assert.rejects(registry.connect('openrouter','bad'),/HTTP 401/);assert.equal(registry.keyFor(registry.list()[0]),'good');const fresh=modelRegistry({fetcher:async()=>json({wrong:[]})});await assert.rejects(fresh.connect('opencode','key'),/Catálogo/);assert.deepEqual(fresh.list(),[]);const abort=new AbortController();abort.abort();await assert.rejects(fresh.connect('opencode','key',abort.signal));assert.deepEqual(fresh.list(),[]);
});
test('selector filtra, navega con flechas, vuelve circularmente y no elige en lista vacía',()=>{
 const picker={items:[{id:'a',label:'Space Bunny',description:'OpenCode',value:1},{id:'b',label:'Coder',description:'OpenRouter',value:2}],index:0};movePicker(picker,1);assert.equal(selectedItem(picker).value,2);movePicker(picker,1);assert.equal(selectedItem(picker).value,1);movePicker(picker,-1);assert.equal(selectedItem(picker).value,2);assert.equal(pickerItems(picker,'router').length,1);assert.equal(selectedItem(picker,'router').value,2);assert.equal(selectedItem(picker,'ausente'),null);
});
test('OpenRouter conserva endpoint/modelo/clave y padre e hijos usan su presupuesto real',async()=>{
 const p=modelProfile('vendor/coder:free',catalogModels('openrouter',orCatalog));let parentCalls=0;const meters=[];
 const history=await runAgent({key:'or-secret',model:p.id,endpoint:p.endpoint,providerName:p.provider,history:[],text:'Colabora',plugin:null,settings:{...defaultSettings(),context_tokens:p.context,context_estimated:!p.contextKnown},onState:()=>{},onText:()=>{},onUsage:()=>{},onContext:m=>meters.push(m),fetcher:async(url,options)=>{assert.equal(url,p.endpoint);assert.equal(options.headers.Authorization,'Bearer or-secret');const body=JSON.parse(options.body);assert.equal(body.model,p.id);if(body.messages[0].content.includes('Eres un hijo.'))return response({content:'Hijo revisó'});if(!parentCalls++)return response({tool_calls:[call('s','spawn_agent',{name:'Revisor',task:'Revisa'})]});return response({content:'Padre verificó'});}});
 assert.equal(history.at(-1).content,'Padre verificó');assert.ok(meters.every(m=>m.limit===262144&&!m.limitEstimated));assert.ok(history.some(m=>/hijos/.test(m.content||'')));
 await assert.rejects(completion({key:'or-secret',model:p.id,endpoint:p.endpoint,providerName:p.provider,messages:[],fetcher:async()=>new Response('or-secret',{status:401})}),/OpenRouter HTTP 401: \[oculto\]/);
});
test('modelo sin tools funciona como chat y no promete acciones de archivos',async()=>{
 await runAgent({key:'test',history:[],text:'Hola',plugin:null,settings:{...defaultSettings(),supports_tools:false},onState:()=>{},onText:()=>{},onUsage:()=>{},fetcher:async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.tools,undefined);assert.match(body.messages[0].content,/No afirmes que has leído/);return response({content:'Hola'});}});
});
test('catálogo actualizado sin modelos gratuitos retira opciones anteriores',async()=>{
 let empty=false;const registry=modelRegistry({fetcher:async()=>json({data:empty?[]:[{id:'space-bunny-free'}]})});await registry.connect('opencode','key');assert.equal(registry.list().length,1);empty=true;await registry.connect('opencode','key');assert.equal(registry.connected('opencode'),true);assert.deepEqual(registry.list(),[]);
});
