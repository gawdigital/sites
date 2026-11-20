(function(){var b=document.querySelector('#contact .ts[data-sitekey]'),r=document.documentElement,id=null;if(!b)return;
function theme(){return r.getAttribute('data-theme')==='light'?'light':'dark'}
function ask(){b.classList.add('ts-ask')}
function render(){id=turnstile.render(b,{sitekey:b.getAttribute('data-sitekey'),size:'flexible',appearance:'interaction-only',language:r.lang,theme:theme(),
'before-interactive-callback':ask,'unsupported-callback':ask,'error-callback':ask,callback:function(){b.classList.remove('ts-ask')}})}
window.gawTurnstile=function(){b.classList.add('ts-on');b.removeAttribute('role');b.removeAttribute('aria-label');render();
if(window.MutationObserver)new MutationObserver(function(){if(id===null)return;try{turnstile.remove(id)}catch(e){}b.classList.remove('ts-ask');render()}).observe(r,{attributes:true,attributeFilter:['data-theme']})};
var s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=gawTurnstile';s.async=true;document.head.appendChild(s)})();
