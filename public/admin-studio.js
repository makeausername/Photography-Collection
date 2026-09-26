import { mountHeroEditor, heroDirty } from './admin-hero.js';
const $ = selector => document.querySelector(selector);
const node = (tag, text, cls) => { const e=document.createElement(tag); if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e; };
let context, initialized=false, seriesId='', dirty=false, busy=false, seriesOrder=[];
export const studioDirty = () => dirty || busy || heroDirty();
const option=(value,label)=>{const e=node('option',label);e.value=value;return e;};
const published=work=>work.status!=='draft';
const selected = kind => {
  const {portfolio}=context, key=kind==='photo'?'featuredPhotos':'featuredPanoramas';
  return (portfolio.settings[key] || portfolio.works.filter(w=>published(w)&&w.kind===kind).slice(0,kind==='photo'?6:3).map(w=>w.id)).filter(id=>portfolio.works.some(w=>w.id===id&&published(w)));
};
async function saveFeatured(kind, ids){if(busy)return;busy=true;try{const body={featuredPhotos:selected('photo'),featuredPanoramas:selected('panorama')};body[kind==='photo'?'featuredPhotos':'featuredPanoramas']=ids;await context.api('/api/featured',context.json('PUT',body));await context.refresh();context.toast('首页精选已更新');}catch(error){context.toast(error.message);}finally{busy=false;}}
function renderFeatured(kind){
  const ids=selected(kind),container=$(kind==='photo'?'#featured-photos':'#featured-panoramas');
  container.replaceChildren(...ids.map((id,index)=>{
    const work=context.portfolio.works.find(w=>w.id===id),row=node('div',undefined,'featured-row'),img=node('img');img.src=work.preview;img.alt='';row.append(img,node('span',`${index+1}. ${work.title}`));
    for(const [label,step]of [['上移',-1],['下移',1],['移除',0]]){const b=node('button',label,'quiet');b.type='button';b.disabled=step!==0&&(index+step<0||index+step>=ids.length);b.setAttribute('aria-label',label+' '+work.title);b.onclick=()=>{const next=[...ids];if(!step)next.splice(index,1);else[next[index],next[index+step]]=[next[index+step],next[index]];saveFeatured(kind,next);};row.append(b);}return row;
  }));
  if(!ids.length)container.append(node('p','还没有选择作品。','field-help'));
  const select=$('#choose-featured-'+kind);select.replaceChildren(option('','选择已发布作品'),...context.portfolio.works.filter(w=>published(w)&&w.kind===kind&&!ids.includes(w.id)).map(w=>option(w.id,w.title)));
  $('#add-featured-'+kind).disabled=ids.length>=(kind==='photo'?6:3);
}
function editSeries(item){
  if(dirty&&!confirm('放弃未保存的系列修改？'))return;
  seriesId=item?.id||'';dirty=false;const form=$('#series-form');form.reset();$('#series-form-title').textContent=item?'编辑系列':'新建系列';
  $('#series-cover').replaceChildren(option('','使用第一幅作品'),...context.portfolio.works.filter(w=>w.seriesId===seriesId&&published(w)).map(w=>option(w.id,w.title)));
  for(const key of ['title','description','status','coverWorkId'])if(item?.[key])form.elements[key].value=item[key];$('#series-message').textContent='';
  const members=context.portfolio.works.filter(work=>work.seriesId===seriesId);
  seriesOrder=[...new Set([...(item?.workOrder || []).filter(id=>members.some(work=>work.id===id)),...members.map(work=>work.id)])];renderSeriesOrder();
}
function renderSeriesOrder(){
  const target=$('#series-order-list');target.replaceChildren();
  if(!seriesId){target.append(node('p','保存系列后，把作品加入这里即可排序。','field-help'));return;}
  for(const [index,id] of seriesOrder.entries()){
    const work=context.portfolio.works.find(work=>work.id===id);if(!work)continue;
    const row=node('div',undefined,'series-order-row'),img=node('img');img.src=work.preview;img.alt='';img.loading='lazy';
    row.append(img,node('span',`${index+1}. ${work.title}${work.status==='draft'?' · 未发布':''}`));
    for(const [label,step] of [['上移',-1],['下移',1]]){const b=node('button',label,'quiet');b.type='button';b.disabled=index+step<0||index+step>=seriesOrder.length;b.setAttribute('aria-label',label+'系列作品 '+work.title);b.onclick=()=>{[seriesOrder[index],seriesOrder[index+step]]=[seriesOrder[index+step],seriesOrder[index]];dirty=true;renderSeriesOrder();};row.append(b);}
    target.append(row);
  }
  if(!seriesOrder.length)target.append(node('p','这个系列还没有作品。','field-help'));
}
function renderSeries(){
  $('#series-list').replaceChildren(...(context.portfolio.series||[]).map(item=>{const card=node('article',undefined,'series-admin-card');const count=context.portfolio.works.filter(w=>w.seriesId===item.id).length;card.append(node('h3',item.title),node('p',`${count} 幅作品 · ${item.status==='published'?'公开':'暂不公开'}`,'field-help'));const b=node('button','编辑系列','secondary');b.onclick=()=>editSeries(item);card.append(b);return card;}));
  if(!$('#series-list').children.length)$('#series-list').append(node('p','先创建系列，再把作品加入其中。','field-help'));
  for(const id of ['edit-series','upload-series','batch-series']){const select=$('#'+id),value=select.value;select.replaceChildren(option('','不加入系列'),...(context.portfolio.series||[]).map(item=>option(item.id,item.title)));select.value=value;}
}
const bytes = value => value===null?'暂不可用':value<1024*1024?(value/1024).toFixed(1)+' KB':value<1024**3?(value/1024**2).toFixed(1)+' MB':(value/1024**3).toFixed(2)+' GB';
async function storage(){
  const target=$('#storage-summary');target.replaceChildren(node('p','正在读取…'));
  try{
    const info=await context.api('/api/admin/storage');
    $('#storage-mode').textContent=`作品资料：SQLite · 图片：${info.provider==='oss'?'阿里云 OSS':'本地存储'}${info.cdn?' · CDN 已配置':''}`;
    $('#retry-storage-cleanup').hidden=!info.pendingDeletes;
    target.replaceChildren(...[['本地作品图片',info.sourceBytes],['本地缩略图',info.previewBytes],['本地展示缓存',info.cacheBytes],['磁盘剩余',info.freeBytes],...(info.provider==='oss'?[['OSS 作品文件',info.remoteBytes]]:[])].map(([label,value])=>{const card=node('div',undefined,'storage-card');card.append(node('span',label),node('strong',bytes(value)));return card;}));
    target.append(node('p','本地展示缓存上限 512 MiB；闲置 7 天后自动清理。','field-help'));
    if(info.provider==='oss')target.append(node('p',`${info.bucket} · ${info.region}。这里只统计本站登记的作品文件，云端展示缓存和实际费用请在阿里云查看。`,'field-help'));
    if(info.pendingDeletes)target.append(node('p',`有 ${info.pendingDeletes} 个已删除作品的文件等待清理。`,'field-help'));
  }catch(error){target.replaceChildren(node('p',error.message));}
}
export function mountStudio(value){
  context=value;mountHeroEditor(value);renderFeatured('photo');renderFeatured('panorama');renderSeries();
  $('#profile-preview').hidden=!context.portfolio.settings.profilePhoto;if(context.portfolio.settings.profilePhoto)$('#profile-preview').src='/profile.webp';
  if(initialized)return;initialized=true;
  for(const kind of ['photo','panorama'])$('#add-featured-'+kind).onclick=()=>{const id=$('#choose-featured-'+kind).value;if(id)saveFeatured(kind,[...selected(kind),id]);};
  $('#series-form').oninput=()=>{dirty=true;};$('#new-series').onclick=()=>editSeries();
  $('#series-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;const button=$('#series-form button.primary');button.disabled=true;try{const body=Object.fromEntries(new FormData(event.target));if(seriesId)body.workOrder=seriesOrder;const saved=await context.api('/api/series'+(seriesId?'/'+seriesId:''),context.json(seriesId?'PUT':'POST',body));dirty=false;seriesId=saved.id;await context.refresh();editSeries(saved);$('#series-message').textContent='已保存。';}catch(error){$('#series-message').textContent=error.message;}finally{busy=false;button.disabled=false;}};
  $('[data-tab="storage-panel"]').addEventListener('click',storage);$('#refresh-storage').onclick=storage;
  for(const [id,route,message] of [['check-storage','check','连接正常，文件读写与清理检查通过。'],['retry-storage-cleanup','retry-deletes','待清理文件已处理。']]){
    $('#'+id).onclick=async()=>{const button=$('#'+id);button.disabled=true;$('#storage-message').textContent='正在检查…';try{const result=await context.api('/api/admin/storage/'+route,context.json('POST',{}));$('#storage-message').textContent=result.provider==='local'?'本地存储已启用。':message;await storage();}catch(error){$('#storage-message').textContent=error.message;}finally{button.disabled=false;}};
  }

  $('#profile-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;const button=$('#profile-form button');button.disabled=true;try{await context.api('/api/profile-photo',{method:'POST',body:new FormData(event.target)});$('#profile-message').textContent='照片已更新。';event.target.reset();await context.refresh();}catch(error){$('#profile-message').textContent=error.message;}finally{busy=false;button.disabled=false;}};
}
