import {cleanMultiline} from './core.js';
export function toolDetail(name,args={},output){
 if(name==='skill')return output?.error?`Error: ${output.error}`:output?`Habilidad ${output.cached?'reutilizada':'cargada'}: ${output.name} · ${output.resource}\n${output.resources.length} recursos disponibles`:args.name+(args.resource?' · '+args.resource:'');
 if(name==='todowrite')return (output?.todos||args.todos||[]).map(t=>`${{pending:'○',in_progress:'◌',completed:'✓'}[t.status]} ${t.text}`).join('\n');
 if(output===undefined){
  if(name==='edit')return `− ${args.old_text||''}\n+ ${args.new_text||''}`;
  if(['write','create'].includes(name))return args.content||'';
  if(name==='bash')return `$ ${args.command}${args.timeout?`\ntimeout: ${args.timeout} ms`:''}`;
  return args.path||args.pattern||'';
 }
 if(output.error)return `Error: ${output.error}`;
 if(output.denied)return 'Permiso rechazado';
 if(name==='read')return output.content+(output.next_offset?`\n… Más líneas: read offset ${output.next_offset} · ${output.total_lines} en total`:'');
 if(name==='bash')return `${output.output||'(sin salida)'}\nCódigo: ${output.exit_code??'—'}${output.timed_out?' · timeout alcanzado':''}${output.truncated?' · salida truncada':''}`;
 if(name==='grep')return output.matches.map(m=>`${m.path}:${m.line}  ${m.text}`).join('\n')||'Sin coincidencias';
 if(name==='list_files')return output.entries.map(e=>e.name+(e.type==='directory'?'/':'')).join('\n');
 if(['write','create','edit'].includes(name))return toolDetail(name,args);
 return JSON.stringify(output,null,2);
}
export const displayDetail=(name,args,output)=>cleanMultiline(toolDetail(name,args,output)||'');
export function moveChoice(task,delta){const q=task.questions[task.index],count=(q.options?.length||0)+1;task.selected=(task.selected+delta+count)%count;return task.selected;}
export function selectedAnswer(task,input){const q=task.questions[task.index];return input.trim()?input:q.options?.[task.selected]||'';}

export function animationState({busy,state,lastTextAt,lastActivity,now=Date.now()}){if(!busy)return now-lastActivity>30000?'sleep':'idle';if(state==='supervising')return 'thinking';if(state==='asking')return 'idle';if(state==='speaking'&&now-lastTextAt>500)return 'thinking';return state==='speaking'?'typing':state;}
