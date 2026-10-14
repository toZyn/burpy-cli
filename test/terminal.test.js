import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {screenPainter,transcriptLayout} from '../src/terminal.js';
import {dinosaur,mascotPalette} from '../src/dinosaur.js';
import {glass} from '../src/glass.js';
const fake=()=>{const stream=new EventEmitter();stream.writes=[];stream.write=text=>{stream.writes.push(text);return !stream.block;};return stream;};
test('repintado diferencial modifica una celda, conserva filas y no emite si nada cambia',()=>{
 const stream=fake(),painter=screenPainter(stream,{synchronized:false});painter.paint({rows:['historial sin cambios','abcdEFGHijkl'],position:[3,2]});stream.writes=[];
 painter.paint({rows:['historial sin cambios','abcdEZGHijkl'],position:[3,2]});const output=stream.writes[0];assert.ok(!output.includes('historial'));assert.ok(!output.includes('abcd'));assert.ok(!output.includes('ijkl'));assert.match(output,/\x1b\[2;6H/);assert.ok(!output.includes('\x1b[2J'));assert.ok(!output.includes('\x1b[?25h'));painter.paint({rows:['historial sin cambios','abcdEZGHijkl'],position:[3,2]});assert.equal(stream.writes.length,1);painter.close();
});
test('limpia cola de líneas reducidas y coloca cursor respetando Unicode y estilos',()=>{
 const stream=fake(),painter=screenPainter(stream,{synchronized:false});painter.paint({rows:['界abcd']});stream.writes=[];painter.paint({rows:['界azcd']});assert.match(stream.writes[0],/\x1b\[1;4H/);painter.paint({rows:['界a']});assert.ok(stream.writes.at(-1).includes('\x1b[K'));painter.paint({rows:['界\x1b[32ma\x1b[0m']});assert.match(stream.writes.at(-1),/\x1b\[32m/);painter.close();
});
test('backpressure conserva solo el frame más reciente y se recupera al drenar',()=>{
 const stream=fake(),painter=screenPainter(stream);stream.block=true;painter.paint({rows:['primero']});painter.paint({rows:['intermedio']});painter.paint({rows:['final']});assert.equal(stream.writes.length,1);stream.block=false;stream.emit('drain');assert.equal(stream.writes.length,2);assert.ok(!stream.writes[1].includes('intermedio'));assert.ok(stream.writes[1].includes('final'));assert.ok(stream.writes[1].endsWith('\x1b[?2026l'));painter.close();
});
test('animaciones e input no recorren historial; una actualización solo vuelve a formatear el bloque modificado',()=>{
 let count=0;const layout=transcriptLayout(m=>{count++;return [m.text];}),messages=Array.from({length:1000},(_,i)=>({text:'Mensaje '+i}));layout.rows(messages,60,1);assert.equal(count,1000);for(let i=0;i<100;i++)layout.rows(messages,60,1);assert.equal(count,1000);messages[500].text='Cambio';assert.equal(layout.rows(messages,60,2)[500],'Cambio');assert.equal(count,1001);
});
test('sombreado y ciclos de mascota mantienen tamaño, adaptan estados y reducen el tráfico de animación',()=>{
 assert.ok(Object.keys(mascotPalette).length>12);for(const small of [true,false])for(const state of ['idle','speaking','thinking','typing','tools','sleep'])for(let frame=0;frame<48;frame++){const rows=dinosaur(true,state,frame,small);assert.equal(rows.length,small?6:12);assert.ok(rows.every(row=>row.replace(/\x1b\[[\d;]*m/g,'').length===(small?12:28)));}
 const stream=fake(),painter=screenPainter(stream);let oldBytes=0;for(let frame=0;frame<48;frame++){const rows=[...dinosaur(true,'typing',frame),'historial fijo',glass('─'.repeat(78),frame)];if(frame)oldBytes+=Buffer.byteLength(rows.join('\n'));painter.paint({rows});}const newBytes=stream.writes.slice(1).reduce((n,s)=>n+Buffer.byteLength(s),0);assert.ok(newBytes<oldBytes*0.6,`${newBytes} vs ${oldBytes}`);painter.close();
});
