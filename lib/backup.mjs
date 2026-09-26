import { mkdir, link, writeFile, rm, readdir, stat, statfs } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openPortfolio } from './database.mjs';
import { referencedFiles } from './work-lifecycle.mjs';

export async function storageInfo(dataDir, db) {
  const scan = async directory => {
    let bytes = 0, files = 0;
    for (const name of await readdir(directory).catch(() => [])) {
      const info = await stat(path.join(directory, name)).catch(() => null);
      if (info?.isFile()) { bytes += info.size; files++; }
    }
    return { bytes, files };
  };
  const [uploads, cache, disk] = await Promise.all([scan(path.join(dataDir, 'uploads')), scan(path.join(dataDir, 'display-cache')), statfs(dataDir).catch(() => null)]);
  const previews = new Set(db.works.map(work => work.preview).filter(url => url?.startsWith('/uploads/') && !db.works.some(work => work.image === url)));
  let previewBytes = 0;
  for (const url of previews) previewBytes += (await stat(path.join(dataDir, 'uploads', path.basename(url))).catch(() => null))?.size || 0;
  return { sourceBytes: uploads.bytes - previewBytes, previewBytes, cacheBytes: cache.bytes, cacheLimit: 512 * 1024 * 1024, freeBytes: disk ? disk.bavail * disk.bsize : null, workCount: db.works.length };
}

// Stage a portable snapshot; the caller holds the write lock until export finishes.
export async function exportBackup(dataDir, snapshot, res, storage) {
  const directory = path.join(dataDir, '.exports', randomUUID());
  const relative = path.relative(path.join(dataDir, '.exports'), directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('备份目录无效');
  await mkdir(path.join(directory, 'uploads'), { recursive: true });
  try {
    const profileKey=snapshot.settings.profilePhotoKey || 'profile.webp';
    // A complete archive restores in local mode even if the original library used OSS.
    if(snapshot.settings.profilePhoto)snapshot.settings.profilePhotoKey='profile.webp';
    await writeFile(path.join(directory, 'portfolio.json'), JSON.stringify(snapshot, null, 2));
    const backupDB=openPortfolio(directory);backupDB.close();
    const files = referencedFiles(snapshot);
    if (snapshot.settings.profilePhoto) files.add('profile.webp');
    for (const file of files) {
      const key=file==='profile.webp'?profileKey:file;
      if(storage)await writeFile(path.join(directory,file),await storage.read(key));
      else await link(path.join(dataDir,file),path.join(directory,file));
    }
    await writeFile(path.join(directory, '恢复说明.txt'), '先停止网站服务并备份现有数据。将本压缩包解压到一个全新的 DATA_DIR，设置 STORAGE_PROVIDER=local 后启动。优先读取 portfolio.sqlite；portfolio.json 是通用导出副本。图片已全部包含在 uploads 和 profile.webp 中，包括原来保存在 OSS 的图片。不要覆盖正在运行的 SQLite 数据库或混用旧的 -wal/-shm 文件。此备份不含管理员密码、密钥、展示缓存和相机原片；新服务器首次启动需要重新设置管理员密码。如需恢复 OSS 模式，先在本地模式核对作品，再停止服务运行迁移命令。');
    res.set('Cache-Control', 'private, no-store');
    res.attachment(`KosmoYonder-backup-${new Date().toISOString().slice(0,10)}.tar.gz`);
    await new Promise((resolve, reject) => {
      const child = spawn('tar', ['-czf', '-', '-C', directory, '.'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const close = () => { child.kill(); };
      res.once('close', close);
      child.stdout.pipe(res, { end: false });
      child.stderr.resume();
      child.on('error', reject);
      child.on('close', code => { res.off('close', close); code === 0 ? resolve() : reject(Error('备份导出中断，请重新下载')); });
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
  res.end();
}
