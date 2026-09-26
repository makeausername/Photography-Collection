import { resolveHeroSlides } from './hero.mjs';
import { publicSeries } from './library.mjs';
import { shareInfo, shareArtwork } from './sharing.mjs';
import sharp from 'sharp';

export function pageShare(db,origin,seriesId='') {
  const series=seriesId?publicSeries(db).find(item=>item.id===seriesId):null;
  if(seriesId&&!series)return null;
  const published=db.works.filter(work=>work.status!=='draft');
  const cover=series ? published.find(work=>work.id===series.cover.id) : published.find(work=>work.id===db.settings.shareCoverWorkId) || published.find(work=>work.id===resolveHeroSlides(db)[0]?.workId) || published[0];
  const title=series?.title || db.settings.name || 'KosmoYonder';
  const description=series?.description || db.settings.subtitle || '风光与旅行摄影';
  const base=origin+(series?'/series/'+encodeURIComponent(series.id):'/');
  const assetBase=origin+(series?'/share/series/'+encodeURIComponent(series.id):'/share/site');
  const local=shareInfo({id:'',title:''},db.settings,origin).local;
  return {cover,info:{type:series?'series':'site',title,description,url:base,card:assetBase+'/card.jpg',poster:assetBase+'/poster.jpg',qr:assetBase+'/qr.svg',local,caption:[title,description,base].filter(Boolean).join('\n')}};
}
export async function pageShareArtwork(settings,value,source,poster=false) {
  if(!source)source=await sharp({create:{width:1200,height:900,channels:3,background:'#243c33'}}).webp().toBuffer();
  return shareArtwork({title:value.info.type==='site'?(settings.subtitle || value.info.title):value.info.title,location:value.info.type==='site'?'摄影作品集':value.info.description.slice(0,40),kind:'photo',demo:value.cover?.demo,credit:value.cover?.credit},settings,value.info,source,poster);
}
