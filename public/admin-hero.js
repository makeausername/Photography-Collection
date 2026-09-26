const $ = selector => document.querySelector(selector);
const node = (tag, text, cls) => { const e=document.createElement(tag); if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e; };
let context, slides=[], initialized=false, dirty=false, busy=false;
export const heroDirty = () => dirty || busy;
const markDirty = () => { dirty=true; $('#hero-dirty').textContent='有未保存的修改'; $('#hero-message').textContent=''; };
function render() {
  const target=$('#hero-slides-list'); target.replaceChildren();
  slides.forEach((slide,index) => {
    const work=context.portfolio.works.find(work=>work.id===slide.workId);
    const card=node('article',undefined,'hero-editor-card'), header=node('div',undefined,'hero-editor-heading');
    const thumb=node('img'); thumb.src=work.preview;thumb.alt='';
    const title=node('h3',`${String(index+1).padStart(2,'0')} / ${work.title}`), actions=node('div',undefined,'hero-editor-actions');
    for(const [label,step] of [['上移',-1],['下移',1],['移除',0]]) {
      const b=node('button',label,'quiet'); b.type='button'; b.setAttribute('aria-label',`${label}轮播照片 ${work.title}`);
      b.disabled=step!==0 && (index+step<0 || index+step>=slides.length);
      b.onclick=()=>{if(!step)slides.splice(index,1);else [slides[index],slides[index+step]]=[slides[index+step],slides[index]];markDirty();render();};actions.append(b);
    }
    header.append(thumb,title,actions); card.append(header);
    const details=node('details'),summary=node('summary','调整画面位置'),previews=node('div',undefined,'hero-crop-grid');details.append(summary,previews);
    for(const [name,x,y,cls] of [['电脑','x','y','desktop'],['手机','mobileX','mobileY','mobile']]) {
      const pane=node('div',undefined,'hero-crop-pane');pane.append(node('p',name));
      const frame=node('div',undefined,'hero-crop-preview '+cls),image=node('img');image.src=work.preview;image.alt=`${work.title} · ${name}裁切预览`;image.loading='lazy';frame.append(image);
      const update=()=>{image.style.objectPosition=`${slide[x]}% ${slide[y]}%`;};update();pane.append(frame);
      for(const [key,axis] of [[x,'水平'],[y,'垂直']]) {
        const label=node('label',`${axis}位置`),input=node('input'),value=node('output',slide[key]+'%');
        input.type='range';input.min='0';input.max='100';input.step='1';input.value=slide[key];input.setAttribute('aria-label',`${name}${axis}位置 · ${work.title}`);
        input.oninput=()=>{slide[key]=Number(input.value);value.textContent=input.value+'%';update();markDirty();};label.append(value,input);pane.append(label);
      }
      previews.append(pane);
    }
    details.append(node('p','拖动滑块，调整照片在画面中的位置。不同屏幕比例会略有差异。','field-help'));card.append(details);target.append(card);
  });
  if(!slides.length)target.append(node('p','还没有选择轮播照片，将显示备用封面。','field-help'));
  const select=$('#choose-hero-photo');select.replaceChildren();
  const placeholder=node('option','选择已发布照片');placeholder.value='';select.append(placeholder);
  context.portfolio.works.filter(work=>work.kind==='photo'&&work.status!=='draft'&&!slides.some(slide=>slide.workId===work.id)).forEach(work=>{const option=node('option',[work.title,work.location].filter(Boolean).join(' / '));option.value=work.id;select.append(option);});
  $('#add-hero-photo').disabled=slides.length>=5;
}
export function mountHeroEditor(value) {
  context=value;
  if(!dirty) { slides=structuredClone(value.portfolio.heroSlides || []); $('#hero-autoplay').value=value.portfolio.settings.heroAutoplay ?? 'on'; $('#hero-interval').value=value.portfolio.settings.heroInterval ?? 7; render(); }
  if(initialized)return; initialized=true;
  $('#hero-autoplay').onchange=markDirty; $('#hero-interval').oninput=markDirty;
  $('#add-hero-photo').onclick=()=>{const id=$('#choose-hero-photo').value;if(!id||slides.length>=5)return;slides.push({workId:id,x:50,y:50,mobileX:50,mobileY:50});markDirty();render();};
  $('#hero-form').onsubmit=async event=>{
    event.preventDefault();if(busy)return;busy=true;
    const button=$('#hero-form .primary');button.disabled=true;
    // Lock local edits until the saved order returns.
    const controls=[...$('#hero-form').querySelectorAll('input,select,button')];
    const disabled=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
    try {
      await context.api('/api/hero',context.json('PUT',{slides,heroAutoplay:$('#hero-autoplay').value,heroInterval:Number($('#hero-interval').value)}));dirty=false;
      await context.refresh();$('#hero-dirty').textContent='轮播已保存';$('#hero-message').textContent='封面轮播已更新。';
    } catch(error) { $('#hero-message').textContent=error.message; }
    finally { busy=false;controls.forEach((control,index)=>control.disabled=disabled[index]);button.disabled=false; }
  };
}
