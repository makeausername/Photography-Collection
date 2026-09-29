const $=selector=>document.querySelector(selector);
const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;};
let context,initialized=false,backupDirty=false,busy=false,replacing=false,replacementId='',previewURL='',poll;
export const lifecycleDirty=()=>backupDirty || busy || replacing || !!$('#replace-image-form')?.elements.photo.files.length;
export const replacementBusy=()=>replacing;
export const replacementDirty=()=>!!$('#replace-image-form')?.elements.photo.files.length;
export function beginReplacement(id){
  replacementId=id;$('#replace-image-form').reset();$('#replace-image-message').textContent='';$('#replace-image-preview').hidden=true;
  $('.replace-image-box').open=false;if(previewURL)URL.revokeObjectURL(previewURL);previewURL='';
}
const date=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'暂无';
function renderTrash(){
  const target=$('#trash-list');target.replaceChildren();
  for(const work of context.portfolio.trash || []){
    const row=node('article',undefined,'trash-row'),img=node('img');img.src=work.preview;img.alt='';img.loading='lazy';
    const description=node('div'),days=Math.max(0,Math.ceil((Date.parse(work.deletedAt)+30*86400000-Date.now())/86400000));
    description.append(node('h3',work.title),node('p',`${work.status==='draft'?'未发布':'原为已发布'} · ${days?days+' 天后清理':'等待清理'}`,'field-help'));
    const actions=node('div',undefined,'storage-actions');
    for(const permanent of [false,true]){const b=node('button',permanent?'彻底删除':'恢复',permanent?'danger':'secondary');b.disabled=busy;b.onclick=()=>trashAction(work,permanent);actions.append(b);}
    row.append(img,description,actions);target.append(row);
  }
  if(!target.children.length)target.append(node('p','回收站是空的。','empty-library'));
}
async function trashAction(work,permanent){
  if(busy)return;if(permanent&&!confirm(`彻底删除「${work.title}」？图片和资料将无法恢复。`))return;
  busy=true;renderTrash();$('#trash-message').textContent='正在处理…';
  try{const result=await context.api('/api/admin/trash/'+work.id+(permanent?'':'/restore'),context.json(permanent?'DELETE':'POST',permanent?{confirm:true}:{}));await context.refresh();$('#trash-message').textContent=result.cleanupPending?'已移除，云端文件将稍后重试清理。':permanent?'已彻底删除。':'作品已恢复。';}
  catch(error){$('#trash-message').textContent=error.message;}finally{busy=false;renderTrash();}
}
function renderBackups(state){
  if(!state.running && $('#auto-backup-message').textContent.startsWith('正在备份'))$('#auto-backup-message').textContent=state.lastError || '备份已完成。';
  const form=$('#auto-backup-form');if(!backupDirty){form.elements.enabled.value=state.settings.enabled?'on':'off';form.elements.hour.value=state.settings.hour;form.elements.keep.value=state.settings.keep;form.elements.mode.value=state.settings.mode||'portable';form.elements.keepLocal.value=state.settings.keepLocal??state.settings.keep;form.elements.keepLocal.max=state.settings.keep;}
  for(const control of form.elements)control.disabled=state.running;
  $('#run-auto-backup').disabled=state.running;$('#run-auto-backup').textContent=state.running?'备份进行中…':'立即备份';
  $('#backup-destination').textContent='本地：'+state.destination+(state.offsite?' · 异地：'+state.offsite.bucket:' · 尚未配置异地备份');
  $('#auto-backup-status').replaceChildren(node('p','最近完成：'+date(state.lastSuccess)),node('p',state.settings.enabled?'下次备份：'+date(state.nextRun)+'（北京时间）':'自动备份已关闭，可随时手动备份。'));
  $('#backup-warning').hidden=!state.lastError;$('#backup-warning').textContent=state.lastError || '';
  if(state.lastError)$('#auto-backup-status').append(node('p',state.lastError,'form-message'));
  const history=$('#backup-history');history.replaceChildren();
  for(const item of state.records){const row=node('div',undefined,'backup-history-row'),link=node('a','下载备份 ↓','text-link');link.href='/api/admin/backups/'+encodeURIComponent(item.name)+'/download';row.append(node('span',date(item.createdAt)),node('span',(item.bytes/1048576).toFixed(1)+' MB','field-help'),link);const checksum=node('details'),summary=node('summary','校验与恢复');checksum.append(summary,node('code',item.sha256),node('p',item.mode==='references'?'轻量备份：需要保留云端图片。':'完整备份：包含图片，可独立恢复。','field-help'));row.append(checksum);history.append(row);}
  if(!state.records.length)history.append(node('p','还没有备份记录。','field-help'));
  clearTimeout(poll);if(state.running&&!document.hidden&&!$('#storage-panel').hidden)poll=setTimeout(loadBackups,2000);
}
async function loadBackups(){try{renderBackups(await context.api('/api/admin/backups'));}catch(error){$('#auto-backup-message').textContent=error.message;}}
export function mountLifecycle(next){
  context=next;if($('#trash-dialog').open)renderTrash();if(initialized)return;initialized=true;
  const alert=node('p','','admin-alert');alert.id='backup-warning';alert.hidden=true;$('#dashboard').prepend(alert);
  const form=$('#auto-backup-form');
  const modeLabel=node('label','备份内容'),mode=node('select');mode.name='mode';for(const [v,t]of [['portable','完整备份 · 包含全部图片'],['references','轻量备份 · 仅资料和云端图片引用']]){const o=node('option',t);o.value=v;mode.append(o);}modeLabel.append(mode);
  const keepLabel=node('label','其中在本地保留'),keep=node('input');keep.name='keepLocal';keep.type='number';keep.min=1;keep.max=30;keep.value=7;keep.required=true;keepLabel.append(keep);
  form.querySelector('button').before(modeLabel,keepLabel,node('p','轻量备份仅适用于全部图片已迁入 OSS 的作品库。系统保留备份引用的图片，过期后再清理；请勿在云控制台手动删除这些文件。','field-help'));
  const guide=node('details',undefined,'backup-guidance');guide.append(node('summary','异地备份与恢复方法'),node('p','在服务器私有配置中填写备份专用 OSS Bucket 与密钥，重启后自动启用同步。同步成功后才清理旧副本。恢复时下载备份、保存校验值，在新目录运行恢复命令。具体步骤见仓库《备份与恢复.md》。'));$('#backup-history').after(guide);
  loadBackups();
  $('#open-trash').onclick=async()=>{$('#trash-message').textContent='';try{const result=await context.api('/api/admin/trash');context.portfolio.trash=result.works;renderTrash();$('#trash-dialog').showModal();}catch(error){context.toast(error.message);}};
  $('#close-trash').onclick=()=>{if(!busy)$('#trash-dialog').close();};$('#trash-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('#replace-image-form').elements.photo.onchange=()=>{if(previewURL)URL.revokeObjectURL(previewURL);const file=$('#replace-image-form').elements.photo.files[0];previewURL=file?URL.createObjectURL(file):'';$('#replace-image-preview').hidden=!file;if(file)$('#replace-image-preview').src=previewURL;};
  $('#replace-image-form').onsubmit=async event=>{
    event.preventDefault();if(replacing)return;if(context.editDirty()){$('#replace-image-message').textContent='请先保存作品信息，再替换图片。';return;}
    const body=new FormData(event.target);replacing=true;for(const control of event.target.elements)control.disabled=true;$('#save-work').disabled=true;$('#replace-image-message').textContent='正在处理新图片…';
    try{const result=await context.api('/api/works/'+replacementId+'/image',{method:'POST',body});context.onReplaced(result.work);beginReplacement(replacementId);await context.refresh();context.toast('图片已替换，作品链接保持不变');}
    catch(error){$('#replace-image-message').textContent=error.message;}finally{replacing=false;for(const control of event.target.elements)control.disabled=false;$('#save-work').disabled=false;}
  };
  $('[data-tab="storage-panel"]').addEventListener('click',loadBackups);$('#refresh-backups').onclick=loadBackups;
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#storage-panel').hidden)loadBackups();});
  $('#auto-backup-form').oninput=()=>{backupDirty=true;form.elements.keepLocal.max=Number(form.elements.keep.value)||30;};
  $('#auto-backup-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;const form=event.target,button=form.querySelector('button');button.disabled=true;try{const state=await context.api('/api/admin/backups',context.json('PUT',{enabled:form.elements.enabled.value==='on',hour:Number(form.elements.hour.value),keep:Number(form.elements.keep.value),keepLocal:Number(form.elements.keepLocal.value),mode:form.elements.mode.value}));backupDirty=false;renderBackups(state);$('#auto-backup-message').textContent='备份计划已保存。';}catch(error){$('#auto-backup-message').textContent=error.message;}finally{busy=false;button.disabled=false;}};
  $('#run-auto-backup').onclick=async()=>{const b=$('#run-auto-backup');b.disabled=true;try{await context.api('/api/admin/backups/run',context.json('POST',{}));$('#auto-backup-message').textContent='正在备份，期间请稍候再修改作品。';await loadBackups();}catch(error){$('#auto-backup-message').textContent=error.message;b.disabled=false;}};
}
