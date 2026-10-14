import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sessionStore} from '../src/sessions.js';
test('sesión persiste conversación, contexto, tareas, historial y tokens al reabrir',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'burpy-session-'));
 try{const store=await sessionStore(dir,join(dir,'state')),s=store.fresh();s.messages=[{role:'user',text:'hola'}];s.apiHistory=[{role:'user',content:'hola'},{role:'assistant',content:'respuesta'}];s.todos=[{id:'1',text:'revisar',status:'completed'}];s.children=[{id:'child',status:'completed',history:[{role:'assistant',content:'Revisión'}]}];s.compactions=2;s.contextUsage={tokens:2000,limit:32768,percent:6.1,estimated:false,ratio:0.75};s.inputHistory=['hola'];s.tokenCount=42;s.usageKnown=true;await store.save(s);
 const reopened=await sessionStore(dir,join(dir,'state')),restored=await reopened.latest();assert.deepEqual(restored.messages,s.messages);assert.deepEqual(restored.apiHistory,s.apiHistory);assert.deepEqual(restored.todos,s.todos);assert.deepEqual(restored.children,s.children);assert.equal(restored.compactions,2);assert.deepEqual(restored.contextUsage,s.contextUsage);assert.deepEqual(restored.inputHistory,s.inputHistory);assert.equal(restored.tokenCount,42);assert.equal((await reopened.find(s.id.slice(0,8))).id,s.id);assert.equal((await stat(join(store.directory,s.id+'.json'))).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('guardado atómico y ordenado, proyectos aislados, sin claves ni permisos',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'burpy-session-'));
 try{const {mkdir}=await import('node:fs/promises');await mkdir(join(dir,'other'));const store=await sessionStore(dir,join(dir,'state')),s=store.fresh();s.apiKey='secret';s.permissions=['bash:session'];s.messages=[{role:'user',text:'secret'}];const a=store.save(s,'secret');s.messages=[{role:'user',text:'nuevo'}];const b=store.save(s,'secret');await Promise.all([a,b]);assert.equal((await store.latest()).messages[0].text,'nuevo');const raw=await readFile(join(store.directory,s.id+'.json'),'utf8');assert.ok(!raw.includes('apiKey'));assert.ok(!raw.includes('permissions'));assert.ok(!raw.includes('secret'));
 const other=await sessionStore(join(dir,'other'),join(dir,'state'));assert.equal(await other.latest(),null);await assert.rejects(store.load('../outside'),/inválido/);await assert.rejects(store.find('unknown'),/no encontrada/);
 await writeFile(join(store.directory,'latest.json'),'invalid');await assert.rejects(store.latest(),/recuperar/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
