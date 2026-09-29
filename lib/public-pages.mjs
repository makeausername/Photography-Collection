import { resolveHeroSlides } from './hero.mjs';
import { queryWorks, libraryPage, featured, publicSeries } from './library.mjs';
import { imageSources } from '../public/image-sources.js';
import { readFileSync } from 'node:fs';
import { pageShare } from './page-sharing.mjs';
import { journalEntries, journalList, journalArticle, journalExcerpt, journalWork } from './journal.mjs';

const titles = { home: '摄影作品集', works: '摄影作品', panoramas: '360° 全景', about: '关于摄影师', work: '作品', series: '旅行系列', journal:'随记', entry:'随记', notfound: '页面未找到' };
const readView = name => readFileSync(new URL(`../views/${name}.html`, import.meta.url), 'utf8');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const externalLink = (url, content) => `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${content}</a>`;

export function validSocialURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}

function footerContacts(settings) {
  const links = [];
  if (settings.email) links.push(`<a href="mailto:${escapeHTML(settings.email)}">联系邮箱 ↗</a>`);
  for (const [key,label] of [['vcgUrl','视觉中国'],['tuchongUrl','图虫']]) if (settings[key] && validSocialURL(settings[key])) links.push(externalLink(settings[key], label + ' ↗'));
  if (settings.xiaohongshuUrl && validSocialURL(settings.xiaohongshuUrl)) links.push(externalLink(settings.xiaohongshuUrl, '小红书 ↗'));
  return links.join('');
}

function filingHTML(settings) {
  const items = [];
  if (settings.icpNumber) items.push(externalLink('https://beian.miit.gov.cn/', escapeHTML(settings.icpNumber)));
  const policeCode = settings.policeNumber?.match(/公网安备\s*(\d{14})\s*号$/)?.[1];
  if (policeCode) items.push(externalLink(`https://beian.mps.gov.cn/#/query/webSearch?code=${policeCode}`, `<img src="/beian-police.png" width="20" height="20" alt="">${escapeHTML(settings.policeNumber)}`));
  return items.length ? `<div class="footer-filing" aria-label="网站备案信息">${items.join('')}</div>` : '';
}

export function renderPublicPage(page, settings = {}, work, sharing, context = {}) {
  if (!Object.hasOwn(titles, page)) throw new Error('Unknown public page');
  const home = page === 'home';
  const sections = home ? ['intro', 'works', 'panoramas', 'about-preview'] : page === 'series' ? ['works','panoramas'] : [page];
  const breadcrumb = home ? '' : `<div class="page-breadcrumb section-shell"><a href="/">首页</a><span aria-hidden="true">/</span><span>${titles[page]}</span></div>`;
  const siteName = escapeHTML(settings.name || 'KosmoYonder');
  const subtitle = escapeHTML(settings.subtitle || '风光与旅行摄影');
  const homeIntro = escapeHTML(settings.homeIntro || '自然风光与旅行摄影。');
  let content = breadcrumb + sections.filter(name => !['work','notfound','journal','entry'].includes(name)).map(name => readView(name).replace(/\{\{(headingTag|siteName|homeIntro|subtitle|bio)\}\}/g, (_, key) => ({ headingTag: home || page === 'series' ? 'h2' : 'h1', siteName, homeIntro, subtitle, bio: escapeHTML(settings.bio || '') })[key])).join('\n');
  if(page==='journal')content+=journalList(context.db,{page:context.journalPage||1});
  if(page==='entry')content=journalArticle(context.db,context.entry,{preview:context.preview});
  if (work) content = `<section class="work-detail"><p class="eyebrow">${work.kind === 'panorama' ? '360° / PANORAMA' : 'PHOTOGRAPHY / JOURNEYS'}</p><h1>${escapeHTML(work.title)}</h1><p class="work-place">${escapeHTML([work.location, work.category].filter(Boolean).join(' / '))}</p><button id="detail-view" class="detail-image" aria-label="${work.kind === 'panorama' ? '进入全景' : '查看大图'}"><img data-artwork draggable="false" src="/media/${encodeURIComponent(work.id)}/${work.kind === 'panorama' ? 'preview' : 'image'}.jpg" srcset="${imageSources(`/media/${encodeURIComponent(work.id)}/${work.kind === 'panorama' ? 'preview' : 'image'}.jpg`, work, work.kind === 'panorama' ? 1200 : (settings.displayMax || 2400))}" sizes="(max-width: 1200px) 92vw, 1120px" decoding="async" fetchpriority="high" alt="${escapeHTML(work.title)}"><span>${work.kind === 'panorama' ? '360° 进入全景' : '查看大图 ↗'}</span></button><div class="detail-toolbar"><button id="detail-share" class="share-trigger">↗ 分享作品</button><a href="${work.kind === 'panorama' ? '/panoramas' : '/works'}">浏览更多作品 →</a></div><p class="detail-description">${escapeHTML(work.description)}</p>${work.demo ? `<p class="detail-credit">示例图片 · ${escapeHTML(work.credit)} ${work.source && validSocialURL(work.source) ? externalLink(work.source, '查看来源') : ''} ${work.licenseUrl && validSocialURL(work.licenseUrl) ? externalLink(work.licenseUrl, '许可协议') : ''}</p>` : ''}</section>`;
  if (page === 'series') { let searchForms = 0; content = content.replace(/<form id="public-search"[\s\S]*?<\/form>/g, html => ++searchForms === 1 ? html : ''); }
  if (home) content = content.replace(/<form id="public-search"[\s\S]*?<\/form>/g, '');
  if (page === 'notfound') content = `<section class="not-found section-shell"><p class="eyebrow">404</p><h1>这一页不在这里了。</h1><p>作品可能已移除，也可能是链接有误。</p><a class="text-link" href="/works">回到摄影作品 →</a></section>`;
  if (page === 'about') {
    if (settings.profilePhoto) content = content.replace('<p class="about-motto">', '<img class="profile-photo" src="/profile.webp" alt="'+siteName+' 在旅途中" loading="lazy"><p class="about-motto">');
    content = content.replace('<div id="contacts" class="contacts"></div>', `<section id="contacts" class="contact-section"><h2>联系与图片使用</h2><p id="contact-context">${settings.email ? '图片使用与合作，请通过邮箱联系。' : '联系方式尚未公开。'}</p><div class="contacts">${footerContacts(settings)}</div>${settings.email ? `<a class="text-link" id="licensing-email" href="mailto:${escapeHTML(settings.email)}">咨询图片使用 ↗</a>` : ''}</section>`);
  }
  if (context.db) {
    if (home) {
      const first = resolveHeroSlides(context.db)[0];
      if (first) {
        const item = context.db.works.find(work => work.id === first.workId);
        const src = `/media/${encodeURIComponent(item.id)}/image.jpg`;
        const cover = `<img class="is-active" data-artwork draggable="false" src="${src}" srcset="${imageSources(src,item,settings.displayMax || 2400)}" sizes="100vw" fetchpriority="high" decoding="async" alt="" style="--hero-x:${first.x}%;--hero-y:${first.y}%;--hero-mx:${first.mobileX}%;--hero-my:${first.mobileY}%">`;
        content = content.replace('<div id="hero-image" class="hero-image" aria-hidden="true"></div>', `<div id="hero-image" class="hero-image" aria-hidden="true">${cover}</div>`)
          .replace('id="hero-caption" class="hero-caption" href="/works" hidden', `id="hero-caption" class="hero-caption" href="/work/${encodeURIComponent(item.id)}"`)
          .replace('<span id="hero-title" class="hero-title"></span>', `<span id="hero-title" class="hero-title">${escapeHTML(item.title)}</span>`)
          .replace('<span id="hero-location" class="hero-location"></span>', `<span id="hero-location" class="hero-location">${escapeHTML(item.location)}</span>`);
      } else content = content.replace('class="intro"', 'class="intro" hidden');
      content = content.replace('id="photo-count" class="work-count"', 'id="photo-count" class="work-count" hidden');
    }
    const cards = (works, pano = false) => works.map(item => `<a class="${pano ? 'pano-card' : 'photo-card'}" data-work-id="${escapeHTML(item.id)}" href="/work/${encodeURIComponent(item.id)}" aria-label="${pano ? '进入360度全景：' : '查看作品：'}${escapeHTML(item.title)}"><div class="${pano ? 'pano-picture' : 'photo-frame'}"><img data-artwork draggable="false" src="${escapeHTML(item.preview)}" srcset="${imageSources(item.preview,item,1200)}" sizes="(max-width:700px) 90vw,30vw" loading="lazy" decoding="async" alt="${escapeHTML(item.title)}"></div><div class="${pano ? 'pano-content' : 'card-meta'}"><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML([item.location,item.year].filter(Boolean).join(' / '))}</p>${pano ? '<span class="pano-enter">进入全景 ↗</span>' : ''}</div></a>`).join('');
    const photos = home ? featured(context.db,'photo') : libraryPage(context.db,{...context.query,kind:'photo'}).works;
    const panos = home ? featured(context.db,'panorama') : libraryPage(context.db,{...context.query,kind:'panorama'}).works;
    content = content.replace(/<div id="gallery"[^>]*>[\s\S]*?<\/div>/, `<div id="gallery" class="gallery" aria-live="polite">${cards(photos) || '<p class="empty-state">还没有符合条件的作品。</p>'}</div>`);
    content = content.replace('<div id="pano-gallery"></div>', `<div id="pano-gallery">${cards(panos,true)}</div>`);
    const seriesList = publicSeries(context.db);
    if (home) content = content.replace('<section id="about"',journalList(context.db,{home:true})+'<section id="about"');
    if(page==='works'&&seriesList.length)content=content.replace('<div class="collection-toolbar"',`<details class="series-directory"><summary>按组图浏览</summary><div>${seriesList.map(s=>`<a href="/series/${encodeURIComponent(s.id)}">${escapeHTML(s.title)} <span>${s.count} 幅 ↗</span></a>`).join('')}</div></details><div class="collection-toolbar"`);
    if (page === 'series') content = `<section class="series-intro section-shell"><a href="/works">← 摄影作品</a><p class="eyebrow">ON THE ROAD</p><h1>${escapeHTML(context.series.title)}</h1><p class="series-trip-meta">${escapeHTML([context.series.location,context.series.period].filter(Boolean).join(" / "))}</p><p class="series-story">${escapeHTML(context.series.description)}</p><button class="page-share-button" data-page-share="series">分享这个系列 ↗</button></section>` + content.replace('<h1 id="works-title">摄影作品</h1>','<h2 id="works-title">系列作品</h2>');
    if (['works','panoramas','series'].includes(page)) {
      const list = libraryPage(context.db,{...context.query,kind:page==='panoramas'?'panorama':'photo'});
      const base = page==='series'?'/series/'+encodeURIComponent(context.series.id):'/'+page;
      const makePage = number => { const params = new URLSearchParams(); for (const key of ['q','category','location','year','sort']) if (typeof context.query?.[key]==='string') params.set(key,context.query[key]); params.set('page',String(number)); return base+'?'+params.toString(); };
      content += `<nav class="page-links section-shell" aria-label="作品翻页">${list.page>1?`<a href="${escapeHTML(makePage(list.page-1))}">上一页</a>`:''}${list.page<list.pages?`<a href="${escapeHTML(makePage(list.page+1))}">下一页 →</a>`:''}</nav>`;
    }
    if (work) {
      const related=journalEntries(context.db).filter(entry=>entry.blocks.some(b=>b.type==='image'&&b.workId===work.id)||(work.seriesId&&entry.seriesId===work.seriesId)).slice(0,3);
      if(related.length)content+=`<aside class="work-journal section-shell"><h2>相关随记</h2>${related.map(entry=>`<a href="/journal/${encodeURIComponent(entry.id)}">${escapeHTML(entry.title)} ↗</a>`).join('')}</aside>`;
      const activeSeries=publicSeries(context.db).some(s=>s.id===work.seriesId)?work.seriesId:'';
      const siblings=queryWorks(context.db,{kind:work.kind,series:activeSeries}),index=siblings.findIndex(item=>item.id===work.id);
      content += `<nav class="work-neighbors section-shell" aria-label="浏览相邻作品">${index>0?`<a href="/work/${encodeURIComponent(siblings[index-1].id)}">← 上一幅</a>`:'<span></span>'}${index<siblings.length-1?`<a href="/work/${encodeURIComponent(siblings[index+1].id)}">下一幅 →</a>`:''}</nav>`;
      if (!work.demo) content = content.replace('<div class="detail-toolbar">',`<div class="detail-toolbar"><a href="/about?work=${encodeURIComponent(work.id)}#contacts">咨询图片使用 ↗</a>`);
    }
  }
  if(work&&!work.demo){
    const links=[['vcgLicenseUrl','在视觉中国获取授权 ↗'],['tuchongLicenseUrl','在图虫获取授权 ↗']].filter(([key])=>validSocialURL(work[key])).map(([key,label])=>'<a data-license data-work-id="'+escapeHTML(work.id)+'" href="'+escapeHTML(work[key])+'" target="_blank" rel="noopener noreferrer">'+label+'</a>').join('');
    if(links)content=content.replace('<p class="detail-description">','<div class="license-links">'+links+'</div><p class="detail-description">');
  }
  const route = home ? '/' : page === 'work' ? '/work/'+encodeURIComponent(work.id) : page === 'series' ? '/series/'+encodeURIComponent(context.series.id) : '/'+page;
  const descriptions = { home: settings.homeIntro || 'KosmoYonder 的风光与旅行摄影作品。', works: '浏览 KosmoYonder 的自然风光与人像摄影，按题材、拍摄地点查找作品。', panoramas: '浏览 KosmoYonder 的 360° 全景作品，拖动查看四周。', about: settings.bio?.split('\n')[0] || '关于 KosmoYonder，以及图片使用与合作联系方式。', series: context.series?.description || context.series?.title, work: work ? [work.title,work.location,work.description].filter(Boolean).join(' · ') : '', notfound:'页面不存在或作品已移除。' };
  const values = {
    shareMeta: sharing ? `<link rel="canonical" href="${escapeHTML(sharing.url)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHTML(work.title)} · ${siteName}"><meta property="og:description" content="${escapeHTML([work.location, settings.subtitle].filter(Boolean).join(' / '))}"><meta property="og:url" content="${escapeHTML(sharing.url)}"><meta property="og:image" content="${escapeHTML(sharing.card)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">` : (context.origin ? `<link rel="canonical" href="${escapeHTML(context.origin+route)}">` : '') + (page === 'notfound' ? '<meta name="robots" content="noindex">' : ''), workId: escapeHTML(work?.id || ''), seriesId: escapeHTML(context.series?.id || ''),
    content, page, title: `${siteName} · ${work ? escapeHTML(work.title) : home ? subtitle : page === 'series' ? escapeHTML(context.series.title) : titles[page]}`, pageClass: home ? '' : 'collection-page',
    worksCurrent: page === 'works' ? ' aria-current="page"' : '',
    panoramasCurrent: page === 'panoramas' ? ' aria-current="page"' : '',
    aboutCurrent: page === 'about' ? ' aria-current="page"' : '',
    journalNav:context.db&&(journalEntries(context.db).length||page==='journal'||page==='entry')?`<a href="/journal"${['journal','entry'].includes(page)?' aria-current="page"':''}>随记</a>`:'',
    siteName, subtitle, description: escapeHTML(descriptions[page]?.slice(0,180) || settings.subtitle), year: new Date().getFullYear(), footerContacts: footerContacts(settings), filing: filingHTML(settings),
  };
  if(!sharing && !['notfound','journal','entry'].includes(page) && context.db && context.origin){
    const info=pageShare(context.db,context.origin,page==='series'?context.series.id:'')?.info;
    if(info)values.shareMeta+=`<meta property="og:type" content="website"><meta property="og:title" content="${escapeHTML(page==='series'?info.title:settings.name)}"><meta property="og:description" content="${escapeHTML(descriptions[page])}"><meta property="og:url" content="${escapeHTML(context.origin+route)}"><meta property="og:image" content="${escapeHTML(info.card)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`;
  }
  if(page==='journal')values.description='旅行见闻、拍摄记录和一些随想。';
  if(page==='entry'){
    const entry=context.entry,url=context.origin+'/journal/'+encodeURIComponent(entry.id),cover=journalWork(context.db,entry.coverWorkId);
    values.title=escapeHTML(entry.title||'草稿预览')+' · '+siteName;
    values.description=escapeHTML(journalExcerpt(entry));
    values.shareMeta=context.preview?'<meta name="robots" content="noindex,nofollow">':`<link rel="canonical" href="${escapeHTML(url)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHTML(entry.title)}"><meta property="og:description" content="${values.description}"><meta property="og:url" content="${escapeHTML(url)}">${cover?`<meta property="og:image" content="${escapeHTML(context.origin+'/work/'+encodeURIComponent(cover.id)+'/card.jpg')}">`:''}`;
  }
  if(work&&!work.demo&&context.origin){
    const metadata={'@context':'https://schema.org','@type':'ImageObject',name:work.title,description:work.description || work.title,contentUrl:context.origin+'/media/'+encodeURIComponent(work.id)+'/image.jpg',creator:{'@type':'Person',name:settings.name || 'KosmoYonder'},creditText:settings.name || 'KosmoYonder',copyrightNotice:settings.copyrightNotice || '版权所有，使用请先联系授权。',license:context.origin+'/about#contacts',acquireLicensePage:work.vcgLicenseUrl || work.tuchongLicenseUrl || context.origin+'/about?work='+encodeURIComponent(work.id)+'#contacts'};
    values.shareMeta+='<script type="application/ld+json">'+JSON.stringify(metadata).replaceAll('<','\\u003c')+'</script>';
  }
  return readView('layout').replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
}
