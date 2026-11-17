/* Soft gradients are redrawn as dithered bitmaps. A faint gradient spans only a handful of shades, and the browser
   rounds every pixel to the nearest one, which steps into visible bands; no interpolation space helps, the steps are
   the 8-bit output. Each large gradient background (and a gradient mask on an empty element) is read off the computed
   style, composited in floating point at the device's resolution, given a little triangular noise before it is
   quantised (as the sheen in tilt.js is), and put back as an uncompressed PNG, drawn in a worker where the browser
   has one. The CSS
   stays the fallback: nothing changes without JavaScript, and nothing that cannot be parsed is touched. The bitmaps
   are redrawn when the theme or the width changes, and drawn only for what is near the viewport. */
(function(){var D=document,root=D.documentElement,fr=D.querySelector('.frame');if(!fr||!window.Blob||!window.URL||!URL.createObjectURL)return;
var MIN=40000,MAXPX=6e6,sheet=D.createElement('style'),T=[],C={},keep={},Q=[],busy=0,wk=null,io=null,gen=0,id=0;D.head.appendChild(sheet);

/* the pixels: layers bottom to top, premultiplied, then the mask's alpha, then the noise */
function draw(j){var bw=j.bw,bh=j.bh,sx=j.w/bw,sy=j.h/bh,o=new Uint8ClampedArray(bw*bh*4),L=j.l,M=j.m,R=Math.random,c=[0,0,0,0],N=new Float32Array(65536),z;
for(z=0;z<65536;z++)N[z]=R()+R()-1;
function col(l,x,y){var t=l.k?Math.sqrt((x-l.x)*(x-l.x)/(l.rx*l.rx)+(y-l.y)*(y-l.y)/(l.ry*l.ry)):x*l.a+y*l.b+l.c,s=l.t,p=l.p,n=s.length,i=0,f,q;
if(t<=s[0]){c[0]=p[0];c[1]=p[1];c[2]=p[2];c[3]=p[3];return}if(t>=s[n-1]){q=(n-1)*4;c[0]=p[q];c[1]=p[q+1];c[2]=p[q+2];c[3]=p[q+3];return}
while(t>=s[i+1])i++;f=s[i+1]-s[i];f=f>0?(t-s[i])/f:1;q=i*4;c[0]=p[q]+(p[q+4]-p[q])*f;c[1]=p[q+1]+(p[q+5]-p[q+1])*f;c[2]=p[q+2]+(p[q+6]-p[q+2])*f;c[3]=p[q+3]+(p[q+7]-p[q+3])*f}
for(var y=0,k=0;y<bh;y++){var py=(y+.5)*sy;z=R()*65536|0;for(var x=0;x<bw;x++,k+=4){var px=(x+.5)*sx,r=0,g=0,b=0,a=0,i,m;
for(i=0;i<L.length;i++){col(L[i],px,py);m=1-c[3];r=c[0]+r*m;g=c[1]+g*m;b=c[2]+b*m;a=c[3]+a*m}
if(M){col(M,px,py);m=c[3];r*=m;g*=m;b*=m;a*=m}if(a>0){r/=a;g/=a;b/=a}
o[k]=r*255+N[z++&65535];o[k+1]=g*255+N[z++&65535];o[k+2]=b*255+N[z++&65535];o[k+3]=a*255+N[z++&65535]}}return o}
/* a PNG with stored (uncompressed) deflate blocks: deflating noise is slow and gains little, a stored PNG costs a copy */
function png(o,w,h){var n=w*4+1,raw=h*n,nb=Math.ceil(raw/65535)||1,dl=2+raw+nb*5+4,B=new Uint8Array(8+25+12+dl+12),v=new DataView(B.buffer),T=[],i,k,c,q=0;
for(i=0;i<256;i++){c=i;for(k=0;k<8;k++)c=c&1?0xEDB88320^c>>>1:c>>>1;T[i]=c>>>0}
function crc(s,e){var c=-1;for(var i=s;i<e;i++)c=T[(c^B[i])&255]^c>>>8;return~c>>>0}
function chunk(t,len,fill){v.setUint32(q,len);q+=4;var s=q;for(var i=0;i<4;i++)B[q++]=t.charCodeAt(i);fill();v.setUint32(q,crc(s,q));q+=4}
[137,80,78,71,13,10,26,10].forEach(function(x){B[q++]=x});
chunk('IHDR',13,function(){v.setUint32(q,w);v.setUint32(q+4,h);B[q+8]=8;B[q+9]=6;q+=13});
chunk('IDAT',dl,function(){B[q++]=0x78;B[q++]=1;var a=1,b=0,r=0,x=0,y=0,left=raw;for(var bl=0;bl<nb;bl++){var m=Math.min(65535,left);left-=m;
B[q++]=left?0:1;B[q++]=m&255;B[q++]=m>>8;B[q++]=~m&255;B[q++]=~m>>8&255;
for(var t=0;t<m;t++){var by;if(x===0){by=0;x=1}else{by=o[y*(n-1)+x-1];if(++x===n){x=0;y++}}B[q++]=by;a+=by;if(a>=65521)a-=65521;b+=a;if(b>=65521)b-=65521}}
v.setUint32(q,(b<<16|a)>>>0);q+=4});
chunk('IEND',0,function(){});return new Blob([B],{type:'image/png'})}
function W(){onmessage=function(e){var j=e.data;postMessage({k:j.k,b:png(draw(j),j.bw,j.bh)})}}
try{if(window.Worker){wk=new Worker(URL.createObjectURL(new Blob([draw+';'+png+';('+W+')()'],{type:'text/javascript'})));wk.onmessage=function(e){got(e.data)};wk.onerror=function(){wk=null;busy=0;next()}}}catch(x){wk=null}

/* the computed value, parsed: rgb()/rgba() stops with % or px positions, linear and radial gradients only */
function split(s){var o=[],d=0,b=0;for(var i=0;i<s.length;i++){var h=s[i];if(h==='(')d++;else if(h===')')d--;else if(h===','&&!d){o.push(s.slice(b,i).trim());b=i+1}}o.push(s.slice(b).trim());return o}
function rgba(s){if(s==='transparent')return[0,0,0,0];var m=/^rgba?\(([^)]*)\)$/.exec(s);if(!m)return null;var v=m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
if(v.length<3||v.some(isNaN))return null;var a=v.length>3?(/%/.test(m[1].split(/[\s,\/]+/).filter(Boolean)[3])?v[3]/100:v[3]):1;return[v[0]/255*a,v[1]/255*a,v[2]/255*a,a]}
function len(s,full){var m=/^(-?[\d.]+)(px|%)?$/.exec(s);if(!m)return NaN;var n=parseFloat(m[1]);return m[2]==='%'?n/100*full:n===0||m[2]==='px'?n:NaN}
function stops(parts,ray){var S=[];for(var i=0;i<parts.length;i++){var p=parts[i],e=p.indexOf(')'),cs=p.slice(0,/^rgba?\(/.test(p)?e+1:p.indexOf(' ')<0?p.length:p.indexOf(' ')),c=rgba(cs);
if(!c)return null;var ps=p.slice(cs.length).trim().split(/\s+/).filter(Boolean);if(ps.length>2)return null;if(!ps.length)S.push({t:null,c:c});
for(var k=0;k<ps.length;k++){var t=len(ps[k],ray);if(isNaN(t))return null;S.push({t:t/ray,c:c})}}
if(S.length<2)return null;if(S[0].t===null)S[0].t=0;if(S[S.length-1].t===null)S[S.length-1].t=1;
for(var mx=S[0].t,i=1;i<S.length;i++)if(S[i].t!==null)mx=S[i].t=Math.max(S[i].t,mx);
for(i=1;i<S.length;i++)if(S[i].t===null){for(var j=i;S[j].t===null;j++);for(var q=i;q<j;q++)S[q].t=S[i-1].t+(S[j].t-S[i-1].t)*(q-i+1)/(j-i+1);i=j}
var o={t:[],p:[]};S.forEach(function(s){o.t.push(s.t);o.p.push(s.c[0],s.c[1],s.c[2],s.c[3])});return o}
function pos(tk,w,h){var x=w/2,y=h/2,X={left:0,center:.5,right:1},Y={top:0,center:.5,bottom:1};if(!tk.length)return[x,y];
if(tk.length===1)tk=X[tk[0]]!==undefined||!(tk[0] in Y)?[tk[0],'center']:['center',tk[0]];if(tk.length!==2)return null;
if(tk[0] in Y&&!(tk[0] in X)||tk[1] in X&&!(tk[1] in Y))tk=[tk[1],tk[0]];
x=tk[0] in X?X[tk[0]]*w:len(tk[0],w);y=tk[1] in Y?Y[tk[1]]*h:len(tk[1],h);return isNaN(x)||isNaN(y)?null:[x,y]}
function grad(s,w,h){var m=/^(linear|radial)-gradient\((.*)\)$/.exec(s);if(!m)return null;var P=split(m[2]),f=P[0],pre=!/^(rgba?\(|transparent)/.test(f),l;
if(m[1]==='linear'){var A=Math.PI,sn,cs;if(pre){P.shift();var g=/^(-?[\d.]+)(deg|rad|turn|grad)$/.exec(f);
if(g){A=parseFloat(g[1])*{deg:Math.PI/180,rad:1,turn:2*Math.PI,grad:Math.PI/200}[g[2]];sn=Math.sin(A);cs=Math.cos(A)}
else if(/^to /.test(f)){var t=f.slice(3).split(/\s+/),dx=0,dy=0;t.forEach(function(k){if(k==='left')dx=-1;else if(k==='right')dx=1;else if(k==='top')dy=-1;else if(k==='bottom')dy=1});
if(t.length>1){var vx=dx*h,vy=dy*w,n=Math.hypot(vx,vy);sn=vx/n;cs=-vy/n}else{sn=dx;cs=-dy}}else return null}else{sn=0;cs=-1}
var L=Math.abs(w*sn)+Math.abs(h*cs);if(!(L>0))return null;l=stops(P,L);if(!l)return null;l.k=0;l.a=sn/L;l.b=-cs/L;l.c=.5-(w/2*sn-h/2*cs)/L;return l}
var circ=0,sz=[],at=[],tk=pre?(P.shift(),f.split(/\s+/)):[],i=0;for(;i<tk.length&&tk[i]!=='at';i++){if(tk[i]==='circle')circ=1;else if(tk[i]!=='ellipse')sz.push(tk[i])}
at=pos(tk.slice(i+1),w,h);if(!at)return null;var cx=at[0],cy=at[1],rx,ry,K=sz.length===1&&/-/.test(sz[0])?sz[0]:sz.length?null:'farthest-corner';
if(K){var sxn=Math.min(cx,w-cx),syn=Math.min(cy,h-cy),sxf=Math.max(cx,w-cx),syf=Math.max(cy,h-cy);
if(K==='closest-side'){rx=sxn;ry=syn;if(circ)rx=ry=Math.min(sxn,syn)}else if(K==='farthest-side'){rx=sxf;ry=syf;if(circ)rx=ry=Math.max(sxf,syf)}
else{var far=K==='farthest-corner',ax=far?sxf:sxn,ay=far?syf:syn;if(circ)rx=ry=Math.hypot(ax,ay);else{var kk=(far?syf:syn)/(far?sxf:sxn);rx=Math.hypot(ax,ay/kk);ry=rx*kk}}}
else{rx=len(sz[0],w);ry=sz.length>1?len(sz[1],h):rx;if(sz.length===1){circ=1;if(/%/.test(sz[0]))return null}}
if(!(rx>0&&ry>0))return null;l=stops(P,rx);if(!l)return null;l.k=1;l.x=cx;l.y=cy;l.rx=rx;l.ry=ry;return l}
function auto(v){return!v||/^(auto(\s+auto)?)(,\s*auto(\s+auto)?)*$/.test(v)}
function origin(v){return!v||/^(0(px|%)?\s+0(px|%)?)(,\s*0(px|%)?\s+0(px|%)?)*$/.test(v)}

/* what to redraw: every element (and ::before/::after) outside the inline art with a large gradient background; a
   gradient mask is baked in where the element is empty, and one that cuts a pattern (the hatch, the plug's ring) is left
   alone with its element. A bitmap has the resolution it is shown at: the frame's scale (fit-head.js) or its zoom */
function zoom(e){var z=root.classList.contains('fit')&&parseFloat(root.style.getPropertyValue('--fit'))||1;for(;e&&e.nodeType===1;e=e.parentElement)z*=parseFloat(getComputedStyle(e).zoom)||1;return z}
function scan(){var o=[],dpr=Math.min(2,window.devicePixelRatio||1);sheet.disabled=true;
[].forEach.call(D.querySelectorAll('.frame,.frame *:not(svg *):not(svg)'),function(e){[null,'::before','::after'].forEach(function(ps){var s=getComputedStyle(e,ps),bi=s.backgroundImage;
if(!bi||bi.indexOf('gradient(')<0||/repeating|url\(/.test(bi)||s.display==='none'||ps&&s.content==='none')return;
if(/text/.test(s.webkitBackgroundClip||'')||/text/.test(s.backgroundClip)||!auto(s.backgroundSize)||!origin(s.backgroundPosition)||/fixed/.test(s.backgroundAttachment))return;
if(['Top','Right','Bottom','Left'].some(function(d){return parseFloat(s['border'+d+'Width'])>0}))return;
var w=parseFloat(s.width),h=parseFloat(s.height);if(s.boxSizing!=='border-box'){w+=parseFloat(s.paddingLeft)+parseFloat(s.paddingRight);h+=parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)}
if(!(w*h>=MIN))return;var L=split(bi).reverse().map(function(g){return grad(g,w,h)});if(L.some(function(l){return!l}))return;
var mi=s.maskImage||s.webkitMaskImage,M=null;if(mi&&mi!=='none'){if(ps||/repeating|url\(/.test(mi))return;if(e.children.length||e.textContent.trim()||split(mi).length>1||!auto(s.maskSize||s.webkitMaskSize)||!origin(s.maskPosition||s.webkitMaskPosition)||!(M=grad(mi,w,h)))mi=''}else mi='';
var sc=zoom(e)*dpr,bw=Math.max(1,Math.round(w*sc)),bh=Math.max(1,Math.round(h*sc));if(bw*bh>MAXPX){var r=Math.sqrt(MAXPX/(bw*bh));bw=Math.round(bw*r);bh=Math.round(bh*r)}
o.push({e:e,ps:ps,k:[bw,bh,w.toFixed(2),h.toFixed(2),bi,mi].join('|'),j:{bw:bw,bh:bh,w:w,h:h,l:L,m:M},m:!!M})})});sheet.disabled=false;return o}

/* the bitmaps as rules in one sheet of ours, keyed by a data attribute, ::before and ::after included */
function rules(){sheet.textContent=T.filter(function(t){return C[t.k]}).map(function(t){return'[data-dz'+(t.ps?t.ps.slice(2,3):'')+'="'+t.id+'"]'+(t.ps||'')+'{background-image:url('+C[t.k]+')!important;background-size:100% 100%!important;background-repeat:no-repeat!important;background-position:0 0!important'+(t.m?';-webkit-mask-image:none!important;mask-image:none!important':'')+'}'}).join('\n')}
function got(d){busy=0;put(d.k,d.b);next()}
function put(k,b){if(C[k])return;C[k]=URL.createObjectURL(b);keep[k]=gen;rules()}
function want(t){if(C[t.k]||t.q)return;t.q=1;Q.push(t);next()}
function next(){if(busy)return;var t;while((t=Q.shift())&&(C[t.k]||T.indexOf(t)<0));if(!t)return;busy=1;var j=t.j;j.k=t.k;
if(wk)wk.postMessage(j);else setTimeout(function(){got({k:j.k,b:png(draw(j),j.bw,j.bh)})},0)}
function run(){gen++;var o=scan();T.forEach(function(t){if(t.e.dataset)delete t.e.dataset['dz'+(t.ps?t.ps.slice(2,3):'')]});Q=[];
o.forEach(function(t){t.id=++id;t.e.setAttribute('data-dz'+(t.ps?t.ps.slice(2,3):''),t.id);if(C[t.k])keep[t.k]=gen});T=o;rules();
for(var k in C)if(gen-(keep[k]||0)>1){URL.revokeObjectURL(C[k]);delete C[k];delete keep[k]}
if(io)io.disconnect();if(window.IntersectionObserver){io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting)T.forEach(function(t){if(t.e===x.target)want(t)})})},{rootMargin:'100% 0px'});T.forEach(function(t){io.observe(t.e)})}else T.forEach(want)}
function start(){run();var lw=innerWidth,ld=window.devicePixelRatio,tm;
new MutationObserver(function(){sheet.textContent='';run()}).observe(root,{attributes:true,attributeFilter:['data-theme']});
addEventListener('resize',function(){clearTimeout(tm);tm=setTimeout(function(){if(innerWidth===lw&&window.devicePixelRatio===ld)return;lw=innerWidth;ld=window.devicePixelRatio;run()},250)})}
if(window.requestIdleCallback)requestIdleCallback(start,{timeout:600});else setTimeout(start,60)})();
