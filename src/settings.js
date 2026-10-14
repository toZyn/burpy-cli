export const defaultSettings=()=>({auto:false,plan:false,http_ms:120000,bash_ms:30000,output_bytes:30000,rounds:32,max_tokens:4096});
const ranges={http_ms:[1000,600000],bash_ms:[100,600000],output_bytes:[1024,1000000],rounds:[1,64],max_tokens:[256,16384]};
export function validateLimits(values){
 if(!values||typeof values!=='object'||Array.isArray(values)||!Object.keys(values).length)throw Error('Proporciona al menos un límite');
 for(const [key,value] of Object.entries(values)){const range=ranges[key];if(!range||!Number.isInteger(value)||value<range[0]||value>range[1])throw Error(`Límite ${key} inválido${range?`: ${range[0]}–${range[1]}`:''}`);}
 return values;
}
