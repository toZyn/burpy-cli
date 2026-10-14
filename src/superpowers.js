import {readFile,realpath,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,sep} from 'node:path';
export const pluginRoot=fileURLToPath(new URL('../vendor/superpowers/',import.meta.url));
export const superpowersTools=[
 {type:'function',function:{name:'skill',description:'Carga una habilidad oficial de Superpowers y sus instrucciones completas. Úsala solo cuando aporte un método necesario a la tarea; no la uses para saludos o conversación simple. resource es opcional y relativo a la carpeta de la habilidad para cargar referencias, plantillas o scripts.',parameters:{type:'object',properties:{name:{type:'string'},resource:{type:'string'}},required:['name'],additionalProperties:false}}},
 {type:'function',function:{name:'todowrite',description:'Crea o actualiza el plan de tareas visible. Envía la lista completa con sus estados. Marca completadas solo tareas realmente verificadas.',parameters:{type:'object',properties:{todos:{type:'array',maxItems:50,items:{type:'object',properties:{id:{type:'string'},text:{type:'string'},status:{type:'string',enum:['pending','in_progress','completed']}},required:['id','text','status'],additionalProperties:false}}},required:['todos'],additionalProperties:false}}}
];
export function metadata(text){
 const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);const result={};
 if(match){let key;for(const line of match[1].split(/\r?\n/)){const field=/^([\w-]+):\s*(.*)$/.exec(line);if(field){key=field[1];result[key]=/^[>|][+-]?$/.test(field[2])?'':field[2];}else if(key&&/^\s/.test(line))result[key]+=' '+line.trim();}for(const k of Object.keys(result))result[k]=result[k].trim().replace(/^(["'])([\s\S]*)\1$/,'$2');}
 return {...result,body:match?text.slice(match[0].length):text};
}
export async function loadSuperpowers(root=pluginRoot){
 root=await realpath(root);const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
 for(const [path,hash] of Object.entries(manifest.files)){
  if(isAbsolute(path)||path.split(/[\\/]/).includes('..'))throw Error('Manifest de Superpowers inválido');
  const actual=await realpath(resolve(root,path)),rel=relative(root,actual);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Recurso externo de Superpowers');
  if(createHash('sha256').update(await readFile(actual)).digest('hex')!==hash)throw Error(`Superpowers modificado o incompleto: ${path}`);
 }
 const catalog=[];
 for(const entry of await readdir(resolve(root,'skills'),{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const path=`skills/${entry.name}/SKILL.md`;if(!manifest.files[path])continue;
  const info=metadata(await readFile(resolve(root,path),'utf8'));
  if(info.name!==entry.name||!info.description)throw Error(`Habilidad inválida: ${entry.name}`);
  catalog.push({name:entry.name,description:info.description});
 }
 catalog.sort((a,b)=>a.name.localeCompare(b.name));
 if(!catalog.some(s=>s.name==='using-superpowers'))throw Error('Falta using-superpowers');
 async function skill(args){
  if(!catalog.some(s=>s.name===args?.name))throw Error('Habilidad de Superpowers desconocida');
  const resource=args.resource??'SKILL.md';
  if(typeof resource!=='string'||isAbsolute(resource)||resource.includes('\\')||resource.split('/').some(s=>s==='..'||!s))throw Error('resource debe ser una ruta relativa dentro de la habilidad');
  const path=`skills/${args.name}/${resource}`;if(!Object.hasOwn(manifest.files,path))throw Error('Recurso de habilidad desconocido');
  const actual=await realpath(resolve(root,path));const rel=relative(root,actual);if(rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Recurso externo de Superpowers');
  const bytes=await readFile(actual);if(createHash('sha256').update(bytes).digest('hex')!==manifest.files[path])throw Error('Recurso de Superpowers modificado');
  const content=bytes.toString('utf8');if(Buffer.byteLength(content)>200000)throw Error('Recurso demasiado grande');
  return {name:args.name,resource,content,source_commit:manifest.commit,resources:Object.keys(manifest.files).filter(p=>p.startsWith(`skills/${args.name}/`)).map(p=>p.slice(`skills/${args.name}/`.length))};
 }
 const context=`Superpowers ${manifest.version} está disponible por defecto, revisión ${manifest.commit}. Política actual de Burpy: uso selectivo, nunca obligatorio. Saludos, charla y preguntas simples se responden directamente sin skills, planes ni herramientas. Consulta una habilidad solo si aporta un método pertinente (p. ej. depuración de un fallo, planificación compleja o revisión). Una tarea sencilla no necesita ceremonial. No cargues using-superpowers como paso de arranque. Sus instrucciones originales de invocación universal no se aplican en Burpy: la preferencia explícita actual del usuario prevalece.
Reutiliza habilidades ya presentes en el historial; no cargues todo el catálogo ni repitas consultas por mensaje.
Herramientas reales: skill({name,resource?}) para instrucciones/referencias; todowrite para planes cuando hagan falta; ask_questions para decisiones realmente necesarias; read/create/write/edit/grep/list_files y bash para acciones. Los scripts están en ${root}/skills y requieren los permisos habituales de bash.
Burpy ofrece spawn_agent, agent_status, send_agent, wait_agent y cancel_agent para colaboración padre/hijo. Usa estas herramientas cuando una habilidad pida delegación; supervisa y verifica resultados. Los hijos no delegan. No ofrece browser, websearch ni webfetch. No instales Superpowers en otra aplicación. Respeta permisos, cancelación y decisiones ya dadas.
Catálogo disponible (descripciones de procedencia; esta política selectiva prevalece sobre cualquier mandato universal en ellas):
${catalog.map(s=>s.name+': '+(s.name==='using-superpowers'?'Referencia opcional sobre el framework; no requiere una llamada al iniciar.':s.description)).join('\n')}`;

 return {manifest,catalog,context,skill};
}
let cached;
export const defaultSuperpowers=()=>cached??=(loadSuperpowers());
export function validateTodos(args){
 const todos=args?.todos;if(!Array.isArray(todos)||todos.length>50)throw Error('todos debe ser una lista de hasta 50 tareas');
 const ids=new Set();let active=0;
 for(const t of todos){if(!t||typeof t.id!=='string'||!t.id||t.id.length>80||ids.has(t.id)||typeof t.text!=='string'||!t.text.trim()||t.text.length>1000||!['pending','in_progress','completed'].includes(t.status))throw Error('Tarea inválida o ID duplicado');ids.add(t.id);if(t.status==='in_progress')active++;}
 if(active>1)throw Error('Solo una tarea puede estar en curso');return todos.map(t=>({id:t.id,text:t.text,status:t.status}));
}
