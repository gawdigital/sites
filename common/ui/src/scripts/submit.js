(function(){var c=document.getElementById('contact'),f=c&&c.querySelector('form'),e=document.getElementById('ferr'),M=%MESSAGES%;if(!f||!e||!window.fetch||!window.FormData)return;
function fail(k){e.textContent=M[k]||M.failed;e.hidden=false}
f.addEventListener('submit',function(v){v.preventDefault();if(f.classList.contains('is-busy'))return;f.classList.add('is-busy');e.hidden=true;
fetch(f.action,{method:'POST',body:new FormData(f),headers:{accept:'application/json'}}).then(function(r){return r.json()}).then(function(d){if(d&&d.ok){c.classList.add('is-sent');f.reset()}else fail(d&&d.error)},function(){fail('failed')})
.then(function(){f.classList.remove('is-busy');if(!c.classList.contains('is-sent')&&window.turnstile)try{turnstile.reset(c.querySelector('.ts'))}catch(x){}})})})();
