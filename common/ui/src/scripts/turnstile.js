/* Turnstile in the verification box, "interaction-only": out of sight unless Cloudflare asks the visitor to tick it.
   .ts-on marks the live widget, .ts-ask a widget that takes room. Where the browser can watch the box's size, its
   height alone decides .ts-ask: an error (such as a host the widget does not list, on a preview) may show nothing.
   Elsewhere the callbacks guess it. */
(function(){var b=document.querySelector('#contact .ts[data-sitekey]'),r=document.documentElement,id=null,RO=window.ResizeObserver;if(!b)return;
function theme(){return r.getAttribute('data-theme')==='light'?'light':'dark'}
function ask(){if(!RO)b.classList.add('ts-ask')}
function render(){id=turnstile.render(b,{sitekey:b.getAttribute('data-sitekey'),size:'flexible',appearance:'interaction-only',language:r.lang,theme:theme(),
'before-interactive-callback':ask,'unsupported-callback':ask,'error-callback':ask,callback:function(){if(!RO)b.classList.remove('ts-ask')}})}
window.gawTurnstile=function(){b.classList.add('ts-on');if(RO)new RO(function(){b.classList.toggle('ts-ask',b.offsetHeight>0)}).observe(b);b.removeAttribute('role');b.removeAttribute('aria-label');render();
if(window.MutationObserver)new MutationObserver(function(){if(id===null)return;try{turnstile.remove(id)}catch(e){}if(!RO)b.classList.remove('ts-ask');render()}).observe(r,{attributes:true,attributeFilter:['data-theme']})};
var s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=gawTurnstile';s.async=true;document.head.appendChild(s)})();
