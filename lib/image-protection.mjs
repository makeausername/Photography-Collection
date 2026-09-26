import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { imageCache } from './image-cache.mjs';
import path from 'node:path';

export const protectionDefaults = Object.freeze({ imageGuard: 'on', displayMax: 2400, watermark: 'on', watermarkPosition: 'bottom-right', watermarkOpacity: 55, copyrightNotice: '照片仅供浏览，使用请先联系授权。' });
export function protectionSettings(settings) { return { ...protectionDefaults, ...settings }; }
export function parseProtection(body, previous) {
  const values = {};
  const current = protectionSettings(previous);
  for (const key of Object.keys(protectionDefaults)) values[key] = body[key] ?? current[key];
  if (!['on', 'off'].includes(values.imageGuard) || !['on', 'off'].includes(values.watermark)) throw Error('作品保护开关无效');
  values.displayMax = Number(values.displayMax); values.watermarkOpacity = Number(values.watermarkOpacity);
  if (![1600, 2000, 2400].includes(values.displayMax)) throw Error('展示图长边请选择 1600、2000 或 2400 像素');
  if (!['bottom-right', 'bottom-left', 'center'].includes(values.watermarkPosition)) throw Error('水印位置无效');
  if (!Number.isInteger(values.watermarkOpacity) || values.watermarkOpacity < 25 || values.watermarkOpacity > 85) throw Error('水印不透明度应为 25～85');
  if (typeof values.copyrightNotice !== 'string' || values.copyrightNotice.length > 150) throw Error('版权提示不能超过 150 个字符');
  values.copyrightNotice = values.copyrightNotice.trim();
  return values;
}

function watermarkSVG(width, height, settings, demo, panoramic) {
  const fontSize = Math.max(12, Math.round(width * (panoramic ? 0.0042 : 0.022)));
  const label = demo ? 'Watermark demo · KosmoYonder' : '© KosmoYonder';
  const margin = Math.round(Math.min(width, height) * 0.045);
  const position = settings.watermarkPosition;
  const y = position === 'center' ? Math.round(height / 2) : height - margin;
  const x = position === 'bottom-left' ? margin : position === 'center' ? width / 2 : width - margin;
  const text = (px, py, anchor) => `<text x="${px}" y="${py}" text-anchor="${anchor}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" fill="white" stroke="black" stroke-width="${Math.max(0.6, fontSize / 32)}" paint-order="stroke" opacity="${settings.watermarkOpacity / 100}">${label}</text>`;
  // Four marks around the horizon keep lettering away from the distorted poles.
  const marks = panoramic ? [0.125, 0.375, 0.625, 0.875].map(r => text(Math.round(width * r), Math.round(height * 0.57), 'middle')).join('') : text(x, y, position === 'bottom-left' ? 'start' : position === 'center' ? 'middle' : 'end');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${marks}</svg>`);
}

export function displayImages(uploads, cacheDir, storage) {
  const pending = new Map();
  const cache = imageCache(cacheDir);
  let running = 0;
  const queue = [];
  async function limited(job) {
    if (running >= 2) {
      if (queue.length >= 32) throw Error('图片处理繁忙');
      await new Promise(resolve => queue.push(resolve));
    } else running++;
    try { return await job(); }
    finally { const next = queue.shift(); if (next) next(); else running--; }
  }
  return async (work, variant, settings, width = 0) => {
    if (!work.image?.startsWith('/uploads/')) throw Error('图片源无效');
    const source = path.join(uploads, path.basename(work.image));
    const assetKey = work.image.slice(1);
    const sourceStat = storage ? await storage.info(assetKey) : await stat(source);
    const options = Object.fromEntries(['displayMax', 'watermark', 'watermarkPosition', 'watermarkOpacity'].map(key => [key, settings[key]]));
    const key = createHash('sha256').update(JSON.stringify([7, assetKey, sourceStat.fingerprint || `${sourceStat.size}:${sourceStat.mtimeMs}`, work.kind, !!work.demo, variant, width, options])).digest('hex');
    const cached = await cache.get(key);
    if (cached) return cached;
    if (!pending.has(key)) {
      const job = limited(async () => {
        const panoramic = work.kind === 'panorama' && variant === 'image';
        const max = variant === 'preview' ? 1200 : panoramic ? 8192 : settings.displayMax;
        const input = storage ? await storage.read(assetKey) : source;
        const { data, info } = await sharp(input, { limitInputPixels: 160000000 }).rotate().resize({ width: width || max, height: panoramic ? undefined : max, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
        let output = sharp(data, { raw: info });
        if (settings.watermark === 'on') output = output.composite([{ input: watermarkSVG(info.width, info.height, settings, work.demo, panoramic) }]);
        const buffer = await output.webp({ quality: 85, effort: 4 }).toBuffer();
        await cache.put(key, buffer);
        return buffer;
      });
      pending.set(key, job);
      job.finally(() => pending.delete(key)).catch(() => {});
    }
    return pending.get(key);
  };
}
