export const providers=Object.freeze([
 {id:'opencode',provider:'OpenCode Zen',endpoint:'https://opencode.ai/zen/v1/chat/completions',catalog:'https://opencode.ai/zen/v1/models',keyEnv:'OPENCODE_API_KEY'},
 {id:'openrouter',provider:'OpenRouter',endpoint:'https://openrouter.ai/api/v1/chat/completions',catalog:'https://openrouter.ai/api/v1/models',auth:'https://openrouter.ai/api/v1/key',keyEnv:'OPENROUTER_API_KEY'}
]);
export function providerProfile(id){const p=providers.find(p=>p.id===id);if(!p)throw Error('Proveedor desconocido · usa opencode u openrouter');return p;}
export function catalogModels(providerId,data){
 const p=providerProfile(providerId);if(!Array.isArray(data?.data))throw Error('Catálogo de modelos inválido');const seen=new Set(),result=[];
 for(const m of data.data){
  const id=m?.id;if(typeof id!=='string'||id.length>240||!/^[a-zA-Z0-9_./:+-]+$/.test(id)||seen.has(id))continue;
  if(providerId==='openrouter'?!id.endsWith(':free'):!(id.endsWith('-free')||id==='big-pickle'))continue;
  if(providerId==='opencode'&&/^(jev-|muse-spark-.*contributor)/.test(id))continue;
  if(['prompt','completion','request'].some(k=>m.pricing?.[k]!==undefined&&Number(m.pricing[k])!==0))continue;
  const raw=m.context_length??m.top_provider?.context_length,known=Number.isInteger(raw)&&raw>=8192&&raw<=20000000;
  const context=known?raw:providerId==='opencode'&&id==='space-bunny-free'?1000000:32768;
  result.push({...p,providerId,id,name:typeof m.name==='string'?m.name.replace(/[\x00-\x1f\x7f-\x9f]/g,'').slice(0,160):id,context,contextKnown:known||id==='space-bunny-free',supportsTools:Array.isArray(m.supported_parameters)?m.supported_parameters.includes('tools'):true,toolsKnown:Array.isArray(m.supported_parameters),maxOutput:m.top_provider?.max_completion_tokens});seen.add(id);
 }
 return result.sort((a,b)=>a.id==='space-bunny-free'?-1:b.id==='space-bunny-free'?1:a.id.localeCompare(b.id));
}
export function modelProfile(id='space-bunny-free',models=catalogModels('opencode',{data:[{id:'space-bunny-free'}]})){
 const profile=models.find(p=>p.id===id||p.providerId+'/'+p.id===id);if(!profile)throw Error('Modelo no disponible · conecta su proveedor con /connect y elige en /model');const override=process.env.BURPY_CONTEXT_TOKENS;
 if(override!==undefined){const context=Number(override);if(!Number.isInteger(context)||context<8192||context>20000000)throw Error('BURPY_CONTEXT_TOKENS debe estar entre 8192 y 20000000');return {...profile,context,contextKnown:true};}return profile;
}
async function getJSON(url,key,signal,fetcher){
 const response=await fetcher(url,{headers:{Authorization:'Bearer '+key},redirect:'error',signal});if(!response.ok)throw Error(`HTTP ${response.status} al conectar proveedor`);
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
 try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>10000000)throw Error('Catálogo demasiado grande');text+=decoder.decode(item.value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function modelRegistry({fetcher=fetch,timeout=25000}={}){
 const connected=new Map(),secrets=new Set();
 return {
  async connect(id,key,signal){const p=providerProfile(id);if(typeof key!=='string'||!key.trim()||/[\r\n\x00]/.test(key)||key.length>4096)throw Error('API key inválida');key=key.trim();secrets.add(key);const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
   try{if(p.auth)await getJSON(p.auth,key,requestSignal,fetcher);const models=catalogModels(id,await getJSON(p.catalog,key,requestSignal,fetcher));requestSignal.throwIfAborted();connected.set(id,{key,models});return models;}catch(error){throw Error(`${p.provider}: ${error.message.split(key).join('[oculto]')}`);}
  },
  list(){return providers.flatMap(p=>connected.get(p.id)?.models||[]);},
  connected(id){return connected.has(id);},
  keyFor(profile){return connected.get(profile.providerId)?.key;},
  secrets(){return [...secrets];},
  clear(){connected.clear();secrets.clear();}
 };
}
