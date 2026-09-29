import { mountLifecycle, lifecycleDirty, beginReplacement, replacementBusy, replacementDirty } from './admin-lifecycle.js';
import { mountInsights } from './admin-insights.js';
import { mountJournalEditor, journalDirty } from './admin-journal.js';
import { mountStudio, studioDirty } from './admin-studio.js';
import { orderedCategories } from './categories.js';

const $ = s => document.querySelector(s);
const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
let state, portfolio, editingId, deletingId, saving = false;
let pageNumber = 1, settingsDirty = false, editDirty = false, batchDirty = false, uploading = false;
const PAGE_SIZE = 24, selectedIds = new Set();
let queue = [];
const statusOf = work => work.status || 'published';
async function api(url, options = {}) {
  const response = await fetch(url, options);
  let value; try { value = await response.json(); } catch { throw Error('服务器暂时无法响应，请稍后重试'); }
  if (!response.ok) { if (response.status === 401 && !url.endsWith('/login')) { $('#dashboard').hidden = true; $('#login-screen').hidden = false; } throw Error(value.error || '操作失败，请重试'); }
  return value;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; setTimeout(() => $('#toast').hidden = true, 3500); }
function message(target, text, ok = false) { target.textContent = text; target.classList.toggle('success', ok); }
async function init() {
  try {
    state = await api('/api/session');
    if (state.authenticated) return dashboard();
    $('#login-screen').hidden = false;
    if (state.setupRequired) {
      $('#login-title').textContent = '创建管理员密码'; $('#login-button').textContent = '设置密码并进入';
      $('#login-note').textContent = state.canSetup ? '这是第一次使用。设置一个至少 12 个字符的密码，之后只有你能管理作品。' : '请在服务器本机访问后台完成首次设置，或配置 ADMIN_PASSWORD 后重启。';
      $('#login-password').minLength = 12; $('#login-password').autocomplete = 'new-password'; $('#login-button').disabled = !state.canSetup;
    }
  } catch (e) { message($('#login-message'), e.message); }
}
$('#login-form').onsubmit = async event => {
  event.preventDefault(); const button = $('#login-button'); button.disabled = true;
  try { await api(state.setupRequired ? '/api/setup' : '/api/login', json('POST', { password: $('#login-password').value })); $('#login-form').reset(); await dashboard(); }
  catch (e) { message($('#login-message'), e.message); } finally { button.disabled = false; }
};

function option(value, label) { const node = make('option', '', label); node.value = value; return node; }
function categories(selector, firstLabel, firstValue = '') {
  const target = $(selector), current = target.value;
  target.replaceChildren(option(firstValue, firstLabel), ...orderedCategories(portfolio.works).map(c => option(c, c)));
  if ([...target.options].some(o => o.value === current)) target.value = current;
}
async function dashboard() {
  portfolio = await api('/api/admin/portfolio');
  $('#admin-studio-name').textContent = portfolio.settings.name; document.title = '作品管理 · ' + portfolio.settings.name; $('#login-screen').hidden = true; $('#dashboard').hidden = false;
  const coverValue = settingsDirty ? $('#cover-work').value : portfolio.settings.coverWorkId || '';
  $('#cover-work').replaceChildren(option('', '自动使用排序最前的已发布照片'), ...portfolio.works.filter(w => w.kind === 'photo').map(w => option(w.id, [w.title, w.location, statusOf(w) === 'draft' ? '未发布' : ''].filter(Boolean).join(' / '))));
  $('#cover-work').value = coverValue;
  const shareValue=settingsDirty?$('#share-cover-work').value:portfolio.settings.shareCoverWorkId || '';
  $('#share-cover-work').replaceChildren(option('','跟随首页封面'),...portfolio.works.filter(w=>statusOf(w)==='published').map(w=>option(w.id,w.title)));$('#share-cover-work').value=shareValue;
  if (!settingsDirty) {
    $('#settings-form').reset();
    for (const [key, value] of Object.entries(portfolio.settings)) if ($('#settings-form').elements[key]) $('#settings-form').elements[key].value = value;
  }
  categories('#filter-category', '全部题材'); categories('#work-category', '请选择题材'); categories('#upload-category', '请选择题材'); categories('#batch-category', '请选择题材');
  for (const id of selectedIds) if (!portfolio.works.some(w => w.id === id)) selectedIds.delete(id);
  renderWorks();
  mountInsights({api});
  mountJournalEditor({portfolio,api,json,toast});
  mountStudio({portfolio,api,json,refresh:dashboard,toast});
  mountLifecycle({portfolio,api,json,refresh:dashboard,toast,editDirty:()=>editDirty,onReplaced:work=>{$('#edit-preview').src=work.preview;$('#edit-credit').textContent='';}});
}
function filteredWorks() {
  const query = $('#work-search').value.trim().toLocaleLowerCase();
  return portfolio.works.filter(w => (!query || [w.title,w.location].join(' ').toLocaleLowerCase().includes(query)) && (!$('#filter-kind').value || w.kind === $('#filter-kind').value) && (!$('#filter-category').value || w.category === $('#filter-category').value) && (!$('#filter-status').value || statusOf(w) === $('#filter-status').value));
}
function currentWorks() { return filteredWorks().slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE); }
function selectionState() {
  $('#selection-count').textContent = selectedIds.size ? '已选择 ' + selectedIds.size + ' 幅（含其它页）' : '未选择作品';
  $('#batch-edit').disabled = $('#clear-selection').disabled = !selectedIds.size;
  const visible = currentWorks(), count = visible.filter(w => selectedIds.has(w.id)).length;
  $('#select-page').checked = !!visible.length && count === visible.length;
  $('#select-page').indeterminate = count > 0 && count < visible.length;
  $('#select-page').disabled = !visible.length;
}
function renderWorks() {
  const photos = portfolio.works.filter(w => w.kind === 'photo').length, drafts = portfolio.works.filter(w => statusOf(w) === 'draft').length;
  $('#work-count').textContent = photos + ' 幅照片 · ' + (portfolio.works.length - photos) + ' 幅全景 · ' + drafts + ' 幅未发布';
  $('#admin-demo-note').hidden = !portfolio.works.some(w => w.demo);
  const filtered = filteredWorks(), pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); pageNumber = Math.min(pageNumber, pages);
  $('#filter-result').textContent = '共 ' + filtered.length + ' 幅 · 每页 ' + PAGE_SIZE + ' 幅';
  $('#page-info').textContent = '第 ' + pageNumber + ' / ' + pages + ' 页';
  $('#previous-page').disabled = pageNumber === 1; $('#next-page').disabled = pageNumber === pages;
  $('#admin-works').replaceChildren(...currentWorks().map(work => {
    const card = make('article', 'admin-card'), frame = make('div','admin-card-frame'), img = make('img'); img.src = work.preview; img.alt = work.title; img.loading = 'lazy';
    const checkLabel = make('label','card-select'), check = make('input'); check.type = 'checkbox'; check.checked = selectedIds.has(work.id); check.setAttribute('aria-label','选择作品：' + work.title);
    check.onchange = () => { if (check.checked && selectedIds.size >= 200) { check.checked = false; toast('每次最多选择 200 幅'); return; } check.checked ? selectedIds.add(work.id) : selectedIds.delete(work.id); card.classList.toggle('selected',check.checked); selectionState(); };
    checkLabel.append(check); frame.append(img, checkLabel, make('span', 'status-badge ' + statusOf(work), statusOf(work) === 'draft' ? '未发布' : '已发布')); card.classList.toggle('selected',check.checked);
    const body = make('div','admin-card-body'); body.append(make('span','tag',(work.kind === 'panorama' ? '360° 全景 · ' : '') + work.category),make('h3','',work.title),make('p','',[work.location,work.year].filter(Boolean).join(' / ') || '未填写地点和时间'));
    const actions = make('div','admin-card-actions');
    const add = (label, action, cls = '') => { const b = make('button',cls,label); b.type='button'; b.onclick = async () => { b.disabled=true; try { await action(); } catch(e) { toast(e.message); } finally { b.disabled=false; } }; actions.append(b); };
    add('编辑', () => edit(work));
    add(statusOf(work) === 'draft' ? '发布' : '隐藏', async () => { await api('/api/works/batch',json('PATCH',{ids:[work.id],changes:{status:statusOf(work)==='draft'?'published':'draft'}})); await dashboard(); toast(statusOf(work)==='draft'?'作品已发布':'作品已隐藏'); });
    add('移至最前', async () => { await api('/api/works/' + work.id + '/first',json('POST',{})); await dashboard(); toast('顺序已更新'); });
    add('删除', () => { deletingId=work.id; $('#delete-description').textContent=work.title; message($('#delete-message'),''); $('#delete-dialog').showModal(); },'delete-action');
    body.append(actions); card.append(frame,body); return card;
  }));
  if (!filtered.length) $('#admin-works').append(make('p','empty-state',portfolio.works.length ? '没有符合条件的作品，试试其它关键词或筛选。' : '从上传第一组作品开始。'));
  selectionState();
}
for (const id of ['work-search','filter-kind','filter-category','filter-status']) $('#' + id).addEventListener(id === 'work-search' ? 'input' : 'change', () => { pageNumber=1; selectedIds.clear(); renderWorks(); });
$('#select-page').onchange = () => { const checked=$('#select-page').checked; const works=currentWorks(); if (checked && new Set([...selectedIds,...works.map(w=>w.id)]).size > 200) { toast('每次最多选择 200 幅'); selectionState(); return; } for(const w of works) checked ? selectedIds.add(w.id) : selectedIds.delete(w.id); renderWorks(); };
$('#clear-selection').onclick=()=>{selectedIds.clear();renderWorks();};
for(const [id,step] of [['previous-page',-1],['next-page',1]]) $('#' + id).onclick=()=>{pageNumber+=step;renderWorks();$('.library-filters').scrollIntoView({block:'start'});};
for (const button of document.querySelectorAll('[data-tab]')) button.onclick=()=>{for(const item of document.querySelectorAll('[data-tab]')) item.classList.toggle('active',item===button);for(const panel of document.querySelectorAll('.admin-panel')) panel.hidden=panel.id!==button.dataset.tab;};
function hasUnsaved() { return journalDirty() || lifecycleDirty() || studioDirty() || settingsDirty || editDirty || batchDirty || uploading || queue.some(i=>i.state!=='done'); }
window.addEventListener('beforeunload',e=>{if(hasUnsaved()){e.preventDefault();e.returnValue='';}});
$('#logout').onclick=async()=>{if(hasUnsaved()&&!confirm('还有未保存的修改或未完成的上传，确定退出？'))return;try{await api('/api/logout',json('POST',{}));settingsDirty=editDirty=batchDirty=false;queue=[];location.reload();}catch(e){toast(e.message);}};
function edit(work) {
  editingId=work.id;beginReplacement(work.id);editDirty=false;$('#work-form').reset();$('#edit-preview').src=work.preview;$('#edit-preview').alt=work.title;
  for(const key of ['title','category','location','year','description','seriesId','vcgLicenseUrl','tuchongLicenseUrl','panoramaMode']) $('#work-form').elements[key].value=work[key]||(key==='panoramaMode'?'auto':'');
  $('#panorama-mode-field').hidden=$('#panorama-mode-help').hidden=work.kind!=='panorama';
  $('#work-form .extra-fields summary').textContent=work.kind==='panorama'?'图片授权与全景设置':'图片授权';
  $('#work-form').elements.status.value=statusOf(work);$('#edit-credit').textContent=work.demo?'示例图片 · '+(work.credit||''):'';message($('#work-message'),'');$('#edit-dialog').showModal();
}
$('#work-form').oninput=()=>{editDirty=true;};
function closeEdit() { if(saving || replacementBusy())return;if((editDirty || replacementDirty())&&!confirm('放弃未保存的作品修改？'))return;editDirty=false;beginReplacement(editingId);$('#edit-dialog').close(); }
for(const b of document.querySelectorAll('.close-edit')) b.onclick=closeEdit;
$('#edit-dialog').addEventListener('cancel',e=>{e.preventDefault();closeEdit();});
$('#work-form').onsubmit=async e=>{e.preventDefault();saving=true;$('#save-work').disabled=true;try{await api('/api/works/'+editingId,json('PUT',Object.fromEntries(new FormData($('#work-form')))));editDirty=false;if(!replacementDirty())$('#edit-dialog').close();await dashboard();toast(replacementDirty()?'作品信息已保存，可以继续替换图片':'作品已更新');}catch(e){message($('#work-message'),e.message);}finally{saving=false;$('#save-work').disabled=false;}};
$('#cancel-delete').onclick=()=>$('#delete-dialog').close();
$('#confirm-delete').onclick=async()=>{const b=$('#confirm-delete');b.disabled=true;try{await api('/api/works/'+deletingId,{method:'DELETE'});$('#delete-dialog').close();await dashboard();toast('作品已移入回收站');}catch(e){message($('#delete-message'),e.message);}finally{b.disabled=false;}};
$('#batch-edit').onclick=()=>{batchDirty=false;$('#batch-form').reset();for(const key of ['category','location','status','seriesId']) $('#batch-form').elements[key].disabled=true;$('#batch-title').textContent='批量编辑 '+selectedIds.size+' 幅作品';message($('#batch-message'),'');$('#batch-dialog').showModal();};
for(const [check,key] of [['changeCategory','category'],['changeLocation','location'],['changeStatus','status'],['changeSeries','seriesId']]) $('#batch-form').elements[check].onchange=()=>{$('#batch-form').elements[key].disabled=!$('#batch-form').elements[check].checked;};
$('#batch-form').oninput=()=>{batchDirty=true;};
function closeBatch(){if(saving)return;if(batchDirty&&!confirm('放弃未应用的批量修改？'))return;batchDirty=false;$('#batch-dialog').close();}
for(const b of document.querySelectorAll('.close-batch')) b.onclick=closeBatch;
$('#batch-dialog').addEventListener('cancel',e=>{e.preventDefault();closeBatch();});
$('#batch-form').onsubmit=async e=>{e.preventDefault();const form=$('#batch-form'),changes={};for(const [check,key] of [['changeCategory','category'],['changeLocation','location'],['changeStatus','status'],['changeSeries','seriesId']])if(form.elements[check].checked)changes[key]=form.elements[key].value;if(!Object.keys(changes).length){message($('#batch-message'),'请勾选至少一个需要修改的字段');return;}saving=true;$('#save-batch').disabled=true;try{await api('/api/works/batch',json('PATCH',{ids:[...selectedIds],changes}));batchDirty=false;$('#batch-dialog').close();selectedIds.clear();await dashboard();toast('所选作品已更新');}catch(e){message($('#batch-message'),e.message);}finally{saving=false;$('#save-batch').disabled=false;}};
$('#settings-form').oninput=()=>{settingsDirty=true;$('#settings-dirty').textContent='有未保存的修改';};
$('#settings-form').onsubmit=async e=>{e.preventDefault();const b=$('#settings-form button');b.disabled=true;try{await api('/api/settings',json('PUT',Object.fromEntries(new FormData($('#settings-form')))));settingsDirty=false;$('#settings-dirty').textContent='设置已保存';message($('#settings-message'),'已保存。',true);}catch(e){message($('#settings-message'),e.message);}finally{b.disabled=false;}};
function clearQueue() { for(const item of queue) URL.revokeObjectURL(item.url);queue=[]; }
$('#new-work').onclick=()=>{clearQueue();$('#upload-form').reset();$('#upload-options').disabled=false;$('#pano-upload-help').hidden=true;message($('#upload-message'),'');renderQueue();$('#upload-dialog').showModal();};
function chooseFiles(files){if(uploading)return;if(queue.some(i=>i.state==='done')){toast('请关闭当前上传后再添加新一批照片');return;}clearQueue();queue=Array.from(files).slice(0,100).map(file=>({file,id:crypto.randomUUID(),url:URL.createObjectURL(file),title:file.name.replace(/\.[^.]+$/,'').slice(0,80),state:'pending',percent:0,error:''}));message($('#upload-message'),files.length>100?'每批最多 100 张，已选取前 100 张。':'');renderQueue();}
$('#photo-input').onchange=()=>chooseFiles($('#photo-input').files);
$('#upload-zone').ondragover=e=>{e.preventDefault();};$('#upload-zone').ondrop=e=>{e.preventDefault();chooseFiles(e.dataTransfer.files);};
$('#work-kind').onchange=()=>{$('#pano-upload-help').hidden=$('#work-kind').value!=='panorama';};
function renderQueue(){
  $('#upload-queue').replaceChildren(...queue.map(item=>{
    const row=make('div','upload-row'),img=make('img');img.src=item.url;img.alt='';
    const content=make('div','upload-row-content'),title=make('input');title.value=item.title;title.maxLength=80;title.required=true;title.disabled=uploading||item.state==='done';title.setAttribute('aria-label','作品标题：'+item.file.name);title.oninput=()=>{item.title=title.value;};
    const progress=make('progress');progress.max=100;progress.value=item.percent;progress.setAttribute('aria-label',item.file.name+' 上传进度');item.progress=progress;
    const status=make('span','upload-item-status');item.statusNode=status;
    content.append(title,progress,status);row.append(img,content);
    if(item.state==='error' && item.duplicate){const keep=make('button','secondary','仍要另存一份');keep.type='button';keep.disabled=uploading;keep.onclick=()=>{item.allowDuplicate=true;if($('#upload-form').reportValidity())runUploads([item]);};const skip=make('button','quiet','跳过');skip.type='button';skip.disabled=uploading;skip.onclick=()=>{queue=queue.filter(other=>other!==item);URL.revokeObjectURL(item.url);renderQueue();};row.append(keep,skip);}else if(item.state==='error'){const retry=make('button','secondary','重试');retry.type='button';retry.disabled=uploading;retry.onclick=()=>{if($('#upload-form').reportValidity())runUploads([item]);};row.append(retry);}
    updateItem(item);return row;
  }));$('#start-upload').disabled=uploading||!queue.some(i=>i.state!=='done');$('#start-upload').textContent=uploading?'正在上传…':queue.some(i=>i.state==='error')?'重试失败的照片':'开始上传';
}
function updateItem(item){item.progress.value=item.percent;item.statusNode.textContent=item.state==='done'?'已完成':item.state==='error'?item.error:item.state==='uploading'?(item.percent===100?'正在处理图片…':'上传中 '+item.percent+'%'):'等待上传 · '+item.file.name;item.statusNode.classList.toggle('upload-error',item.state==='error');}
function uploadOne(item){return new Promise((resolve,reject)=>{const form=new FormData();form.set('photo',item.file);form.set('title',item.title);form.set('uploadId',item.id);if(item.allowDuplicate)form.set('allowDuplicate','true');for(const [key,value]of Object.entries(item.fields))form.set(key,value);const xhr=new XMLHttpRequest();xhr.open('POST','/api/works');xhr.timeout=180000;xhr.upload.onprogress=e=>{if(e.lengthComputable){item.percent=Math.round(e.loaded/e.total*100);updateItem(item);}};xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText);}catch{reject(Error('服务器返回异常，请重试'));return;}if(result.duplicate)item.duplicate=result.duplicate;xhr.status>=200&&xhr.status<300?resolve(result):reject(Error(result.error||'上传失败'));};xhr.onerror=()=>reject(Error('连接中断，可单独重试'));xhr.ontimeout=()=>reject(Error('处理超时，请稍后重试'));xhr.send(form);});}
async function runUploads(items){
  if(uploading)return;const fields=Object.fromEntries(new FormData($('#upload-form')));delete fields.photo;
  uploading=true;$('#upload-options').disabled=true;for(const b of document.querySelectorAll('.close-upload'))b.disabled=true;renderQueue();
  for(const item of items){
    item.fields = fields;item.state='uploading';item.percent=0;updateItem(item);
    try{if(item.file.size>64*1024*1024)throw Error('超过 64 MB，请压缩后重新选择');if(!item.title.trim())throw Error('请填写作品标题');await uploadOne(item);item.state='done';item.percent=100;}catch(e){item.state='error';item.error=e.message;}updateItem(item);
  }
  uploading=false;$('#upload-options').disabled=false;for(const b of document.querySelectorAll('.close-upload'))b.disabled=false;renderQueue();
  const done=queue.filter(i=>i.state==='done').length;message($('#upload-message'),'已完成 '+done+' / '+queue.length+' 幅'+(done<queue.length?'，失败项可单独重试。':'。可关闭窗口继续整理。'),done===queue.length);
  try{await dashboard();}catch(e){message($('#upload-message'),'上传已处理，但列表刷新失败：'+e.message);}
}
$('#upload-form').onsubmit=e=>{e.preventDefault();runUploads(queue.filter(i=>i.state!=='done'));};
function closeUpload(){if(uploading)return;if(queue.some(i=>i.state!=='done')&&!confirm('还有未完成的上传，确定关闭？已完成的作品会保留。'))return;clearQueue();$('#upload-dialog').close();}
for(const b of document.querySelectorAll('.close-upload'))b.onclick=closeUpload;
$('#upload-dialog').addEventListener('cancel',e=>{e.preventDefault();closeUpload();});
$('#password-form').onsubmit = async event => {
  event.preventDefault(); const form = Object.fromEntries(new FormData($('#password-form'))), button = $('#password-form button'); button.disabled = true;
  try { if (form.password !== form.confirm) throw Error('两次输入的新密码不一致'); await api('/api/password', json('POST', form)); $('#password-form').reset(); message($('#password-message'), '密码已更新。', true); }
  catch (e) { message($('#password-message'), e.message); } finally { button.disabled = false; }
};
init();
