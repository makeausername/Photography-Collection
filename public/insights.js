export function track(event,work='') {
  if(navigator.doNotTrack==='1')return;
  fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,work}),keepalive:true}).catch(()=>{});
}
document.addEventListener('click',event=>{
  const link=event.target.closest('a');
  if(link && (link.matches('[data-license]') || link.getAttribute('href')?.startsWith('mailto:') || link.getAttribute('href')?.startsWith('/about?work='))){
    const url=new URL(link.href,location.href);
    track('contact',link.dataset.workId || url.searchParams.get('work') || document.body.dataset.workId || new URLSearchParams(location.search).get('work') || '');
  }
});
