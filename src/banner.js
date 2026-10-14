import stringWidth from 'string-width';
import {dinosaur} from './dinosaur.js';
const segments=new Intl.Segmenter('es',{granularity:'grapheme'});
export function clipTerminal(text,width){let result='',used=0;for(const token of String(text).split(/(\x1b\[[\d;]*m)/)){if(/^\x1b\[/.test(token)){result+=token;continue;}for(const {segment} of segments.segment(token)){const n=stringWidth(segment);if(used+n>width)return result;result+=segment;used+=n;}}return result;}
export function banner({width,height,state='idle',frame=0,color=true,reset='',version='1.7.0',model='space-bunny-free',provider='OpenCode Zen',path='',paint=t=>t}){
 if(width<24||height<12)return [paint(clipTerminal('Burpy '+version+' · '+model,width),'accent')];
 const small=width<76||height<31,logo=dinosaur(color,state,frame,small),logoWidth=small?12:28,gap=2,right=Math.max(1,width-logoWidth-gap),info=[['Burpy '+version,'accent'],[model,'muted'],[small&&provider==='OpenCode Zen'?'Zen':provider,'muted'],[small?'Ideas que avanzan.':'Ideas que avanzan.','muted'],[stringWidth(path)>right?'…'+Array.from(path).slice(-(right-1)).join(''):path,'muted']];
 if(!small)info.splice(4,0,['Superpowers disponible','muted']);
 return logo.map((row,i)=>row+reset+' '.repeat(gap)+(info[i]?paint(clipTerminal(info[i][0],right),info[i][1]):'')+reset);
}
