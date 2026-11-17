(function(){var b=document.querySelector('.langbar'),h=document.documentElement;if(!b)return;
try{var r=document.referrer;if(r&&new URL(r).origin===location.origin)return}catch(e){}
var cur=b.getAttribute('data-current'),L=navigator.languages||[navigator.language||''],i,c,p;
for(i=0;i<L.length;i++){c=String(L[i]).toLowerCase().split('-')[0];if(c===cur)return;p=b.querySelector('[data-locale="'+c+'"]');if(p)break;p=null}
if(!p)return;p.hidden=false;b.hidden=false;
function room(){h.style.setProperty('--lbh',b.offsetHeight+'px')}room();h.classList.add('lb-on');addEventListener('resize',room);
p.querySelector('.lbx').addEventListener('click',function(){b.hidden=true;h.classList.remove('lb-on');removeEventListener('resize',room)})})();
