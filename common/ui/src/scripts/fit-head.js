/* Between the phone layout and the design's width, the desktop frame is scaled to the window with a transform rather
   than with zoom: WebKit holds zoomed text at a 9 px minimum while the layout around it keeps shrinking, so small
   text overlapped and wrapped a word a line in Safari; a transform scales text and layout alike. This runs in the
   head, so the first paint is already scaled. The class `fit` on <html> turns the transform on and the zoom ladder
   (styles.ts, the fallback without JavaScript) off; --fit is the scale, and --fit-m the bottom margin that takes the
   height the frame lost out of the page, since a transform leaves the layout box as it was. The width is the window's
   less its scrollbar, which `fit` keeps in place, so a scale never moves the scrollbar that set it. */
(function(){var r=document.documentElement,W=1680,fr=null;if(!window.matchMedia||!window.ResizeObserver)return;var Q='(min-width:769px)';
/* the query is asked afresh: in a resize handler WebKit still answers a kept MediaQueryList with the old width */
function wd(){return r.clientWidth||innerWidth}
function fit(){var on=matchMedia(Q).matches&&wd()<W;r.classList.toggle('fit',on);if(on){r.style.setProperty('--fit',Math.floor(wd()/W*1e5)/1e5);tail()}}
function tail(){if(fr)r.style.setProperty('--fit-m',(fr.offsetHeight*((parseFloat(r.style.getPropertyValue('--fit'))||1)-1)).toFixed(2)+'px')}
/* called once the frame is parsed (fit.js): its height is known, and followed from then on. The observer only takes
   the new height; it never sets the scale, which would resize the frame it is reporting on */
window.gawFit=function(){if(!fr&&(fr=document.querySelector('.frame')))new ResizeObserver(tail).observe(fr);fit()};
fit();addEventListener('resize',fit)})();
