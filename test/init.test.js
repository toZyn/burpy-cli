import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
test('/init inspecciona proyecto actual, escribe AGENTS.md y /compact mantiene sesión',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'burpy-init-'));
 try{
 await writeFile(join(dir,'package.json'),JSON.stringify({name:'proyecto-prueba',scripts:{test:'node --test'}}));
 const mock=join(dir,'provider.mjs');await writeFile(mock,`let step=0;globalThis.fetch=async(_url,request)=>{if(!request.body)return new Response(JSON.stringify({data:[{id:'space-bunny-free'}]}));const body=JSON.parse(request.body);let message;if(!body.tools)message={role:'assistant',content:'Proyecto proyecto-prueba, AGENTS.md generado; verificar node --test.'};else if(step++===0){if(!body.messages.at(-1).content.includes('proyecto real'))throw Error('Falta inspección');message={role:'assistant',content:'Inspecciono',tool_calls:[{id:'read',type:'function',function:{name:'read',arguments:JSON.stringify({path:'package.json'})}}]};}else if(step===2){if(!body.messages.at(-1).content.includes('proyecto-prueba'))throw Error('No leyó proyecto');message={role:'assistant',content:'Documento',tool_calls:[{id:'write',type:'function',function:{name:'create',arguments:JSON.stringify({path:'AGENTS.md',content:'# proyecto-prueba\\nPruebas: node --test\\n'})}}]};}else message={role:'assistant',content:'AGENTS.md generado'};return new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}),{headers:{'content-type':'application/json'}});};`);
 const result=spawnSync(process.execPath,['--import',mock,resolve('src/cli.js'),'--plain'],{cwd:dir,input:'/auto on\n/init\n/compact\n/exit\n',encoding:'utf8',timeout:10000,env:{...process.env,OPENCODE_API_KEY:'test-key',BURPY_DATA_DIR:join(dir,'state')}});
 assert.equal(result.status,0,result.stderr);assert.match(await readFile(join(dir,'AGENTS.md'),'utf8'),/proyecto-prueba/);assert.match(result.stdout,/Contexto compactado/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
