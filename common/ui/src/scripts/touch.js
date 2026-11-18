/* iOS Safari applies :active, the touch stand-in for the hover effects, only once the page listens for touches.
   It also keeps a field focused, keyboard up, when a tap lands outside it on something that is not itself
   focusable, where a mouse click would take the focus away: a tap (not a scroll) on such a spot blurs the field. */
(function(){var x=0,y=0,F='input,textarea,select,label,button,a[href],[tabindex],[contenteditable]';
document.addEventListener('touchstart',function(e){var t=e.touches[0];x=t.clientX;y=t.clientY},{passive:true});
document.addEventListener('touchend',function(e){var a=document.activeElement,t=e.changedTouches[0];
if(!a||!a.matches||!a.matches('input,textarea,select,[contenteditable]')||e.touches.length)return;
if(Math.abs(t.clientX-x)>10||Math.abs(t.clientY-y)>10)return;
if(e.target.closest&&e.target.closest(F))return;a.blur()},{passive:true})})();
