import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {workspaceRunner} from '../src/workspace.js';
test('create, edit único, read, grep y protección del workspace',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'burpy-'));
 try{const run=await workspaceRunner(dir,async request=>!request.outside,{auto:true});await run('create',{path:'a.txt',content:'uno\ndos\ntres'});await run('edit',{path:'a.txt',old_text:'dos',new_text:'nuevo'});assert.equal((await run('read',{path:'a.txt'})).content,'uno\nnuevo\ntres');assert.equal((await run('grep',{pattern:'nuevo'})).matches[0].line,2);await assert.rejects(run('create',{path:'a.txt',content:'x'}),/EEXIST/);await assert.rejects(run('read',{path:'../escape'}),/fuera/);await symlink(dir,join(dir,'link'));await assert.rejects(run('read',{path:'link/a.txt'}),/enlaces/);}
 finally{await rm(dir,{recursive:true,force:true});}
});
test('bash exige aprobación y devuelve salida y código',async()=>{
 const deny=await workspaceRunner(tmpdir());assert.equal((await deny('bash',{command:'printf hello'})).denied,true);
 const allow=await workspaceRunner(tmpdir(),async()=>true);const result=await allow('bash',{command:'printf hello'});assert.equal(result.output,'hello');assert.equal(result.exit_code,0);
});
import {defaultSettings} from '../src/settings.js';
test('auto permite cambios internos pero pide permiso fuera',async()=>{
 const base=await mkdtemp(join(tmpdir(),'burpy-scope-')),root=join(base,'project');const {mkdir}=await import('node:fs/promises');await mkdir(root);
 try{const requests=[],settings=defaultSettings();settings.auto=true;const run=await workspaceRunner(root,async request=>{requests.push(request);return true;},settings);await run('create',{path:'inside.txt',content:'in'});assert.equal(requests.length,0);await run('create',{path:'../outside.txt',content:'out'});assert.equal(requests.length,1);assert.equal(requests[0].outside,true);assert.equal(await readFile(join(base,'outside.txt'),'utf8'),'out');await run('write',{path:'../outside.txt',content:'again'});assert.equal(requests.length,1);run.revoke();await run('read',{path:'../outside.txt'});assert.equal(requests.length,2);}
 finally{await rm(base,{recursive:true,force:true});}
});
test('límite de bash configurable termina el proceso',async()=>{const settings=defaultSettings();settings.bash_ms=100;const run=await workspaceRunner(tmpdir(),async()=>true,settings);const result=await run('bash',{command:'sleep 2'});assert.equal(result.timed_out,true);});
test('timeout por llamada, permisos bash recordados y salida incremental',async()=>{
 const settings=defaultSettings();let approvals=0,chunks=[];
 const run=await workspaceRunner(tmpdir(),async()=>{approvals++;return true;},settings,e=>chunks.push(e.text));
 const first=await run('bash',{command:'printf start; sleep 2',timeout:100});assert.equal(first.timed_out,true);assert.equal(chunks.join(''),'start');assert.equal(settings.bash_ms,30000);
 assert.equal((await run('bash',{command:'printf next'})).output,'next');assert.equal(approvals,1);
 run.revoke();await run('bash',{command:'true'});assert.equal(approvals,2);
 await assert.rejects(run('bash',{command:'true',timeout:-1}),/timeout/);
 await assert.rejects(run('set_limits',{rounds:64}),/no disponible/);
});
test('read paginado evita cargar todo el archivo y permite continuar',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'burpy-read-'));try{await writeFile(join(dir,'lines.txt'),Array.from({length:450},(_,i)=>'Línea '+(i+1)).join('\n'));const run=await workspaceRunner(dir);const first=await run('read',{path:'lines.txt'});assert.equal(first.lines,200);assert.equal(first.next_offset,201);const tail=await run('read',{path:'lines.txt',offset:401,limit:100});assert.equal(tail.lines,50);assert.ok(tail.content.startsWith('Línea 401'));assert.equal(tail.next_offset,undefined);await assert.rejects(run('read',{path:'lines.txt',offset:0}));}finally{await rm(dir,{recursive:true,force:true});}
});
test('plan bloquea escritura y bash, diff agrupa cambios y aprobaciones concurrentes se preguntan una vez',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'burpy-plan-'));try{let prompts=0;const settings={auto:true,plan:true,output_bytes:30000,bash_ms:30000},run=await workspaceRunner(dir,async()=>{prompts++;await new Promise(r=>setTimeout(r,10));return true;},settings);
 await writeFile(join(dir,'file.txt'),'antes');await assert.rejects(run('write',{path:'file.txt',content:'después'}),/Modo plan/);await assert.rejects(run('bash',{command:'echo test'}),/Modo plan/);assert.equal((await run('read',{path:'file.txt'})).content,'antes');settings.plan=false;await run('write',{path:'file.txt',content:'después'});await run('edit',{path:'file.txt',old_text:'después',new_text:'final'});assert.equal(run.changes()[0].preview,'− antes\n+ final');assert.equal(run.changes().length,1);
 const results=await Promise.all([run('bash',{command:'printf uno'}),run('bash',{command:'printf dos'})]);assert.equal(prompts,1);assert.deepEqual(results.map(r=>r.output),['uno','dos']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
