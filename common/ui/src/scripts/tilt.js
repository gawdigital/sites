/* The cursor tilts a card or a tile a little, and a faint sheen follows it. The angles ease toward the cursor in a frame loop
   (no CSS transition, which restarted on every pointer move and lagged); on leave they ease back to flat and the
   transform is dropped, so the card rasterises flat and sharp. Every card rests on a ball of one height (Z) at its
   centre, in front of one flat surface: the cursor tips it toward itself, about the axis across the line from the
   centre to the cursor, by as much of Z as the cursor has come toward the card's edge along that line. So a cursor at
   an edge or a corner sets that edge or corner down on the surface, whatever the card's size or shape: a small tile
   tilts further than a large card, and a wide card further toward its top than toward its side.
   The sheen is drawn here rather than as a CSS gradient: so faint a glow has only a handful of shades, and a gradient
   rounds each pixel to the nearest one, which stepped into visible rings. Its colour is --sheen-rgb (light on dark, a
   shade on light, where a light glow does not show on a white card). Drawn once per theme into a canvas, each pixel is
   rounded with a little noise (dithered before it is quantised, strongly enough to survive the tilt's resampling), so
   the steps do not line up. */
(function(){var M=window.matchMedia;if(!M||!M('(hover:hover) and (pointer:fine)').matches||M('(prefers-reduced-motion:reduce)').matches)return;
var Z=8.5,R=385,S={},root=document.documentElement,cur='';
function sheen(){var cs=getComputedStyle(root),a=parseFloat(cs.getPropertyValue('--sheen'))||0,
c=(cs.getPropertyValue('--sheen-rgb')||'255,255,255').split(',').map(function(v){return parseInt(v,10)||0}),key=a+'/'+c,u=S[key];
if(u){if(u!==cur)root.style.setProperty('--shimg',cur=u);return}if(u==='')return;S[key]='';
var d=(window.devicePixelRatio||1)>1?2:1,n=2*R*d,h=n/2,m=a*255,cv=document.createElement('canvas');cv.width=cv.height=n;
var g=cv.getContext('2d');if(!g||!cv.toBlob)return;var im=g.createImageData(n,n),p=im.data;
for(var j=0;j<n;j++){var dy=(j+.5-h)/h;for(var i=0;i<n;i++){var dx=(i+.5-h)/h,q=dx*dx+dy*dy;if(q>=1)continue;
var r=Math.sqrt(q),k=(j*n+i)*4;p[k]=c[0];p[k+1]=c[1];p[k+2]=c[2];p[k+3]=Math.max(0,Math.floor(m*(1-r*r*(3-2*r))+Math.random()+Math.random()-.5))}}
g.putImageData(im,0,0);cv.toBlob(function(b){if(!b)return;S[key]='url('+URL.createObjectURL(b)+')';sheen()})}
if(window.requestIdleCallback)requestIdleCallback(sheen);else setTimeout(sheen,300);
[].forEach.call(document.querySelectorAll('.card,.tile'),function(c){var rx=0,ry=0,tx=0,ty=0,on=false,raf=0,t0=0;
function frame(t){var f=1-Math.pow(.8,Math.min(64,t-(t0||t))/16.7);t0=t;rx+=(tx-rx)*f;ry+=(ty-ry)*f;
if(Math.abs(tx-rx)<.002&&Math.abs(ty-ry)<.002){rx=tx;ry=ty;raf=0;t0=0;if(!on){c.classList.remove('tilt');c.style.removeProperty('--rx');c.style.removeProperty('--ry');return}}
else raf=requestAnimationFrame(frame);
c.style.setProperty('--rx',rx.toFixed(3)+'deg');c.style.setProperty('--ry',ry.toFixed(3)+'deg')}
function go(){if(!raf)raf=requestAnimationFrame(frame)}
c.addEventListener('pointerenter',sheen);
c.addEventListener('pointermove',function(e){if(e.pointerType!=='mouse')return;var r=c.getBoundingClientRect(),
x=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));
on=true;
/* the cursor from the centre (layout px, untouched by the tilt and the frame's scale), the card's farthest reach that way (its support), and the tip that sets it down by Z
   once the cursor reaches it */
var w=c.offsetWidth,h=c.offsetHeight,px=(x-.5)*w,py=(y-.5)*h,d=Math.sqrt(px*px+py*py);
if(d<.5){tx=ty=0}else{var ux=px/d,uy=py/d,sp=Math.abs(ux)*w/2+Math.abs(uy)*h/2,
a=Math.asin(Math.min(1,Z*d/(sp*sp)))*180/Math.PI;ty=a*ux;tx=-a*uy}c.style.setProperty('--mx',x.toFixed(4));c.style.setProperty('--my',y.toFixed(4));
c.classList.add('tilt','mv');go()});
c.addEventListener('pointerleave',function(){on=false;tx=ty=0;c.classList.remove('mv');go()})})})();
