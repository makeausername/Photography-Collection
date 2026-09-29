import { randomUUID } from 'node:crypto';
import { imageSources } from '../public/image-sources.js';

export const escapeJournal = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const journalEntries = db => (db.journal || []).filter(entry=>entry.live).map(entry=>({id:entry.id,...entry.live})).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
export const journalWork = (db,id) => db.works.find(work=>work.id===id&&work.status!=='draft');
export function parseJournal(value,db) {
  const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('随记内容过长或格式不正确');return v.trim();};
  const title=text(value.title??'',120),excerpt=text(value.excerpt??'',240);
  const coverWorkId=text(value.coverWorkId??'',80),seriesId=text(value.seriesId??'',80);
  // Keep references when a previously selected work is hidden or removed; public rendering omits it.
  if(!Array.isArray(value.blocks)||value.blocks.length>200)throw Error('每篇最多 200 个段落');
  const blocks=value.blocks.map(block=>{
    if(['text','heading','quote'].includes(block.type))return {type:block.type,text:text(block.text??'',15000)};
    if(block.type==='image')return {type:'image',workId:text(block.workId??'',80),caption:text(block.caption??'',300)};
    throw Error('段落类型无效');
  });
  if(JSON.stringify(blocks).length>60000)throw Error('这篇随记太长，请拆成两篇保存');
  return {title,excerpt,coverWorkId,seriesId,blocks};
}
export const journalExcerpt = entry => entry.excerpt || entry.blocks.filter(b=>b.type==='text').map(b=>b.text).join(' ').slice(0,150);
const date = value => new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric'});
export function journalList(db,{home=false,page=1}={}) {
  const all=journalEntries(db),entries=home?all.slice(0,3):all.slice((page-1)*9,page*9),e=escapeJournal;
  if(home&&!entries.length)return '';
  const rows=entries.map(entry=>{
    const cover=journalWork(db,entry.coverWorkId);
    return `<a class="journal-row${cover?' has-cover':''}" href="/journal/${encodeURIComponent(entry.id)}"><div><time datetime="${e(entry.publishedAt)}">${date(entry.publishedAt)}</time><h${home?'3':'2'}>${e(entry.title)}</h${home?'3':'2'}><p>${e(journalExcerpt(entry))}</p><span class="journal-read">阅读全文 ↗</span></div>${cover?`<img src="/media/${encodeURIComponent(cover.id)}/preview.jpg?w=480" alt="" loading="lazy" width="480" height="320" data-artwork draggable="false">`:''}</a>`;
  }).join('');
  return `<section class="journal-section section-shell"${home?' id="journal"':''}><div class="journal-heading"><h${home?'2':'1'}>随记</h${home?'2':'1'}>${home?'<a class="text-link" href="/journal">全部随记 ↗</a>':''}</div><div class="journal-list">${rows || '<p class="journal-empty">还没有发布随记。</p>'}</div>${!home&&all.length>9?`<nav class="journal-pagination" aria-label="随记翻页">${page>1?`<a href="/journal?page=${page-1}">← 上一页</a>`:'<span></span>'}${page*9<all.length?`<a href="/journal?page=${page+1}">下一页 →</a>`:''}</nav>`:''}</section>`;
}
export function journalArticle(db,entry,{preview=false}={}) {
  const e=escapeJournal,body=entry.blocks.map(block=>{
    if(block.type==='image'){
      const work=journalWork(db,block.workId);if(!work)return '';
      const src='/media/'+encodeURIComponent(work.id)+'/'+(work.kind==='panorama'?'preview':'image')+'.jpg';
      return `<figure><a href="/work/${encodeURIComponent(work.id)}"><img src="${src}?w=960" srcset="${imageSources(src,work,work.kind==='panorama'?1200:(db.settings.displayMax||2400))}" sizes="(max-width:700px) 88vw, 812px" alt="${e(block.caption||work.title)}" loading="lazy" data-artwork draggable="false"></a>${block.caption?`<figcaption>${e(block.caption)}</figcaption>`:''}</figure>`;
    }
    const tag=block.type==='heading'?'h2':block.type==='quote'?'blockquote':'p';
    return block.text?`<${tag}>${e(block.text)}</${tag}>`:'';
  }).join('');
  const series=(db.series||[]).find(s=>s.id===entry.seriesId&&s.status==='published');
  return `<article class="journal-article">${preview?'<p class="journal-preview-notice">草稿预览 · 仅自己可见</p>':''}<header><a class="journal-back" href="/journal">← 随记</a><h1>${e(entry.title||'未命名随记')}</h1><p class="journal-meta">${e(db.settings.name||'KosmoYonder')}${entry.publishedAt?' / '+date(entry.publishedAt):''}</p></header><div class="journal-body">${body}</div>${series?`<aside class="journal-related"><span>这段旅途的照片</span><a href="/series/${encodeURIComponent(series.id)}">${e(series.title)} ↗</a></aside>`:''}<footer><a href="/journal">更多随记 →</a></footer></article>`;
}
export function mountJournal(app,{admin,snapshot,save,render,origin}) {
  app.get('/api/admin/journal',admin,(req,res)=>res.json({entries:snapshot().journal||[]}));
  app.post('/api/admin/journal',admin,(req,res)=>{
    const entry={id:randomUUID(),revision:1,updatedAt:new Date().toISOString(),draft:{title:'',excerpt:'',coverWorkId:'',seriesId:'',blocks:[{type:'text',text:''}]},live:null};
    save({...snapshot(),journal:[entry,...(snapshot().journal||[])]});res.status(201).json(entry);
  });
  app.put('/api/admin/journal/:id',admin,(req,res)=>{
    const db=snapshot(),current=(db.journal||[]).find(e=>e.id===req.params.id);
    if(!current)return res.status(404).json({error:'随记不存在'});
    if(req.body.revision!==current.revision)return res.status(409).json({error:'这篇随记已在别处修改。请先复制未保存的内容，再刷新页面。'});
    try{
      const draft=parseJournal(req.body.draft,db),action=req.body.action||'save';
      if(!['save','publish','unpublish'].includes(action))throw Error('操作无效');
      if(action==='publish'&&(!draft.title||!draft.blocks.some(b=>b.text || (b.type==='image'&&journalWork(db,b.workId)))))throw Error('填写标题和正文后再发布');
      if(action==='publish')for(const id of [draft.coverWorkId,...draft.blocks.filter(b=>b.type==='image').map(b=>b.workId)].filter(Boolean))if(!journalWork(db,id))throw Error('文章中有未公开或已移除的照片，请重新选择');
      if(action==='publish'&&draft.seriesId&&!(db.series||[]).some(s=>s.id===draft.seriesId&&s.status==='published'))throw Error('关联的组图尚未公开，请重新选择');
      const updatedAt=new Date().toISOString(),entry={...current,draft,updatedAt,revision:current.revision+1};
      if(action==='publish')entry.live={...structuredClone(draft),publishedAt:current.live?.publishedAt||updatedAt,updatedAt};
      if(action==='unpublish')entry.live=null;
      save({...db,journal:db.journal.map(e=>e.id===entry.id?entry:e)});res.json(entry);
    }catch(error){res.status(400).json({error:error.message});}
  });
  app.get('/admin/journal/:id/preview',admin,(req,res)=>{
    const db=snapshot(),entry=(db.journal||[]).find(e=>e.id===req.params.id);
    res.set({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'});
    if(!entry)return res.sendStatus(404);
    res.type('html').send(render('entry',db.settings,undefined,undefined,{db,entry:{id:entry.id,...entry.draft},preview:true,origin:origin(req)}));
  });
  app.get('/journal',(req,res)=>{const db=snapshot(),page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1));res.type('html').send(render('journal',db.settings,undefined,undefined,{db,origin:origin(req),journalPage:page}));});
  app.get('/journal/:id',(req,res)=>{
    const db=snapshot(),entry=journalEntries(db).find(e=>e.id===req.params.id);
    if(!entry)return res.status(404).type('html').send(render('notfound',db.settings));
    res.set('Cache-Control','no-store').type('html').send(render('entry',db.settings,undefined,undefined,{db,entry,origin:origin(req)}));
  });
}
