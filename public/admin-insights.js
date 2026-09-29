let mounted=false;
const node=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;};
export function mountInsights({api}) {
  if(mounted)return;mounted=true;
  const tabs=document.querySelector('[data-tab]').parentElement;
  const button=node('button','访问统计');button.type='button';button.dataset.tab='insights-panel';tabs.append(button);
  const panel=node('section','','admin-panel');panel.id='insights-panel';panel.hidden=true;
  document.querySelector('#dashboard').append(panel);
  button.onclick=async()=>{
    document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));
    document.querySelectorAll('.admin-panel').forEach(p=>p.hidden=p!==panel);
    panel.replaceChildren(node('h2','最近 30 天'),node('p','统计浏览、分享入口与联系入口的点击。同一访客对同一入口半小时内只记一次；不代表独立访客数或实际发送成功。','field-help'));
    try {
      const data=await api('/api/admin/insights'),cards=node('div','','storage-summary');
      for(const [key,label]of [['view','作品浏览'],['share','分享点击'],['contact','联系点击']]){const card=node('div','','storage-card');card.append(node('span',label),node('strong',String(data.totals[key])));cards.append(card);}panel.append(cards);
      const table=node('table','','insight-table'),head=node('tr','');for(const label of ['作品','浏览','分享','联系'])head.append(node('th',label));table.append(head);
      for(const item of data.works){const row=node('tr','');for(const value of [item.title,item.view,item.share,item.contact])row.append(node('td',String(value)));table.append(row);}panel.append(table);
      if(!data.works.length)panel.append(node('p','还没有访问记录。管理员浏览不计入统计。','empty-state'));
    } catch {panel.append(node('p','暂时无法读取统计，请稍后重试。'));}
  };
}
