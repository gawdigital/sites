(function(){var b=document.querySelector('#contact .ts[data-sitekey]'),r=document.documentElement;if(!b)return;
window.gawTurnstile=function(){b.classList.add('ts-on');b.removeAttribute('role');b.removeAttribute('aria-label');
turnstile.render(b,{sitekey:b.getAttribute('data-sitekey'),size:'flexible',language:r.lang,theme:r.getAttribute('data-theme')==='light'?'light':'dark'})};
var s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=gawTurnstile';s.async=true;document.head.appendChild(s)})();
