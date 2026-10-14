const tones=Array.from({length:8},(_,step)=>[103,125,115].map((v,i)=>Math.round(v+([230,245,237][i]-v)*step/7)).join(';'));
export function glass(text,phase=0,color=true,offset=0){
 if(!color)return text;
 const chars=Array.from(text),period=Math.max(72,chars.length+28);let output='',last=-1;
 for(let i=0;i<chars.length;i++){const distance=Math.abs(((i+offset-phase)%period+period)%period-period/2),tone=Math.round(Math.exp(-distance*distance/45)*7);if(tone!==last){output+=`\x1b[38;2;${tones[tone]}m`;last=tone;}output+=chars[i];}
 return output;
}
