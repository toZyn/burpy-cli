import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownRows,scrollOffset} from '../src/markdown.js';
import {mouseInput} from '../src/mouse.js';
import {mascotPixels} from '../src/dinosaur.js';
test('Markdown incremental, código literal y colores que no contaminan la siguiente línea',()=>{
 const plain=markdownRows('# Título\n**Hola** y `node`\n- elemento\n```js\nconst x="**literal**";\n```\n[Guía](https://example.com)',70,{color:false});
 assert.equal(plain[0],'Título');assert.ok(plain.includes('Hola y node'));assert.ok(plain.includes('• elemento'));assert.ok(plain.includes('│ const x="**literal**";'));assert.ok(plain.includes('Guía (https://example.com)'));
 assert.deepEqual(markdownRows('**Hola',70,{color:false}),['**Hola']);assert.deepEqual(markdownRows('**Hola**',70,{color:false}),['Hola']);
 const styled=markdownRows('**Texto muy largo** normal',6);assert.ok(styled.every(l=>l.replace(/\x1b\[[\d;]*m/g,'').length<=6));assert.match(styled[0],/\x1b\[0m/);assert.ok(!markdownRows('\x1b[2JHola',70).join('').includes('\x1b[2J'));
});
test('scroll limitado al historial y mascota teclea durante respuesta',()=>{assert.equal(scrollOffset(0,20,10,5),5);assert.equal(scrollOffset(5,-20,10,5),0);assert.notDeepEqual(mascotPixels('typing',0),mascotPixels('typing',2));assert.deepEqual(mascotPixels('typing',2),mascotPixels('tools',2));});
test('rueda del mouse fragmentada no se incorpora al prompt ni pierde UTF8',async()=>{
 const deltas=[],stream=mouseInput(n=>deltas.push(n));let output='';stream.on('data',d=>output+=d.toString());stream.write('hola');stream.write('\x1b');stream.write('[<64;3;7M');stream.write('\x1b[<65;3;7M');const bytes=Buffer.from('ñ');stream.write(bytes.subarray(0,1));stream.end(bytes.subarray(1));await new Promise(r=>stream.on('end',r));assert.deepEqual(deltas,[3,-3]);assert.equal(output,'holañ');
});
import stringWidth from 'string-width';
test('tablas con alineación, celdas escapadas, Unicode y adaptación estrecha sin perder datos',()=>{
 const source='| Nombre | Valor |\n| :--- | ---: |\n| **漢字 🦖** | `a\\|b` |\n| Otro muy largo que necesita envolver | *dato* |';
 for(const width of [70,32,18,8]){const rows=markdownRows(source,width);assert.ok(rows.every(r=>stringWidth(r)<=width),rows.join('\n'));const plain=rows.map(r=>r.replace(/\x1b\[[\d;]*m/g,''));assert.ok(plain.join('').includes('漢字'));assert.ok(plain.join('').includes('dato'));if(width>=18)assert.ok(plain[0].includes('┌'));}
});
test('formato anidado, listas numeradas, citas, entidades, enlaces y bloques abiertos',()=>{
 const rows=markdownRows('## Título\n\n**negrita con *cursiva*** y ~~tachado~~ &amp; `x_y`\n\n3. primero\n   - hijo\n4. segundo\n\n> cita\n\n~~~unknown\n<b>literal</b> **sin estilo**\n',70,{color:false}).join('\n');
 assert.match(rows,/negrita con cursiva y tachado & x_y/);assert.match(rows,/3\. primero/);assert.match(rows,/• hijo/);assert.match(rows,/4\. segundo/);assert.match(rows,/│ cita/);assert.match(rows,/<b>literal<\/b> \*\*sin estilo\*\*/);
 const safe=markdownRows('[malo](javascript:alert(1))\n\u001b[31m texto',70).join('');assert.ok(!safe.includes('\u001b[31m'));assert.ok(safe.includes('[malo]'));
 const styled=markdownRows('```js\nconst x = "<hola>&";\n```',40).join('\n');assert.match(styled,/\x1b\[38;2/);assert.ok(styled.replace(/\x1b\[[\d;]*m/g,'').includes('"<hola>&"'));assert.ok(!styled.includes('<span'));
});
test('cada prefijo de stream se renderiza y la caché no expone arreglos mutables',()=>{
 const text='# Título\n\n| A | B |\n| --- | --- |\n| **Hola** | `x` |\n\n```js\nconst x = 42;\n```';for(let i=1;i<=text.length;i++)assert.ok(markdownRows(text.slice(0,i),24).every(r=>stringWidth(r)<=24));const first=markdownRows(text,24);first.push('corrupto');assert.ok(!markdownRows(text,24).includes('corrupto'));
});
