import { resolveHeroSlides } from './hero.mjs';
import { SUBJECT_CATEGORIES } from '../public/categories.js';
import { orderSeriesWorks } from './work-lifecycle.mjs';

export const isPublished = work => work.status !== 'draft';
export const workYear = work => String(work.year || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || String(work.year || '');
export const publicWork = ({ uploadId, sourceHash, ...work }) => ({ ...work, image: `/media/${encodeURIComponent(work.id)}/image.jpg`, preview: `/media/${encodeURIComponent(work.id)}/preview.jpg` });
export function queryWorks(db, query = {}) {
  const kind = query.kind === 'panorama' ? 'panorama' : 'photo';
  const q = typeof query.q === 'string' ? query.q.trim().toLocaleLowerCase().slice(0, 100) : '';
  const ordered = query.series ? orderSeriesWorks(db,query.series) : query.sort === 'latest' ? [...db.works].sort((a,b)=>(b.createdAt || '').localeCompare(a.createdAt || '')) : db.works;
  return ordered.filter(work => isPublished(work) && work.kind === kind &&
    (!query.location || work.location === query.location) && (!query.year || workYear(work) === query.year) &&
    (!query.category || work.category === query.category) && (!query.series || work.seriesId === query.series) &&
    (!q || [work.title, work.location, work.year].join(' ').toLocaleLowerCase().includes(q)));
}
export function libraryPage(db, query = {}) {
  const page = Math.max(1, Math.min(1000000, Number.parseInt(query.page, 10) || 1));
  const limit = query.kind === 'panorama' ? 3 : 6;
  const works = queryWorks(db, query);
  return { works: works.slice((page - 1) * limit, page * limit).map(publicWork), total: works.length, page, pages: Math.ceil(works.length / limit), limit };
}
export function featured(db, kind) {
  const key = kind === 'panorama' ? 'featuredPanoramas' : 'featuredPhotos', max = kind === 'panorama' ? 3 : 6;
  const candidates = db.works.filter(work => isPublished(work) && work.kind === kind);
  return (Array.isArray(db.settings[key]) ? db.settings[key].map(id => candidates.find(work => work.id === id)).filter(Boolean) : candidates.slice(0, max)).map(publicWork);
}
export function publicSeries(db) {
  return (db.series || []).filter(series => series.status === 'published').flatMap(series => {
    const works = orderSeriesWorks(db,series.id).filter(isPublished);
    if (!works.length) return [];
    const cover = works.find(work => work.id === series.coverWorkId) || works[0];
    return [{ id: series.id, title: series.title, description: series.description, location:series.location || '', period:series.period || '', count: works.length, cover: publicWork(cover) }];
  });
}
export function siteData(db, settings) {
  const photos = db.works.filter(work => isPublished(work) && work.kind === 'photo');
  const present = new Set(photos.map(work => work.category));
  const categories = [...new Set([...SUBJECT_CATEGORIES.filter(name => present.has(name)), ...present])];
  const hero = photos.find(work => work.id === settings.coverWorkId) || photos[0];
  const heroSlides = resolveHeroSlides(db).map(slide => ({...slide, work: publicWork(photos.find(work => work.id === slide.workId))}));
  return { settings, categories, heroSlides, hero: hero ? publicWork(hero) : null, photos: featured(db, 'photo'), panoramas: featured(db, 'panorama'), series: publicSeries(db), totalPhotos: photos.length, totalPanoramas: db.works.filter(work => isPublished(work) && work.kind === 'panorama').length };
}
