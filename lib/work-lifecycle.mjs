export const TRASH_DAYS = 30;
export function recycleWork(db,id,now=Date.now()) {
  const index=db.works.findIndex(work=>work.id===id);
  if(index<0)throw Error('作品不存在');
  const work={...db.works[index],deletedAt:new Date(now).toISOString(),originalIndex:index};
  return {...db,works:db.works.filter(item=>item.id!==id),trash:[work,...(db.trash || [])]};
}
export function restoreWork(db,id) {
  const work=(db.trash || []).find(item=>item.id===id);
  if(!work)throw Error('回收站中没有这幅作品');
  if(db.works.some(item=>item.id===id))throw Error('作品编号冲突，请先检查作品库');
  const {deletedAt,originalIndex,...restored}=work;
  if(restored.seriesId && !(db.series || []).some(item=>item.id===restored.seriesId))restored.seriesId='';
  const works=[...db.works];works.splice(Math.min(originalIndex ?? 0,works.length),0,restored);
  return {...db,works,trash:db.trash.filter(item=>item.id!==id)};
}
export function expiredTrash(db,now=Date.now()) {
  return (db.trash || []).filter(work=>Date.parse(work.deletedAt)+TRASH_DAYS*86400000<=now);
}
export function referencedFiles(db) {
  const keys=new Set([...db.works,...(db.trash || [])].flatMap(work=>[work.image,work.preview]).filter(url=>/^\/uploads\/[a-zA-Z0-9._-]+$/.test(url)).map(url=>url.slice(1)));
  if(db.settings.profilePhoto)keys.add(db.settings.profilePhotoKey || 'profile.webp');
  return keys;
}
export function parseSeriesOrder(order,works,seriesId) {
  if(!Array.isArray(order)||order.some(id=>typeof id!=='string')||new Set(order).size!==order.length)throw Error('系列顺序无效');
  const ids=new Set(works.filter(work=>work.seriesId===seriesId).map(work=>work.id));
  if(order.length!==ids.size||order.some(id=>!ids.has(id)))throw Error('系列作品已发生变化，请刷新后重新排序');
  return order;
}
export function orderSeriesWorks(db,seriesId) {
  const works=db.works.filter(work=>work.seriesId===seriesId),order=(db.series || []).find(item=>item.id===seriesId)?.workOrder || [];
  const positions=new Map(order.map((id,index)=>[id,index]));
  return works.sort((a,b)=>(positions.get(a.id) ?? Infinity)-(positions.get(b.id) ?? Infinity));
}
