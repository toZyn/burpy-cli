import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import stringWidth from 'string-width';
import {cleanMultiline} from './core.js';
const parser=new MarkdownIt({html:false,linkify:true,breaks:false,typographer:false}),segmenter=new Intl.Segmenter('es',{granularity:'grapheme'}),cache=new Map();
const palette={keyword:'38;2;195;215;169',string:'38;2;208;183;153',number:'38;2;171;201;191',comment:'2',title:'1;38;2;171;201;191',built_in:'38;2;171;201;191',literal:'38;2;195;215;169',attr:'38;2;208;183;153'};
const span=(text,codes=[])=>({text,codes});
function inline(tokens=[],base=[]){const result=[],styles=[...base],links=[];for(const t of tokens){if(t.type==='strong_open')styles.push('1');else if(t.type==='em_open')styles.push('3');else if(t.type==='s_open')styles.push('9');else if(['strong_close','em_close','s_close'].includes(t.type))styles.pop();else if(t.type==='link_open'){links.push({url:t.attrGet('href'),start:result.length});styles.push('4');}else if(t.type==='link_close'){styles.pop();const link=links.pop();if(link&&result.slice(link.start).map(s=>s.text).join('')!==link.url)result.push(span(` (${link.url})`,['2']));}else if(t.type==='code_inline')result.push(span(t.content,[...styles,'38;2;195;215;169']));else if(t.type==='image')result.push(span(t.content?`[Imagen: ${t.content}]`:'[Imagen]',styles.slice()));else if(t.type==='softbreak')result.push(span(' ',styles.slice()));else if(t.type==='hardbreak')result.push(span('\n',styles.slice()));else if(t.type==='text'||t.type==='html_inline')result.push(span(t.content,styles.slice()));}return result;}
function codeSpans(text,language,color){if(!color||text.length>20000||!hljs.getLanguage(language))return [span(text)];try{const html=hljs.highlight(text,{language,ignoreIllegals:true}).value,parts=[],stack=[];for(const part of html.split(/(<[^>]*>)/)){if(part.startsWith('<span')){const name=/class="hljs-([^" ]+)/.exec(part)?.[1];stack.push(palette[name]||'');}else if(part==='</span>')stack.pop();else if(!part.startsWith('<'))parts.push(span(part.replace(/&(amp|lt|gt|quot|#x27|#39);/g,(_m,n)=>({amp:'&',lt:'<',gt:'>',quot:'"','#x27':"'",'#39':"'"}[n])),stack.filter(Boolean)));}return parts;}catch{return [span(text)];}}
function layout(spans,width,prefix='',continuation=prefix){const lines=[];let row=[],used=0;
 const add=(text,codes)=>{const last=row.at(-1);if(last&&last.codes.join(';')===codes.join(';'))last.text+=text;else row.push(span(text,codes));};
 const begin=lead=>{row=[];used=0;for(const {segment} of segmenter.segment(lead)){const n=stringWidth(segment);if(used+n>width)break;add(segment,[]);used+=n;}};
 begin(prefix);
 for(const part of spans)for(const {segment} of segmenter.segment(part.text)){if(segment==='\n'){lines.push(row);begin(continuation);continue;}const n=stringWidth(segment);if(used+n>width){lines.push(row);begin(continuation);}if(used+n>width){add('�',part.codes);used++;}else{add(segment,part.codes);used+=n;}}
 lines.push(row);return lines;
}
export function markdownRows(value,width,{color=true,reset='\x1b[0m'}={}){
 width=Math.max(4,Math.floor(width));value=cleanMultiline(value);const key=JSON.stringify([value,width,color,reset]);if(cache.has(key))return cache.get(key).slice();
 const rows=[],tokens=parser.parse(value,{}),lists=[];let quote=0,item=null,heading=false;
 const paint=parts=>parts.map(p=>color&&p.codes.length?`\x1b[${p.codes.join(';')}m${p.text}\x1b[0m${reset}`:p.text).join('');
 const lead=()=>('│ '.repeat(quote)+'  '.repeat(Math.max(0,lists.length-1))).slice(0,Math.max(0,width-2));
 const append=(spans,prefix=lead(),next=prefix)=>rows.push(...layout(spans,width,prefix,next).map(paint));
 const gap=()=>{if(rows.length&&rows.at(-1)!=='')rows.push('');};
 function table(start){const data=[];let cells=null,cell=null,header=false,align='left',end=start;
 for(let i=start+1;i<tokens.length;i++){const t=tokens[i];if(t.type==='table_close'){end=i;break;}if(t.type==='tr_open')cells=[];else if(t.type==='th_open'||t.type==='td_open'){header=t.type==='th_open';align=(t.attrGet('style')||'').replace('text-align:','').replace(';','')||'left';cell={spans:[],header,align};}else if(t.type==='inline'&&cell)cell.spans=inline(t.children,header?['1']:[]);else if(t.type==='th_close'||t.type==='td_close'){cells.push(cell);cell=null;}else if(t.type==='tr_close')data.push(cells);}
 const count=Math.max(0,...data.map(r=>r.length));if(!count)return end;const prefix=lead(),room=width-stringWidth(prefix);
 if(room<count*4+1){for(const row of (data.length>1?data.slice(1):data)){row.forEach((cell,i)=>{const label=data[0][i]?.spans.map(s=>s.text).join('')||String(i+1);append([span(label+': ',['1']),...cell.spans],prefix);});gap();}return end;}
 const sizes=Array.from({length:count},(_,i)=>Math.max(1,...data.map(r=>stringWidth(r[i]?.spans.map(s=>s.text).join('')||''))));while(sizes.reduce((a,b)=>a+b,0)+count*3+1>room){const max=Math.max(...sizes),i=sizes.indexOf(max);sizes[i]--;}
 const border=(left,middle,right)=>prefix+left+sizes.map(n=>'─'.repeat(n+2)).join(middle)+right;
 rows.push(border('┌','┬','┐'));
 data.forEach((row,index)=>{const wrapped=Array.from({length:count},(_,i)=>layout(row[i]?.spans||[],sizes[i]));const height=Math.max(...wrapped.map(r=>r.length));for(let j=0;j<height;j++){let line=prefix+'│';for(let i=0;i<count;i++){const parts=wrapped[i][j]||[],text=paint(parts),padding=sizes[i]-stringWidth(text),alignment=row[i]?.align,left=alignment==='right'?padding:alignment==='center'?Math.floor(padding/2):0;line+=' '+' '.repeat(left)+text+' '.repeat(padding-left)+' │';}rows.push(line);}if(index===0&&data.length>1)rows.push(border('├','┼','┤'));});rows.push(border('└','┴','┘'));gap();return end;
 }
 for(let i=0;i<tokens.length;i++){const t=tokens[i];
  if(t.type==='table_open'){gap();i=table(i);}
  else if(t.type==='blockquote_open'){gap();quote++;}else if(t.type==='blockquote_close'){quote--;gap();}
  else if(t.type==='bullet_list_open'||t.type==='ordered_list_open')lists.push({ordered:t.type==='ordered_list_open',next:Number(t.attrGet('start')||1)});
  else if(t.type==='bullet_list_close'||t.type==='ordered_list_close'){lists.pop();if(!lists.length)gap();}
  else if(t.type==='list_item_open'){const list=lists.at(-1);item=list?.ordered?`${list.next++}. `:'• ';}else if(t.type==='list_item_close')item=null;
  else if(t.type==='heading_open'){gap();heading=true;}else if(t.type==='heading_close'){heading=false;gap();}
  else if(t.type==='inline'){let spans=inline(t.children,heading?['1','38;2;195;215;169']:[]),prefix=lead();if(item){if(spans[0]?.text.match(/^\[[ xX]\] /)){item=spans[0].text[1].toLowerCase()==='x'?'✓ ':'○ ';spans[0].text=spans[0].text.slice(4);}prefix+=item;item=null;}const next=lead()+' '.repeat(Math.max(0,stringWidth(prefix)-stringWidth(lead())));append(spans,prefix,next);}
  else if(t.type==='paragraph_close'&&!t.hidden)gap();
  else if(t.type==='fence'||t.type==='code_block'){gap();const language=t.info.trim().split(/\s/)[0]||'text',prefix=lead();append([span('─ '+language+' '+'─'.repeat(Math.max(0,width-stringWidth(prefix)-language.length-3)),['2'])],prefix);const text=t.content.replace(/\n$/,'');append(codeSpans(text,language,color),prefix+'│ ',prefix+'│ ');append([span('─'.repeat(Math.max(1,width-stringWidth(prefix))),['2'])],prefix);gap();}
  else if(t.type==='hr'){gap();append([span('─'.repeat(width-stringWidth(lead())),['2'])]);gap();}
 }
 while(rows.at(-1)==='')rows.pop();cache.set(key,rows);while(cache.size>24)cache.delete(cache.keys().next().value);return rows.slice();
}
export function scrollOffset(offset,delta,total,available){return Math.max(0,Math.min(Math.max(0,total-available),offset+delta));}
