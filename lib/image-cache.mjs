import { mkdir, readdir, stat, readFile, writeFile, rename, unlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Only disposable, hash-named derivatives belong here. Source files are never visited.
export function imageCache(directory, { maxBytes = 512 * 1024 * 1024, maxAge = 7 * 86400000 } = {}) {
  const entries = new Map();
  let ready, maintenance = Promise.resolve();
  const serial = job => { const next = maintenance.then(job); maintenance = next.catch(() => {}); return next; };
  const initialize = () => ready ||= (async () => {
    await mkdir(directory, { recursive: true });
    for (const name of await readdir(directory)) {
      if (/^[a-f0-9]{64}\.(?:jpg|webp)(?:\.[a-f0-9-]{36})?\.tmp$/.test(name)) {
        const info = await stat(path.join(directory, name)).catch(() => null);
        if (info?.isFile() && Date.now() - info.mtimeMs > 86400000) await unlink(path.join(directory, name));
        continue;
      }
      if (!/^[a-f0-9]{64}\.(?:webp|jpg)$/.test(name)) continue;
      const info = await stat(path.join(directory, name)).catch(() => null);
      if (info?.isFile()) entries.set(name, { size: info.size, used: name.endsWith('.jpg') ? 0 : info.mtimeMs });
    }
    await prune();
  })();
  async function prune() {
    let total = [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);
    for (const [name, entry] of [...entries].sort((a, b) => a[1].used - b[1].used)) {
      if (total <= maxBytes && Date.now() - entry.used <= maxAge) break;
      await unlink(path.join(directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      total -= entry.size; entries.delete(name);
    }
  }
  const timer = setInterval(() => serial(async () => { await initialize(); await prune(); }).catch(() => {}), 30 * 60000).unref();
  return {
    async get(key) {
      await initialize();
      const name = key + '.webp', entry = entries.get(name);
      if (!entry || Date.now() - entry.used > maxAge) return null;
      try {
        const buffer = await readFile(path.join(directory, name));
        const previous = entry.used; entry.used = Date.now();
        if (entry.used - previous > 3600000) await utimes(path.join(directory, name), new Date(), new Date()).catch(() => {});
        return buffer;
      } catch (error) { if (error.code !== 'ENOENT') throw error; entries.delete(name); return null; }
    },
    async put(key, buffer) {
      await initialize();
      if (buffer.length > maxBytes) return;
      await serial(async () => {
        const name = key + '.webp', target = path.join(directory, name), temporary = target + '.' + randomUUID() + '.tmp';
        try { await writeFile(temporary, buffer); await rename(temporary, target); }
        finally { await unlink(temporary).catch(() => {}); }
        entries.set(name, { size: buffer.length, used: Date.now() });
        await prune();
      });
    },
    close() { clearInterval(timer); }
  };
}
