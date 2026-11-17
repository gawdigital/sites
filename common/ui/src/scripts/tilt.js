/* The cursor tilts a card or a tile a little, and a faint sheen follows it. The angles ease toward the cursor in a frame loop
   (no CSS transition, which restarted on every pointer move and lagged); on leave they ease back to flat and the
   transform is dropped, so the card rasterises flat and sharp. */
(function(){var M=window.matchMedia;if(!M||!M('(hover:hover) and (pointer:fine)').matches||M('(prefers-reduced-motion:reduce)').matches)return;
[].forEach.call(document.querySelectorAll('.card,.tile'),function(c){var A=1.5,rx=0,ry=0,tx=0,ty=0,on=false,raf=0,t0=0;
function frame(t){var f=1-Math.pow(.8,Math.min(64,t-(t0||t))/16.7);t0=t;rx+=(tx-rx)*f;ry+=(ty-ry)*f;
if(Math.abs(tx-rx)<.002&&Math.abs(ty-ry)<.002){rx=tx;ry=ty;raf=0;t0=0;if(!on){c.classList.remove('tilt');c.style.removeProperty('--rx');c.style.removeProperty('--ry');return}}
else raf=requestAnimationFrame(frame);
c.style.setProperty('--rx',rx.toFixed(3)+'deg');c.style.setProperty('--ry',ry.toFixed(3)+'deg')}
function go(){if(!raf)raf=requestAnimationFrame(frame)}
c.addEventListener('pointermove',function(e){if(e.pointerType!=='mouse')return;var r=c.getBoundingClientRect(),
x=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height)),
a=A*Math.max(.5,Math.min(1,640/Math.max(r.width,r.height)));
on=true;ty=(x-.5)*2*a;tx=(.5-y)*2*a;c.style.setProperty('--mx',(x*100).toFixed(1)+'%');c.style.setProperty('--my',(y*100).toFixed(1)+'%');
c.classList.add('tilt','mv');go()});
c.addEventListener('pointerleave',function(){on=false;tx=ty=0;c.classList.remove('mv');go()})})})();
