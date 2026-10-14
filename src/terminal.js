import stringWidth from 'string-width';
const segmenter=new Intl.Segmenter('es',{granularity:'grapheme'});
function cells(text){
 const result=[],style=new Map();
 for(const part of text.split(/(\x1b\[[\d;]*m)/)){
  if(part.startsWith('\x1b[')){const values=(part.slice(2,-1)||'0').split(';').map(Number);for(let i=0;i<values.length;i++){const n=values[i];if(n===0)style.clear();else if(n===38||n===48){const size=values[i+1]===2?4:2;style.set(n,values.slice(i,i+size+1).join(';'));i+=size;}else if(n>=30&&n<=37||n>=90&&n<=97)style.set(38,String(n));else if(n>=40&&n<=47||n>=100&&n<=107)style.set(48,String(n));else if(n===39)style.delete(38);else if(n===49)style.delete(48);else if(n===22){style.delete(1);style.delete(2);}else if([23,24,27,29].includes(n))style.delete(n-20);else style.set(n,String(n));}continue;}
  const sgr=[...style.entries()].sort(([a],[b])=>a-b).map(([,v])=>v).join(';');
  for(const {segment} of segmenter.segment(part))result.push({text:segment,width:stringWidth(segment),sgr});
 }
 return result;
}
function equal(a,b){return a?.text===b?.text&&a?.sgr===b?.sgr;}
function patchRow(previous,next,row,base){
 const before=cells(base+previous),after=cells(base+next),oldWidth=before.reduce((n,c)=>n+c.width,0),newWidth=after.reduce((n,c)=>n+c.width,0);let start=0,end=after.length,oldEnd=before.length,column=1;
 while(start<before.length&&start<after.length&&equal(before[start],after[start])){column+=after[start].width;start++;}
 if(oldWidth===newWidth)while(end>start&&oldEnd>start&&equal(before[oldEnd-1],after[end-1])){end--;oldEnd--;}
 let output=`\x1b[${row};${column}H`,sgr=null;
 for(const cell of after.slice(start,end)){if(cell.sgr!==sgr){output+='\x1b[0m'+(cell.sgr?'\x1b['+cell.sgr+'m':'');sgr=cell.sgr;}output+=cell.text;}
 if(end===after.length&&oldWidth>newWidth)output+=base+'\x1b[K';
 return output;
}
export function screenPainter(stream,{base='',synchronized=true}={}){
 let previous=[],cursor=null,blocked=false,pending=null,reset=true,closed=false;
 function paint(frame){
  if(closed)return;if(blocked){pending=frame;return;}
  const {rows,position=null}=frame;let output=reset?'\x1b[2J':'';
  rows.forEach((text,index)=>{if(reset||previous[index]!==text)output+=patchRow(reset?'':previous[index]||'',text,index+1,base);});
  for(let i=rows.length;i<previous.length;i++)output+=`\x1b[${i+1};1H${base}\x1b[K`;
  const desired=position?position.join(';'):null;
  if(output&&position||desired!==cursor)output+=position?`\x1b[${desired}H`+(cursor===null?'\x1b[?25h':''):cursor!==null||reset?'\x1b[?25l':'';
  previous=rows.slice();cursor=desired;reset=false;
  if(!output)return;blocked=!stream.write((synchronized?'\x1b[?2026h':'')+base+output+(synchronized?'\x1b[?2026l':''));
 }
 const drain=()=>{blocked=false;const frame=pending;pending=null;if(frame)paint(frame);};stream.on('drain',drain);
 return {paint,invalidate(){reset=true;},close(){closed=true;pending=null;stream.off('drain',drain);}};
}
export function transcriptLayout(renderBlock){
 let revision=-1,width=0,source=null,rows=[],cache=new WeakMap();
 return {rows(messages,nextWidth,nextRevision){if(source===messages&&width===nextWidth&&revision===nextRevision)return rows;const result=[];for(const message of messages){const fields=['text','pending','failed','cancelled','elapsed','name','path','agent'];let block=cache.get(message);if(!block||block.width!==nextWidth||fields.some(k=>block[k]!==message[k])){block={width:nextWidth,...Object.fromEntries(fields.map(k=>[k,message[k]])),rows:renderBlock(message,nextWidth)};cache.set(message,block);}for(const row of block.rows)result.push(row);}rows=result;source=messages;width=nextWidth;revision=nextRevision;return rows;}};
}
