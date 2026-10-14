import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {clean,matchingCommands} from '../src/core.js';
import {mascotPixels} from '../src/dinosaur.js';
test('neutraliza controles de terminal',()=>assert.equal(clean('hola\x1b[2J\x07'),'hola[2J'));
test('sin clave no envía una conversación',()=>{const env={...process.env};delete env.OPENCODE_API_KEY;delete env.OPENROUTER_API_KEY;const r=spawnSync(process.execPath,['src/cli.js'],{input:'hola\n',encoding:'utf8',env});assert.equal(r.status,0);assert.match(r.stdout,/connect/);});
test('lista slash filtrable',()=>assert.deepEqual(matchingCommands('/ex').map(c=>c.name),['/export','/exit']));
test('mascota cambia según actividad sin variar tamaño',()=>{const states=['idle','thinking','speaking','tools','sleep'].map(s=>mascotPixels(s,1));for(const g of states){assert.equal(g.length,24);assert.ok(g.every(r=>r.length===28));}assert.equal(new Set(states.map(g=>JSON.stringify(g))).size,5);assert.notDeepEqual(mascotPixels('speaking',0),mascotPixels('speaking',3));assert.notDeepEqual(mascotPixels('tools',0),mascotPixels('tools',3));});
