import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wrap} from '../src/core.js';
import {displayDetail,moveChoice,selectedAnswer} from '../src/activity.js';
test('archivos conservan líneas y cambios muestran fragmentos',()=>{
 assert.deepEqual(wrap('uno\ndos\ttres\x1b[31m',30),['uno','dos  tres[31m']);
 assert.equal(displayDetail('read',{}, {content:'a\nb'}),'a\nb');
 assert.equal(displayDetail('edit',{old_text:'a',new_text:'b'},{edited:'x'}),'− a\n+ b');
});
test('preguntas: flechas, opciones, respuesta propia y retorno circular',()=>{
 const task={questions:[{options:['A','B']}],index:0,selected:0};
 assert.equal(selectedAnswer(task,''),'A');moveChoice(task,1);assert.equal(selectedAnswer(task,''),'B');
 moveChoice(task,1);assert.equal(selectedAnswer(task,''),'');assert.equal(selectedAnswer(task,'Propia'),'Propia');
 moveChoice(task,1);assert.equal(task.selected,0);moveChoice(task,-1);assert.equal(task.selected,2);
});
import {animationState} from '../src/activity.js';
test('animación corresponde a texto visible, herramienta, pregunta, espera y AFK',()=>{
 const base={busy:true,state:'tools',lastTextAt:1000,lastActivity:1000,now:1100};assert.equal(animationState(base),'tools');assert.equal(animationState({...base,state:'speaking'}),'typing');assert.equal(animationState({...base,state:'speaking',now:1700}),'thinking');assert.equal(animationState({...base,state:'asking'}),'idle');assert.equal(animationState({...base,busy:false}),'idle');assert.equal(animationState({...base,busy:false,now:32000}),'sleep');
});
