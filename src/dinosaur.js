export const mascotPalette={
 ' ':[39,41,43],O:[66,84,64],A:[104,142,91],B:[137,174,115],C:[169,195,143],D:[195,215,169],E:[220,233,202],
 X:[103,138,88],K:[33,43,36],W:[242,244,219],P:[221,215,184],R:[194,171,139],
 L:[114,102,86],M:[151,133,109],H:[192,174,146],S:[49,69,63],V:[91,126,107],T:[177,212,161],Z:[33,35,36]
};
export function mascotPixels(state='idle',frame=0){
 const grid=Array.from({length:24},()=>Array(28).fill(' ')),phase=((frame%48)+48)%48;
 const rect=(x,y,w,h,c)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)if(grid[j]?.[i]!==undefined)grid[j][i]=c;};
 const oval=(cx,cy,rx,ry,shade=true)=>{for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++)for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++){const nx=(x-cx)/rx,ny=(y-cy)/ry,n=nx*nx+ny*ny;if(n>1)continue;const light=Math.max(0,Math.min(1,0.65-0.24*nx-0.2*ny+0.14*Math.sqrt(1-n)));rect(x,y,1,1,shade?(n>0.91?'O':'ABCDE'[Math.min(4,Math.floor(light*5))]):'Z');}};
 const sleeping=state==='sleep',typing=['tools','typing'].includes(state),blink=state==='idle'&&phase>=43&&phase<=45;
 oval(14,22,10,1,false);oval(7,19,4,2);oval(13.5,16,5.8,5.8);oval(10,21,2.8,1.2);oval(18,21,2.8,1.2);
 rect(10,2,2,3,'X');rect(15,1,2,4,'X');rect(19,3,2,3,'X');
 oval(13.5,7.5,7.4,6.2);oval(13,10.5,5.5,2.8);
 rect(8,5,2,1,'E');rect(9,4,3,1,'D');
 const gaze=state==='thinking'&&phase%16>=8?1:0;
 if(sleeping||blink){rect(9,7,3,1,'K');rect(16,7,3,1,'K');}
 else{rect(10+gaze,6,2,3,'K');rect(17+gaze,6,2,3,'K');rect(10+gaze,6,1,1,'W');rect(17+gaze,6,1,1,'W');}
 rect(8,10,2,1,'P');rect(18,10,2,1,'R');rect(12,10,1,1,'A');rect(16,10,1,1,'A');
 const mouth=state==='speaking'?Math.floor(phase%12/3):0;
 if(state==='speaking')rect(13,11,3,2,'C');rect(13,11,state==='speaking'&&mouth===0?2:3,mouth===0||mouth===3?1:2,'K');if(mouth===2)rect(14,12,1,1,'P');
 oval(13.5,16.5,3.1,3.5);rect(12,14,3,3,sleeping&&phase%24<12?'E':'D');
 if(state==='idle')rect(12,14,3,1,phase<12||phase>=36?'E':'D');
 oval(8,16,2,2.5);oval(19,16,2,2.5);
 rect(9,15,11,6,'L');rect(10,15,9,1,'H');rect(10,16,9,4,'S');rect(10,16,1,3,'V');rect(18,16,1,4,'O');
 rect(8,21,13,1,'M');rect(9,21,10,1,'H');rect(12,21,5,1,'L');rect(9,22,11,1,'L');
 if(typing){const step=Math.floor(phase%12/2);rect(11,17,5,1,'V');rect(11+step%5,18,1,1,'T');rect(8,17+(step%3===0?1:0),2,1,'E');rect(19,17+(step%3===1?1:0),2,1,'D');}
 else{rect(8,18,2,1,'D');rect(19,18,2,1,'C');rect(13,17,3,1,'V');rect(14,18,1,1,'T');}
 if(state==='thinking')for(let i=0;i<3;i++)rect(23+i*2,4-(Math.floor(phase/4)%3===i?1:0),1,1,Math.floor(phase/4)%3===i?'E':'A');
 if(sleeping){const y=4-Math.floor(phase/12)%2;rect(23,y,3,1,'D');rect(24,y+1,1,1,'D');rect(23,y+2,3,1,'D');if(phase>=24){rect(25,0,3,1,'A');rect(26,1,1,1,'A');rect(25,2,3,1,'A');}}
 return grid;
}
function miniPixels(state,frame){
 const phase=frame%48,asleep=state==='sleep',blink=state==='idle'&&phase>=43&&phase<=45,typing=['tools','typing'].includes(state);
 const rows=['    XX      ','   DDCBX    ','  DECCBAO   ',asleep||blink?'  CKKCKKO   ':'  CWKCWKO   ','  CPCKBRO   ','   CDDCO    ','  CCDDBAO   ','  EDHHMD    ','   SVVSL    ',' BBHHHMLL   ','  CBLLLBO   ','   ZZZZZ    '].map(s=>s.split(''));
 if(typing){rows[8][4+Math.floor(phase/2)%3]='T';rows[7][phase%6<3?2:7]='E';}
 if(state==='speaking'&&phase%12<6)rows[5][5]='K';
 if(state==='thinking')rows[Math.floor(phase/4)%2][10]='D';
 if(asleep)rows[Math.floor(phase/12)%2][10]='D';
 return rows;
}
const cache=new Map();
export function dinosaur(color=true,state='idle',frame=0,small=false){
 const phase=((Math.floor(frame)%48)+48)%48,key=[color,state,phase,small].join(':');if(cache.has(key))return cache.get(key);
 const pixels=small?miniPixels(state,phase):mascotPixels(state,phase);
 const rows=Array.from({length:pixels.length/2},(_,row)=>{let text='',last='';for(let x=0;x<pixels[0].length;x++){const top=pixels[row*2][x],bottom=pixels[row*2+1][x];if(!color){text+=top===' '&&bottom===' '?' ':top===' '||bottom===' '?'▒':'█';continue;}const style=`\x1b[38;2;${mascotPalette[top].join(';')}m\x1b[48;2;${mascotPalette[bottom].join(';')}m`;if(style!==last){text+=style;last=style;}text+='▀';}return text;});cache.set(key,rows);if(cache.size>600)cache.delete(cache.keys().next().value);return rows;
}
