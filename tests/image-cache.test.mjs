import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, utimes, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { imageCache } from '../lib/image-cache.mjs';
import { imageSources } from '../public/image-sources.js';

test('缓存按容量淘汰、过期清理，并保留无关文件', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photo-cache-'));
  const key = n => String(n).repeat(64);
  for (const [name, age] of [[key(1)+'.webp', 2000], [key(2)+'.webp', 1000], [key(3)+'.webp', 200000], [key(4)+'.jpg', 0]]) {
    await writeFile(path.join(directory, name), '1234');
    const date = new Date(Date.now() - age); await utimes(path.join(directory, name), date, date);
  }
  await writeFile(path.join(directory, 'keep.txt'), 'source');
  const cache = imageCache(directory, { maxBytes: 8, maxAge: 100000 });
  t.after(async () => { cache.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal(await cache.get(key(3)), null);
  assert.equal(await cache.get(key(4)), null);
  assert.equal((await cache.get(key(1))).toString(), '1234');
  await cache.put(key(5), Buffer.from('5678'));
  assert.equal(await cache.get(key(2)), null); // Older entry is evicted, recently read one survives.
  assert.equal((await cache.get(key(1))).toString(), '1234');
  assert.equal((await cache.get(key(5))).toString(), '5678');
  await cache.put(key(6), Buffer.alloc(9)); // A single oversize object is not retained.
  assert.equal(await cache.get(key(6)), null);
  assert.equal(await readFile(path.join(directory, 'keep.txt'), 'utf8'), 'source');
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.webp')).length, 2);
});

test('响应式图片使用真实宽度，兼容竖图与小尺寸作品', () => {
  assert.equal(imageSources('/photo', {width: 1800, height: 3200}, 1200), '/photo?w=480 480w, /photo 675w');
  assert.equal(imageSources('/photo', {width: 320, height: 200}, 1200), '/photo 320w');
  assert.equal(imageSources('/photo', {width: 2800, height: 1800}, 2400), '/photo?w=480 480w, /photo?w=960 960w, /photo 2400w');
});
