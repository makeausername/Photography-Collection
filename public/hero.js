import { imageSources } from './image-sources.js';

export function mountHero(slides, settings, openWork) {
  const root = document.querySelector('.intro');
  if (!root || !slides.length) { if (root) root.hidden = true; return; }
  const stage = root.querySelector('#hero-image'), caption = root.querySelector('#hero-caption');
  const toggle = root.querySelector('#hero-toggle'), status = root.querySelector('#hero-status');
  const seconds = Number(settings.heroInterval ?? 7);
  const interval = (Number.isInteger(seconds) && seconds >= 3 && seconds <= 30 ? seconds : 7) * 1000;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0, ticket = 0, timer, preloadTimer, toggleIntent, loading = true, hovered = false, visible = false, allowHoverPlayback = false, paused = reduced.matches || settings.heroAutoplay === 'off';
  const images = new Map();

  function crop(img, slide) {
    for (const [key, value] of Object.entries({x:slide.x,y:slide.y,mx:slide.mobileX,my:slide.mobileY})) img.style.setProperty('--hero-'+key, value+'%');
  }
  function load(number) {
    if (images.has(number)) return images.get(number);
    const slide = slides[number], img = number === 0 && stage.firstElementChild ? stage.firstElementChild : new Image();
    crop(img, slide); img.alt = ''; img.dataset.artwork = ''; img.draggable = settings.imageGuard !== 'on';
    img.decoding = 'async'; img.loading = 'eager';
    if (!img.getAttribute('src')) {
      img.sizes = '100vw'; img.srcset = imageSources(slide.work.image, slide.work, settings.displayMax);
      img.fetchPriority = number === 0 ? 'high' : 'low'; img.src = slide.work.image;
    }
    // A responsive source can change while decode() is pending (for example on rotation).
    // Wait for the new candidate instead of treating the cancelled decode as an image failure.
    const ready = img.decode().catch(error => {
      if (img.complete) { if (img.naturalWidth) return; throw error; }
      return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timeout); img.removeEventListener('load', loaded); img.removeEventListener('error', failed); };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(error); };
        const timeout = setTimeout(failed, 20000);
        img.addEventListener('load', loaded, {once:true}); img.addEventListener('error', failed, {once:true});
      });
    }).then(() => img).catch(error => { images.delete(number); throw error; });
    images.set(number, ready); return ready;
  }
  function label() {
    const work = slides[index].work;
    caption.hidden = false; caption.href = '/work/'+encodeURIComponent(work.id);
    root.querySelector('#hero-title').textContent = work.title;
    root.querySelector('#hero-location').textContent = work.location || '';
    toggle.dataset.paused = String(paused);
    toggle.title = paused ? '播放轮播' : '暂停轮播';
    toggle.setAttribute('aria-label', paused ? '播放轮播' : '暂停轮播');
  }
  function schedule() {
    clearTimeout(timer);
    label();
    if (slides.length > 1 && !loading && !paused && (!hovered || allowHoverPlayback) && visible && !document.hidden && !document.querySelector('dialog[open]')) timer = setTimeout(() => go(index+1), interval);
  }
  async function go(next, manual = false) {
    if (manual) paused = true;
    loading = true; clearTimeout(timer); clearTimeout(preloadTimer);
    const request = ++ticket, number = (next+slides.length)%slides.length;
    try {
      const img = await load(number);
      if (request !== ticket) return;
      const previous = stage.querySelector('.is-active');
      if (!img.isConnected) { img.classList.remove('is-active'); stage.append(img); }
      // Establish the inserted frame's initial opacity before starting the crossfade.
      void img.offsetWidth;
      img.classList.add('is-active');
      if (previous !== img) previous?.classList.remove('is-active');
      loading = false; index = number; status.textContent = manual ? `第 ${index+1} 张：${slides[index].work.title}` : '';
      schedule();
      // Preload one neighbour after display, rather than requesting every full-size image at once.
      if (slides.length > 1 && visible && !document.hidden) preloadTimer = setTimeout(() => load((index+1)%slides.length).catch(() => {}), 1200);
    } catch {
      if (request !== ticket) return;
      loading = false; paused = true; status.textContent = '这张照片暂时无法加载，请再次切换。'; schedule();
    }
  }
  toggle.hidden = slides.length < 2;
  caption.onclick = event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); paused = true; schedule(); openWork(slides[index].work); };
  toggle.addEventListener('pointerdown', () => { toggleIntent = !paused; });
  toggle.onclick = () => { paused = toggleIntent ?? !paused; toggleIntent = undefined; allowHoverPlayback = !paused; schedule(); };
  root.addEventListener('mouseenter', () => { hovered = true; allowHoverPlayback = false; schedule(); });
  root.addEventListener('mouseleave', () => { hovered = false; allowHoverPlayback = false; schedule(); });
  root.addEventListener('focusin', () => { paused = true; schedule(); });
  root.addEventListener('keydown', event => {
    if (slides.length > 1 && ['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); go(index+(event.key==='ArrowLeft'?-1:1), true); }
  });
  let touch;
  root.addEventListener('touchstart', event => { touch = event.touches.length===1 ? {x:event.touches[0].clientX,y:event.touches[0].clientY} : null; }, {passive:true});
  root.addEventListener('touchmove', event => { if (event.touches.length!==1) touch=null; }, {passive:true});
  root.addEventListener('touchcancel', () => { touch=null; });
  root.addEventListener('touchend', event => {
    if (!touch || event.touches.length || slides.length<2) return;
    const end=event.changedTouches[0], dx=end.clientX-touch.x, dy=end.clientY-touch.y; touch=null;
    if (Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.5) go(index+(dx<0?1:-1), true);
  }, {passive:true});
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', () => { if (reduced.matches) paused=true; schedule(); });
  new IntersectionObserver(entries => { visible=entries[0].isIntersecting && entries[0].intersectionRatio>=0.25; schedule(); }, {threshold:0.25}).observe(root);
  const dialogs = new MutationObserver(schedule);
  document.querySelectorAll('dialog').forEach(dialog => dialogs.observe(dialog,{attributes:true,attributeFilter:['open']}));
  go(0);
}
