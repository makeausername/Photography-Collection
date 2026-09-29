import { track } from './insights.js';
import { loadBrowseState, saveBrowseState } from './browse-state.js';
import { mountHero } from './hero.js';
import { openShare } from './share.js';
import { imageSources } from './image-sources.js';
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const page = document.body.dataset.page || 'home';
let seriesId = document.body.dataset.seriesId || '';
const browseKey=location.pathname+location.search;
const returning=performance.getEntriesByType('navigation')[0]?.type==='back_forward';
const savedBrowse=returning?loadBrowseState(browseKey):null;
let place=initialValue('location'),year=initialValue('year'),sort=initialValue('sort');
function initialValue(key){return new URLSearchParams(location.search).get(key)||'';}
const initial = new URLSearchParams(location.search);
let selected = initial.get('category') || '', query = initial.get('q') || '', portfolio, player, currentWork, lastFocus, toastTimer, neighbors = {}, viewerTicket = 0;
const listTickets = {photo:0,panorama:0};
let photoPage = Math.max(1,Number(initial.get('page'))||1), panoPage = photoPage;
let photoWorks = [], panoWorks = [], photoTotal = 0, panoTotal = 0;
let stepping = false;
async function fetchJSON(url) { const response = await fetch(url); if (!response.ok) throw Error('暂时无法加载，请重试。'); return response.json(); }
function toast(message) { const notice = $('#toast'); (document.fullscreenElement || ($('#viewer-dialog').open ? $('#viewer-dialog') : document.body)).append(notice); notice.textContent = message; notice.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => notice.hidden = true, 3500); }
function params(kind, number) { const p = new URLSearchParams(); if(kind)p.set('kind',kind);if(number)p.set('page',number);if(selected)p.set('category',selected);if(query)p.set('q',query);if(seriesId)p.set('series',seriesId);if(place)p.set('location',place);if(year)p.set('year',year);if(sort)p.set('sort',sort);return p; }
function image(work, preview = true) { const img = el('img'); img.src = preview ? work.preview : work.image; if(preview || work.kind === 'photo'){img.srcset = imageSources(img.getAttribute('src'),work,preview?1200:portfolio.settings.displayMax);img.sizes=preview?'(max-width:700px) 90vw,30vw':'100vw';} img.alt=work.title;img.loading='lazy';img.decoding='async';img.dataset.artwork='';img.draggable=portfolio.settings.imageGuard!=='on';return img; }
function workLink(work, cls) { const a=el('a',cls);a.href='/work/'+encodeURIComponent(work.id);a.dataset.workId=work.id;a.setAttribute('aria-label',(work.kind==='photo'?'查看作品：':'进入360度全景：')+work.title);a.onclick=e=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();open(work);};return a; }
function photoCard(work) { const a=workLink(work,'photo-card'), frame=el('div','photo-frame'), meta=el('div','card-meta');frame.append(image(work),el('span','photo-open','↗'));meta.append(el('h3','',work.title),el('p','',[work.location,work.year].filter(Boolean).join(' / ')));a.append(frame,meta);return a; }
function panoCard(work) { const a=workLink(work,'pano-card'), content=el('div','pano-content'), copy=el('div');copy.append(el('p','','360° 全景'),el('h3','',work.title),el('p','',work.location));content.append(copy,el('span','pano-enter','进入全景 ↗'));a.append(image(work),content);return a; }
function renderCollection(kind, append = false) {
  const photo=kind==='photo', target=$(photo?'#gallery':'#pano-gallery');if(!target)return;
  const works=photo?photoWorks:panoWorks,total=photo?photoTotal:panoTotal,currentPage=photo?photoPage:panoPage,limit=photo?6:3;
  const start=append?target.children.length:0;
  if(append)target.append(...works.slice(start).map(photo?photoCard:panoCard));else target.replaceChildren(...works.map(photo?photoCard:panoCard));
  if(append)target.children[start]?.focus({preventScroll:true});
  if(!works.length)target.append(el('p','empty-state','没有符合条件的作品。'));
  const pagination=$(photo?'#gallery-pagination':'#pano-pagination'), progress=$(photo?'#gallery-progress':'#pano-progress'), button=$(photo?'#load-more':'#pano-load-more');
  pagination.hidden=page==='home'||!total;
  if(!photo&&page==='series')target.closest('section').hidden=!total;
  progress.textContent=`已显示 ${works.length} / ${total} 幅${currentPage*limit>=total?' · 已全部显示':''}`;
  button.hidden=currentPage*limit>=total;
  if(photo){$('#photo-count').hidden=page==='home';$('#photo-count').textContent=page==='home'?'':total+' 幅作品';$('#demo-note').hidden=!works.some(w=>w.demo);}
}
function filterButtons(){const target=$('#filters');if(!target)return;target.hidden=page==='home';target.replaceChildren(...['',...portfolio.categories].map(category=>{const b=el('button','filter'+(selected===category?' active':''),category||'全部');b.setAttribute('aria-pressed',String(selected===category));b.onclick=()=>{selected=category;photoPage=panoPage=1;updateURL();filterButtons();loadLists();};return b;}));}
function updateURL(){const p=params();p.delete('series');history.replaceState(null,'',location.pathname+(p.size?'?'+p:'')+location.hash);$('#clear-search')?.toggleAttribute('hidden',!query);}
async function loadList(kind, append=false){
  const ticket=++listTickets[kind];
  const photo=kind==='photo',target=$(photo?'#gallery':'#pano-gallery');if(!target)return;
  const button=$(photo?'#load-more':'#pano-load-more');button.disabled=true;
  const number=photo?photoPage:panoPage;
  try{const data=await fetchJSON('/api/library?'+params(kind,number));if(ticket!==listTickets[kind])return;if(photo){photoWorks=append?[...photoWorks,...data.works]:data.works;photoTotal=data.total;}else{panoWorks=append?[...panoWorks,...data.works]:data.works;panoTotal=data.total;}renderCollection(kind,append);}
  catch(error){if(ticket!==listTickets[kind])return;toast(error.message);if(append){if(photo)photoPage--;else panoPage--;}else{target.replaceChildren(el('p','empty-state',error.message));const retry=el('button','load-more','重新加载');retry.onclick=()=>loadLists();target.append(retry);}}
  finally{if(ticket===listTickets[kind])button.disabled=false;}
}
async function loadLists(){await Promise.all(['photo','panorama'].map(kind=>loadList(kind,false)));}
function renderHome(){photoWorks=portfolio.photos;panoWorks=portfolio.panoramas;photoTotal=portfolio.totalPhotos;panoTotal=portfolio.totalPanoramas;renderCollection('photo');renderCollection('panorama');for(const [id,href,label]of [['gallery-pagination','/works','浏览全部摄影作品 →'],['pano-pagination','/panoramas','浏览全部全景 →']]){const target=$('#'+id);target.hidden=false;const a=el('a','text-link',label);a.href=href;target.replaceChildren(a);}}
async function init(){
  portfolio=await fetchJSON('/api/site');
  for(const nav of document.querySelectorAll('.page-links'))nav.hidden=true;
  document.body.classList.toggle('protect-images',portfolio.settings.imageGuard==='on');
  for(const img of document.querySelectorAll('img[data-artwork]'))img.draggable=portfolio.settings.imageGuard!=='on';
  filterButtons();
  if(page==='series')$('#works-title').textContent='系列作品';
  if($('#search-query')){$('#search-query').value=query;$('#clear-search').hidden=!query;$('#public-search').onsubmit=e=>{e.preventDefault();query=$('#search-query').value.trim();photoPage=panoPage=1;updateURL();loadLists();};$('#clear-search').onclick=()=>{$('#search-query').value=query='';photoPage=panoPage=1;updateURL();loadLists();};}
  if(page==='home'){
    mountHero(portfolio.heroSlides || [], portfolio.settings, open);
    renderHome();
  }else if(['works','panoramas','series'].includes(page)){
    await mountBrowseFilters();
    if(savedBrowse){
      const targetPhoto=Math.min(savedBrowse.photoPage||1,100),targetPano=Math.min(savedBrowse.panoPage||1,100);
      photoPage=panoPage=1;await loadLists();
      for(let i=2;i<=Math.max(targetPhoto,targetPano);i++){if(i<=targetPhoto&&$('#gallery')&&photoWorks.length<photoTotal){photoPage=i;await loadList('photo',true);}if(i<=targetPano&&$('#pano-gallery')&&panoWorks.length<panoTotal){panoPage=i;await loadList('panorama',true);}}
      await Promise.all([...document.querySelectorAll('main img')].filter(img=>img.getBoundingClientRect().top<savedBrowse.y+innerHeight).map(img=>Promise.race([img.decode().catch(()=>{}),new Promise(r=>setTimeout(r,1500))])));
      scrollTo(0,savedBrowse.y||0);
    }else await loadLists();
  }
  if(page==='work'){
    const info=await fetchJSON('/api/work/'+encodeURIComponent(document.body.dataset.workId));seriesId=info.work.seriesId || '';track('view',info.work.id);$('#detail-view').onclick=()=>open(info.work);$('#detail-share').onclick=()=>openShare(info.work);
    if(initial.get('share')==='wechat'){history.replaceState(null,'',location.pathname);openShare(info.work);}
  }
  if(page==='about'&&initial.get('work')){
    try{const info=await fetchJSON('/api/work/'+encodeURIComponent(initial.get('work')));$('#contact-context').textContent='咨询作品：'+info.work.title;const a=$('#licensing-email');if(a)a.href='mailto:'+portfolio.settings.email+'?subject='+encodeURIComponent('图片使用咨询 · '+info.work.title)+'&body='+encodeURIComponent('作品：'+info.work.title+'\n链接：'+location.origin+'/work/'+info.work.id+'\n用途：\n使用范围：');}catch{}
  }
}
if($('#load-more'))$('#load-more').onclick=()=>{photoPage++;loadList('photo',true);};
if($('#pano-load-more'))$('#pano-load-more').onclick=()=>{panoPage++;loadList('panorama',true);};
async function open(work, stepping = false) {
  const ticket = ++viewerTicket;
  player?.destroy(); player = null;
  currentWork = work;track('view',work.id);
  if (!stepping) lastFocus = document.activeElement;
  const stage = $('#viewer-stage'); stage.replaceChildren();
  $('#viewer-title').textContent = work.title; $('#viewer-description').textContent = work.description;
  $('#viewer-kind').textContent = work.kind === 'panorama' ? '360° 全景作品' : '摄影作品';
  $('#viewer-meta').textContent = [work.location, work.year, work.category].filter(Boolean).join(' / ');
  const credit = $('#viewer-credit'); credit.replaceChildren();
  if (work.demo) { credit.append(document.createTextNode('示例图片 · ' + (work.credit || ''))); for (const [url, label] of [[work.source, ' 查看来源'], [work.licenseUrl, ' 许可协议']]) if (url && /^https:\/\//.test(url)) { const a = el('a', '', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; credit.append(a); } }
  const notice = $('#viewer-protection'); notice.replaceChildren();
  if (!work.demo) {
    notice.append(document.createTextNode(portfolio.settings.copyrightNotice || ''));
    const contact = el('a', '', '咨询图片使用'); contact.href = '/about?work=' + encodeURIComponent(work.id) + '#contacts'; contact.dataset.workId=work.id;notice.append(contact);for(const [key,label]of [['vcgLicenseUrl','视觉中国授权 ↗'],['tuchongLicenseUrl','图虫授权 ↗']])if(work[key]){const a=el('a','',label);a.href=work[key];a.target='_blank';a.rel='noopener noreferrer';a.dataset.license='';a.dataset.workId=work.id;notice.append(a);}
  }
  if (!$('#viewer-dialog').open) $('#viewer-dialog').showModal(); document.body.style.overflow = 'hidden';
  $('#viewer-page').href = '/work/' + encodeURIComponent(work.id);
  $('#viewer-previous').disabled = $('#viewer-next').disabled = true;
  $('#viewer-position').textContent = '';
  neighbors = {};
  const detailParams = params();if(!detailParams.has('series')&&work.seriesId)detailParams.set('series',work.seriesId);
  fetchJSON('/api/work/' + encodeURIComponent(work.id) + '?' + detailParams).then(info => {
    if (ticket !== viewerTicket || !$('#viewer-dialog').open) return;
    neighbors = info; $('#viewer-position').textContent = info.position ? `${info.position} / ${info.total}` : '';
    $('#viewer-previous').disabled = !info.previous; $('#viewer-next').disabled = !info.next;
  }).catch(() => {});
  if (work.kind === 'photo') { const img = image(work, false); img.loading = 'eager'; img.onerror = () => { stage.replaceChildren(el('p', '', '照片加载失败，请关闭后重试。')); }; stage.append(img); return; }
  const canvas = el('div', 'panorama-player'); stage.append(canvas);
  try {
    let panoConfig;try{panoConfig=await fetchJSON('/api/panorama/'+encodeURIComponent(work.id));}catch{panoConfig={type:'equirectangular',panorama:work.image};}
    if(ticket!==viewerTicket||!$('#viewer-dialog').open)return;
    player = pannellum.viewer(canvas, { ...panoConfig, autoLoad: true, showControls: false, hfov: 100, minHfov: 40, maxHfov: 120, mouseZoom: true, compass: false, strings: { loadingLabel: '正在加载全景…', bylineLabel: '作者：%s', noWebGLError: '当前设备无法显示交互全景，请使用支持 WebGL 的浏览器。', genericWebGLError: '全景显示失败，请重试。', textureSizeError: '照片分辨率超出此设备的显示能力。', fileAccessError: '全景图片加载失败。', malformedURLError: '全景图片地址无效。' } });
    const hint = el('span', 'pano-hint', '拖动查看四周 · 滚轮或双指缩放');
    const controls = el('div', 'pano-controls');
    const actions = [['放大', () => player.setHfov(player.getHfov() - 15)], ['缩小', () => player.setHfov(player.getHfov() + 15)], ['复位', () => { player.setYaw(0); player.setPitch(0); player.setHfov(100); }], ['全屏', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => toast('请使用浏览器退出全屏')); else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => toast('当前浏览器暂不支持全屏')); else toast('当前已使用窗口内最大视图'); }]];
    for (const [label, fn] of actions) { const b = el('button', '', label); b.onclick = fn; if (label === '全屏') b.id = 'pano-fullscreen'; controls.append(b); }
    stage.append(hint, controls); player.on('error', () => { controls.hidden = true; hint.hidden = true;const retry=el('button','pano-fallback','使用普通模式打开');retry.onclick=()=>{player?.destroy();player=pannellum.viewer(canvas,{type:'equirectangular',panorama:work.image,autoLoad:true,showControls:true});retry.remove();};stage.append(retry); });
  } catch { stage.replaceChildren(el('p', '', '全景播放器加载失败，请刷新页面或更换浏览器。')); }
}

async function navigateWork(direction){if(stepping||!neighbors[direction])return;stepping=true;const id=neighbors[direction],ticket=viewerTicket;$('#viewer-previous').disabled=$('#viewer-next').disabled=true;try{const info=await fetchJSON('/api/work/'+encodeURIComponent(id)+'?'+params());if(ticket===viewerTicket&&$('#viewer-dialog').open)await open(info.work,true);}catch(error){toast(error.message);$('#viewer-previous').disabled=!neighbors.previous;$('#viewer-next').disabled=!neighbors.next;}finally{stepping=false;}}
$('#viewer-previous').onclick=()=>navigateWork('previous');$('#viewer-next').onclick=()=>navigateWork('next');
document.addEventListener('keydown',event=>{if(!$('#viewer-dialog').open||$('#share-dialog').open||event.target.closest('input,textarea,select,[contenteditable]'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigateWork(event.key==='ArrowLeft'?'previous':'next');}});
let swipe, touchCount=0;
$('#viewer-stage').addEventListener('touchstart',event=>{touchCount=event.touches.length;swipe=touchCount===1&&currentWork?.kind==='photo'?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
$('#viewer-stage').addEventListener('touchend',event=>{if(!swipe||touchCount!==1||event.touches.length)return;const end=event.changedTouches[0],dx=end.clientX-swipe.x,dy=end.clientY-swipe.y;swipe=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)navigateWork(dx<0?'next':'previous');},{passive:true});
$('#close-viewer').onclick=()=>$('#viewer-dialog').close();
$('#viewer-dialog').addEventListener('close',()=>{viewerTicket++;player?.destroy();player=null;document.body.append($('#toast'));$('#toast').hidden=true;$('#viewer-stage').replaceChildren();document.body.style.overflow='';lastFocus?.focus({preventScroll:true});});
document.addEventListener('fullscreenchange',()=>{if($('#pano-fullscreen'))$('#pano-fullscreen').textContent=document.fullscreenElement?'退出全屏':'全屏';});
for(const eventName of ['contextmenu','dragstart'])document.addEventListener(eventName,event=>{if(portfolio?.settings.imageGuard!=='on'||!event.target.closest('[data-artwork], .photo-frame, .pano-card, #hero-image, .panorama-player'))return;event.preventDefault();if(eventName==='contextmenu')toast('图片仅供浏览，使用请先取得授权。');});
$('#share-work').onclick=()=>{if(currentWork)openShare(currentWork);};
init().catch(error=>toast(error.message));

async function mountBrowseFilters(){
  const search=$('#public-search');if(!search)return;
  const details=el('details','browse-filters'),summary=el('summary','','筛选与排序');details.append(summary);details.open=!!(place||year||sort);
  const row=el('div','browse-filter-fields');details.append(row);search.after(details);
  let facets;try{facets=await fetchJSON('/api/library-facets?'+new URLSearchParams({kind:page==='panoramas'?'panorama':'photo',...(seriesId?{series:seriesId}:{})}));}catch{details.remove();return;}
  for(const [key,label,values,current]of [['sort','排序',[['','精选排序'],['latest','最新发布']],sort],['location','地点',[['','全部地点'],...facets.locations.map(v=>[v,v])],place],['year','年份',[['','全部年份'],...facets.years.map(v=>[v,v])],year]]){
    if(key==='sort'&&seriesId)continue;
    const field=el('label','',label),select=el('select');select.name=key;for(const [v,t]of values){const option=el('option','',t);option.value=v;select.append(option);}select.value=current;field.append(select);row.append(field);
    select.onchange=()=>{if(key==='sort')sort=select.value;else if(key==='location')place=select.value;else year=select.value;photoPage=panoPage=1;updateURL();loadLists();};
  }
}
window.addEventListener('pagehide',()=>{if(['works','panoramas','series'].includes(page))saveBrowseState(location.pathname+location.search,{photoPage,panoPage,y:scrollY});});
