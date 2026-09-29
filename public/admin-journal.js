const $=selector=>document.querySelector(selector);
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let context,mounted=false,entries=[],current=null,blocks=[],dirty=false,busy=false,timer,generation=0,conflict=false;
export const journalDirty=()=>dirty||busy;
const button=(text,fn,cls='secondary')=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
const option=(value,text)=>{const o=node('option',text);o.value=value;return o;};
const tell=text=>{$('#journal-save-status').textContent=text;};
const form=()=>$('#journal-editor');
function draft(){return {title:form().elements.title.value,excerpt:form().elements.excerpt.value,coverWorkId:form().elements.coverWorkId.value,seriesId:form().elements.seriesId.value,blocks:structuredClone(blocks)};}
function changed(){dirty=true;generation++;tell('尚未保存');clearTimeout(timer);if(!conflict)timer=setTimeout(()=>save().catch(()=>{}),1200);}
function renderList(){
  $('#journal-admin-list').replaceChildren(...entries.map(entry=>{
    const b=button('',()=>choose(entry.id).catch(error=>tell(error.message)),'journal-entry-choice');
    b.classList.toggle('active',current?.id===entry.id);b.append(node('strong',entry.draft.title||'未命名随记'),node('span',entry.live?'已发布':'草稿'));return b;
  }));
  if(!entries.length)$('#journal-admin-list').append(node('p','还没有随记。','field-help'));
}
function renderBlocks(){
  $('#journal-blocks').replaceChildren(...blocks.map((block,index)=>{
    const field=node('section',undefined,'journal-edit-block'),top=node('div',undefined,'journal-block-top');
    const label={text:'正文',heading:'小标题',quote:'引用',image:'照片'}[block.type];top.append(node('span',`${index+1} / ${label}`));
    for(const [text,step]of [['上移',-1],['下移',1]]){const b=button(text,()=>{[blocks[index],blocks[index+step]]=[blocks[index+step],blocks[index]];changed();renderBlocks();},'quiet');b.disabled=index+step<0||index+step>=blocks.length;b.setAttribute('aria-label',`${text}第 ${index+1} 段`);top.append(b);}
    top.append(button('移除',()=>{if((block.text||block.workId)&&!confirm('移除这一段？未保存的文字会被清除。'))return;blocks.splice(index,1);changed();renderBlocks();},'quiet'));field.append(top);
    if(block.type==='image'){
      const select=node('select'),img=node('img');select.setAttribute('aria-label',`第 ${index+1} 段照片`);
      const works=context.portfolio.works.filter(w=>w.status!=='draft');select.append(option('','选择作品库照片'),...works.map(w=>option(w.id,w.title)));
      if(block.workId&&!works.some(w=>w.id===block.workId))select.append(option(block.workId,'原照片已隐藏或移除，请重选'));
      select.value=block.workId;img.className='journal-block-image';img.alt='所选照片';
      const update=()=>{img.hidden=!works.some(w=>w.id===block.workId);if(!img.hidden)img.src='/media/'+encodeURIComponent(block.workId)+'/preview.jpg?w=480';};update();
      select.onchange=()=>{block.workId=select.value;update();changed();};
      const caption=node('input');caption.value=block.caption;caption.maxLength=300;caption.placeholder='图注（可不填）';caption.setAttribute('aria-label',`第 ${index+1} 段图注`);caption.oninput=()=>{block.caption=caption.value;changed();};field.append(select,img,caption);
    }else{
      const input=node('textarea');input.value=block.text;input.rows=block.type==='heading'?2:6;input.maxLength=15000;input.setAttribute('aria-label',`第 ${index+1} 段${label}`);input.placeholder=block.type==='text'?'从这里开始写。':label;
      input.oninput=()=>{block.text=input.value;changed();};field.append(input);
    }
    return field;
  }));
}
function fill(entry){
  current=entry;dirty=false;conflict=false;generation++;form().hidden=false;
  $('#journal-preview').href='/admin/journal/'+entry.id+'/preview';
  const data=entry.draft;for(const name of ['title','excerpt'])form().elements[name].value=data[name];
  for(const [key,label,items]of [['coverWorkId','不使用封面',context.portfolio.works.filter(w=>w.status!=='draft')],['seriesId','不关联组图',context.portfolio.series.filter(s=>s.status==='published')]]){
    const select=form().elements[key];select.replaceChildren(option('',label),...items.map(item=>option(item.id,item.title)));
    if(data[key]&&!items.some(item=>item.id===data[key]))select.append(option(data[key],'原内容已隐藏或移除'));select.value=data[key];
  }
  blocks=structuredClone(data.blocks);renderBlocks();renderList();buttons();tell('已保存');
}
function buttons(){
  $('#journal-publish').textContent=current?.live?'更新发布':'发布随记';
  $('#journal-unpublish').hidden=!current?.live;
  for(const b of document.querySelectorAll('[data-journal-action]'))b.disabled=busy||conflict;
}
async function save(action='save'){
  clearTimeout(timer);if(!current)return;
  if(conflict)throw Error('保存冲突，请复制内容后刷新。');
  if(busy){if(action==='save'){timer=setTimeout(()=>save().catch(()=>{}),1200);return;}throw Error('正在保存，请稍候再操作。');}
  if(!dirty&&action==='save')return;
  const id=current.id,version=generation;busy=true;buttons();tell(action==='save'?'正在保存…':'正在处理…');
  try{
    const entry=await context.api('/api/admin/journal/'+id,context.json('PUT',{revision:current.revision,draft:draft(),action}));
    current=entry;entries=entries.map(e=>e.id===id?entry:e);dirty=generation!==version;renderList();
    tell(action==='publish'?'已发布':action==='unpublish'?'已撤下，草稿仍保留':dirty?'尚有修改等待保存':'草稿已保存');
    if(dirty)timer=setTimeout(()=>save().catch(()=>{}),1200);
  }catch(error){dirty=true;conflict=error.message.includes('别处修改');tell(error.message+' 内容仍保留在编辑器中。');throw error;}
  finally{busy=false;buttons();}
}
async function choose(id){if(busy)throw Error('正在保存，请稍候');if(dirty)await save();const entry=entries.find(e=>e.id===id);if(entry)fill(entry);}
export function mountJournalEditor(next){
  context=next;if(mounted)return;mounted=true;
  const panel=node('section',undefined,'admin-panel');panel.id='journal-panel';panel.hidden=true;
  panel.innerHTML=`<div class="journal-admin-heading"><div><h2>随记</h2><p class="field-help">写旅途见闻，也写偶尔冒出来的想法。</p></div><button type="button" class="primary" id="journal-new">写一篇随记</button></div><div class="journal-admin-layout"><aside id="journal-admin-list" aria-label="我的随记"></aside><form id="journal-editor" hidden><label>标题<input name="title" maxlength="120" placeholder="给这篇随记起个名字"></label><label>摘要（选填）<textarea name="excerpt" maxlength="240" rows="2" placeholder="留空时，使用正文开头作为摘要"></textarea></label><details class="journal-options"><summary>封面与关联组图（选填）</summary><label>封面<select name="coverWorkId"></select></label><label>关联组图<select name="seriesId"></select></label><p class="field-help">照片直接引用作品库，不会重复占用存储空间。隐藏或移除的照片不对访客显示。</p></details><div id="journal-blocks"></div><div class="journal-add-blocks" aria-label="添加内容"></div><div class="journal-editor-actions"><p id="journal-save-status" role="status"></p><div><button type="button" class="secondary" id="journal-save" data-journal-action>保存草稿</button><a id="journal-preview" class="secondary" target="_blank" rel="noopener">预览草稿 ↗</a><button type="button" class="primary" id="journal-publish" data-journal-action>发布随记</button><button type="button" class="quiet" id="journal-unpublish" data-journal-action>撤下文章</button></div><p class="field-help">输入停顿后自动保存草稿。已发布的文章，点击“更新发布”才会对访客生效。</p></div></form></div>`;
  $('#dashboard').append(panel);
  const tab=button('随记',async()=>{
    document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===tab));document.querySelectorAll('.admin-panel').forEach(p=>p.hidden=p!==panel);
    if(current)return;
    try{entries=(await context.api('/api/admin/journal')).entries;renderList();if(entries.length)fill(entries[0]);}catch(error){$('#journal-admin-list').textContent=error.message;}
  });tab.dataset.tab='journal-panel';document.querySelector('[data-tab="series-panel"]').after(tab);
  form().onsubmit=event=>event.preventDefault();
  for(const name of ['title','excerpt','coverWorkId','seriesId'])form().elements[name].addEventListener('input',changed);
  for(const [type,label]of [['text','＋ 正文'],['heading','＋ 小标题'],['image','＋ 照片'],['quote','＋ 引用']])$('.journal-add-blocks').append(button(label,()=>{blocks.push(type==='image'?{type,workId:'',caption:''}:{type,text:''});changed();renderBlocks();},'secondary'));
  $('#journal-new').onclick=async()=>{if(busy)return;try{if(dirty)await save();const entry=await context.api('/api/admin/journal',context.json('POST',{}));entries.unshift(entry);fill(entry);form().elements.title.focus();}catch(error){context.toast(error.message);}};
  for(const [id,action]of [['journal-save','save'],['journal-publish','publish'],['journal-unpublish','unpublish']])$('#'+id).onclick=()=>save(action).catch(()=>{});
  $('#journal-preview').onclick=event=>{if(dirty||busy){event.preventDefault();tell('请等待草稿保存完成，再打开预览。');if(!busy)save().catch(()=>{});}};
}
