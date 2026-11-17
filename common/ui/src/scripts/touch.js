/* iOS Safari applies :active, the touch stand-in for the hover effects, only once the page listens for touches */
document.addEventListener('touchstart',function(){},{passive:true});
