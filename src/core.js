export const commandInfo=[
 {name:'/plan',description:'Planificar e inspeccionar sin modificar archivos',usage:'/plan'},
 {name:'/build',description:'Volver a ejecución y edición',usage:'/build'},
 {name:'/diff',description:'Ver cambios realizados por las herramientas',usage:'/diff'},
 {name:'/compact',description:'Compactar contexto preservando memoria del proyecto',usage:'/compact'},
 {name:'/init',description:'Inspeccionar y documentar este proyecto en AGENTS.md',usage:'/init'},
 {name:'/agents',description:'Consultar hijos y sus tareas',usage:'/agents'},
 {name:'/help',description:'Ver ayuda de Burpy',usage:'/help'},
 {name:'/sessions',description:'Ver sesiones guardadas',usage:'/sessions'},
 {name:'/resume',description:'Recuperar una sesión guardada',usage:'/resume ID'},
 {name:'/new',description:'Crear una sesión nueva',usage:'/new'},
 {name:'/clear',description:'Limpiar la conversación',usage:'/clear'},
 {name:'/undo',description:'Recuperar la conversación anterior',usage:'/undo'},
 {name:'/export',description:'Guardar la conversación en Markdown',usage:'/export [ruta.md]'},
 {name:'/motion',description:'Activar o desactivar animaciones',usage:'/motion'},
 {name:'/superpowers',description:'Estado y versión del plugin',usage:'/superpowers'},
 {name:'/skills',description:'Listar habilidades incluidas',usage:'/skills'},
 {name:'/connect',description:'Conectar una API key de proveedor',usage:'/connect [opencode|openrouter]'},
 {name:'/model',description:'Elegir modelo con flechas y Enter',usage:'/model [ID]'},
 {name:'/auto',description:'Autoaprobar cambios dentro del workspace',usage:'/auto on|off'},
 {name:'/permissions',description:'Ver o revocar permisos de esta sesión',usage:'/permissions [reset]'},
 {name:'/exit',description:'Cerrar Burpy',usage:'/exit'}
];
export const commands=commandInfo.map(c=>c.name);
export const matchingCommands=text=>commandInfo.filter(c=>c.name.startsWith(text));
export const clean=value=>String(value).replace(/[\x00-\x1f\x7f-\x9f]/g,'').slice(0,12000);
export const cleanMultiline=value=>String(value).replace(/\r\n/g,'\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'').replace(/\t/g,'  ').slice(0,200000);
export function wrap(value,width){
 const result=[];
 for(const paragraph of cleanMultiline(value).split('\n')){
  let line='';
  for(const character of paragraph){
   if(Array.from(line).length>=width){result.push(line);line='';}
   line+=character;
  }
  result.push(line);
 }
 return result;
}
export function transcript(messages){return messages.map(m=>`## ${m.role==='user'?'Tú':'Burpy'}${m.cancelled?' (cancelado)':''}\n\n${m.text}`).join('\n\n');}
