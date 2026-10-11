document.querySelector('.motion-toggle').addEventListener('click',function(){const paused=document.body.classList.toggle('motion-paused');this.setAttribute('aria-pressed',String(paused));this.textContent=paused?'Play blooms ▷':'Pause blooms Ⅱ';});
document.querySelectorAll('[data-book-wall]').forEach(link=>link.addEventListener('click',()=>{const select=document.getElementById('bookingWall');select.value=link.dataset.bookWall;select.dispatchEvent(new Event('change',{bubbles:true}));}));

// Watercolor art and crisp foreground lettering are independent layers.
(function bloomFlowers(){
 const composition=document.querySelector('.logo-composition');
 const petals=[...document.querySelectorAll('.bloom-reveal')];
 const control=document.querySelector('.motion-toggle');
 if(!composition)return;
 const finish=()=>{petals.forEach(p=>p.setAttribute('r','1000'));composition.dataset.bloomComplete='true';control.hidden=true;};
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}
 let start,pausedAt,totalPaused=0;
 function frame(now){
  if(start===undefined)start=now;
  if(document.body.classList.contains('motion-paused')){if(pausedAt===undefined)pausedAt=now;requestAnimationFrame(frame);return;}
  if(pausedAt!==undefined){totalPaused+=now-pausedAt;pausedAt=undefined;}
  const elapsed=(now-start-totalPaused)/1000;
  petals.forEach((petal,j)=>{const t=Math.max(0,Math.min(1,(elapsed-j*.2)/2.8));petal.setAttribute('r',String(900*(1-(1-t)**2)));});
  if(elapsed<3.3)requestAnimationFrame(frame);else finish();
 }
 const floralImage=new Image();
 floralImage.onload=()=>requestAnimationFrame(frame);
 floralImage.onerror=finish;
 floralImage.src='assets/watercolor-flowers-clean.png';
})();

const reviewLoopToggle=document.querySelector('.review-loop-toggle');
reviewLoopToggle?.addEventListener('click',()=>{const paused=document.querySelector('.testimonial-loop').classList.toggle('is-paused');reviewLoopToggle.setAttribute('aria-pressed',String(paused));reviewLoopToggle.textContent=paused?'Play reviews ▷':'Pause reviews Ⅱ';});
