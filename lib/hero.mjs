const photo = work => work.kind === 'photo' && work.status !== 'draft';
const center = id => ({ workId: id, x: 50, y: 50, mobileX: 50, mobileY: 50 });

export function resolveHeroSlides(db) {
  const photos = db.works.filter(photo);
  const fallback = photos.find(work => work.id === db.settings.coverWorkId) || photos[0];
  const configured = db.settings.heroSlides;
  if (Array.isArray(configured)) {
    const slides = configured.filter(slide => photos.some(work => work.id === slide.workId)).slice(0, 5);
    return slides.length ? slides : fallback ? [center(fallback.id)] : [];
  }
  const ids = [...new Set([fallback?.id, ...(db.settings.featuredPhotos || []), ...photos.map(work => work.id)])];
  return ids.filter(id => photos.some(work => work.id === id)).slice(0, 3).map(center);
}

export function parseHeroSlides(slides, works) {
  if (!Array.isArray(slides) || slides.length > 5) throw Error('封面轮播最多选择 5 张照片');
  const ids = new Set();
  return slides.map(slide => {
    if (!slide || typeof slide !== 'object' || ids.has(slide.workId) || !works.some(work => work.id === slide.workId && photo(work))) throw Error('请选择不重复的已发布照片');
    ids.add(slide.workId);
    const result = { workId: slide.workId };
    for (const key of ['x', 'y', 'mobileX', 'mobileY']) {
      const value = slide[key];
      if (!Number.isInteger(value) || value < 0 || value > 100) throw Error('画面位置应在 0～100 之间');
      result[key] = value;
    }
    return result;
  });
}

export function parseHeroPlayback(body, previous = {}) {
  const heroAutoplay = body.heroAutoplay ?? previous.heroAutoplay ?? 'on';
  const heroInterval = Number(body.heroInterval ?? previous.heroInterval ?? 7);
  if (!['on', 'off'].includes(heroAutoplay)) throw Error('请选择是否自动播放');
  if (!Number.isInteger(heroInterval) || heroInterval < 3 || heroInterval > 30) throw Error('每张照片的停留时间应为 3～30 秒');
  return { heroAutoplay, heroInterval };
}
