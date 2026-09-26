const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
let portfolio, selected = '全部', player, lastFocus;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; setTimeout(() => $('#toast').hidden = true, 3500); }
function image(work, preview = true) { const img = el('img'); img.src = preview ? work.preview : work.image; img.alt = work.title; img.loading = 'lazy'; img.decoding = 'async'; return img; }
function render() {
  const { settings: s, works } = portfolio;
  document.title = `${s.name} · ${s.subtitle || '摄影作品集'}`;
  $('#brand').textContent = $('#footer-name').textContent = $('#about-name').textContent = s.name;
  $('#subtitle').textContent = s.subtitle; $('#headline').textContent = s.headline;
  $('#bio').textContent = s.bio || '摄影师尚未填写介绍。';
  const contacts = $('#contacts'); contacts.replaceChildren();
  if (s.email) { const a = el('a', '', s.email); a.href = 'mailto:' + s.email; contacts.append(a); }
  if (s.wechat) contacts.append(el('span', '', '微信：' + s.wechat));
  const photos = works.filter(w => w.kind === 'photo');
  const categories = ['全部', ...new Set(photos.map(w => w.category))];
  if (!categories.includes(selected)) selected = '全部';
  $('#filters').replaceChildren(...categories.map(c => { const b = el('button', `filter${selected === c ? ' active' : ''}`, c); b.setAttribute('aria-pressed', String(selected === c)); b.onclick = () => { selected = c; render(); }; return b; }));
  $('#demo-note').hidden = !works.some(w => w.demo);
  const visible = photos.filter(w => selected === '全部' || w.category === selected);
  $('#gallery').replaceChildren(...visible.map((work, i) => {
    const b = el('button', 'photo-card'); b.setAttribute('aria-label', '查看作品：' + work.title); b.onclick = () => open(work);
    const frame = el('div', 'photo-frame'), img = image(work); if (i === 0) { img.loading = 'eager'; img.fetchPriority = 'high'; } frame.append(img, el('span', 'photo-number', String(i + 1).padStart(2, '0')));
    const meta = el('div', 'card-meta'); meta.append(el('h3', '', work.title), el('p', '', [work.location, work.year].filter(Boolean).join(' / ') || work.category)); b.append(frame, meta); return b;
  }));
  if (!visible.length) $('#gallery').append(el('p', 'empty-state', '还没有摄影作品。'));
  const panoramas = works.filter(w => w.kind === 'panorama');
  $('#pano-gallery').replaceChildren(...panoramas.map(work => {
    const b = el('button', 'pano-card'); b.setAttribute('aria-label', '进入360度全景：' + work.title); b.onclick = () => open(work);
    const content = el('div', 'pano-content'), title = el('div'); title.append(el('p', '', '360° 全景作品' + (work.demo ? ' · 演示' : '')), el('h3', '', work.title), el('p', '', work.location));
    const enter = el('span', 'pano-enter', '进入全景'); enter.prepend(el('span', 'pano-orbit', '360°')); content.append(title, enter); b.append(image(work), content); return b;
  }));
  if (!panoramas.length) $('#pano-gallery').append(el('p', 'empty-state', '还没有全景作品。'));
}
function open(work) {
  lastFocus = document.activeElement;
  const stage = $('#viewer-stage'); stage.replaceChildren();
  $('#viewer-title').textContent = work.title; $('#viewer-description').textContent = work.description;
  $('#viewer-kind').textContent = work.kind === 'panorama' ? '360° 全景作品' : '摄影作品';
  $('#viewer-meta').textContent = [work.location, work.year, work.category].filter(Boolean).join(' / ');
  const credit = $('#viewer-credit'); credit.replaceChildren();
  if (work.demo) { credit.append(document.createTextNode('演示素材 · ' + (work.credit || ''))); for (const [url, label] of [[work.source, ' 查看来源'], [work.licenseUrl, ' 许可协议']]) if (url && /^https:\/\//.test(url)) { const a = el('a', '', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; credit.append(a); } }
  $('#viewer-dialog').showModal(); document.body.style.overflow = 'hidden';
  if (work.kind === 'photo') { const img = image(work, false); img.loading = 'eager'; img.onerror = () => { stage.replaceChildren(el('p', '', '照片加载失败，请关闭后重试。')); }; stage.append(img); return; }
  const canvas = el('div', 'panorama-player'); stage.append(canvas);
  try {
    player = pannellum.viewer(canvas, { type: 'equirectangular', panorama: work.image, autoLoad: true, showControls: false, hfov: 100, minHfov: 40, maxHfov: 120, mouseZoom: true, compass: false, strings: { loadingLabel: '正在加载全景…', bylineLabel: '作者：%s', noWebGLError: '当前设备无法显示交互全景，请使用支持 WebGL 的浏览器。', genericWebGLError: '全景显示失败，请重试。', textureSizeError: '照片分辨率超出此设备的显示能力。', fileAccessError: '全景图片加载失败。', malformedURLError: '全景图片地址无效。' } });
    const hint = el('span', 'pano-hint', '拖动查看四周 · 滚轮或双指缩放');
    const controls = el('div', 'pano-controls');
    const actions = [['放大', () => player.setHfov(player.getHfov() - 15)], ['缩小', () => player.setHfov(player.getHfov() + 15)], ['复位', () => { player.setYaw(0); player.setPitch(0); player.setHfov(100); }], ['全屏', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => toast('请使用浏览器退出全屏')); else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => toast('当前浏览器暂不支持全屏')); else toast('当前已使用窗口内最大视图'); }]];
    for (const [label, fn] of actions) { const b = el('button', '', label); b.onclick = fn; if (label === '全屏') b.id = 'pano-fullscreen'; controls.append(b); }
    stage.append(hint, controls); player.on('error', () => { controls.hidden = true; hint.hidden = true; });
  } catch { stage.replaceChildren(el('p', '', '全景播放器加载失败，请刷新页面或更换浏览器。')); }
}
function close() { $('#viewer-dialog').close(); }
document.addEventListener('fullscreenchange', () => { if ($('#pano-fullscreen')) $('#pano-fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '全屏'; });
$('#close-viewer').onclick = close;
$('#viewer-dialog').addEventListener('close', () => { player?.destroy(); player = null; $('#viewer-stage').replaceChildren(); document.body.style.overflow = ''; lastFocus?.focus(); });
fetch('/api/portfolio').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(data => { portfolio = data; render(); }).catch(() => { $('#gallery').replaceChildren(el('p', 'empty-state', '作品暂时无法加载，请刷新重试。')); });
