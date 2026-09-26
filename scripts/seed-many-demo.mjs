import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// An isolated dataset keeps the normal portfolio and its administrator account untouched.
const dir = path.join(root, 'data', 'many-works-demo');
const file = path.join(dir, 'portfolio.json');
if (existsSync(path.join(path.dirname(file), 'portfolio.sqlite'))) throw Error('已有 SQLite 作品库，请通过后台管理作品；演示初始化只用于新数据目录。');
if (existsSync(file)) {
  if (process.argv.includes('--add-panoramas')) {
    const db = JSON.parse(readFileSync(file, 'utf8'));
    const original = db.works.find(w => w.id === 'many-demo-37' && w.kind === 'panorama' && w.demo);
    if (!original) throw new Error('未找到原始全景演示作品，保留现有数据。');
    const backup = path.join(dir, 'portfolio.before-many-panoramas.json');
    if (!existsSync(backup)) copyFileSync(file, backup);
    const source = path.join(root, 'demo', 'jordan-pond-panorama.jpg');
    const preview = await sharp(source).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    let added = 0;
    for (let n = 2; n <= 6; n++) {
      const id = `many-demo-${36 + n}`;
      if (db.works.some(w => w.id === id)) continue;
      copyFileSync(source, path.join(dir, 'uploads', `${id}.jpg`));
      writeFileSync(path.join(dir, 'uploads', `${id}-preview.jpg`), preview);
      db.works.push({ ...original, id, title: `湖畔，环顾四周 · 示例 ${String(n).padStart(2, '0')}`, image: `/uploads/${id}.jpg`, preview: `/uploads/${id}-preview.jpg`, createdAt: new Date().toISOString() });
      added++;
    }
    if (original.title === '湖畔，环顾四周') original.title += ' · 示例 01';
    writeFileSync(file + '.tmp', JSON.stringify(db, null, 2));
    renameSync(file + '.tmp', file);
    console.log(`新增 ${added} 幅全景演示；现有 ${db.works.filter(w => w.kind === 'panorama').length} 幅全景。`);
    process.exit(0);
  }
  console.log('多作品演示数据已存在，保留现有数据。');
  process.exit(0);
}
mkdirSync(path.join(dir, 'uploads'), { recursive: true });
const assets = JSON.parse(readFileSync(path.join(root, 'demo/attribution.json'), 'utf8')).assets;
const labels = [
  ['山湖之间', '山川湖海', '加拿大 · 梦莲湖'],
  ['沙的纹理', '山川湖海', '利比亚 · 撒哈拉'],
  ['瀑布与光', '山川湖海', '冰岛 · 塞里雅兰'],
  ['湖畔，环顾四周', '山川湖海', '美国 · 阿卡迪亚国家公园'],
];
const previews = await Promise.all(assets.map(a => sharp(path.join(root, 'demo', a.file)).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer()));
const works = [];
for (let i = 0; i < 42; i++) {
  const index = i >= 36 ? 3 : i % 3;
  const a = assets[index], label = labels[index];
  const id = `many-demo-${String(i + 1).padStart(2, '0')}`;
  // Separate files let each demo entry be edited or deleted independently in the admin.
  copyFileSync(path.join(root, 'demo', a.file), path.join(dir, 'uploads', `${id}.jpg`));
  writeFileSync(path.join(dir, 'uploads', `${id}-preview.jpg`), previews[index]);
  works.push({
    id, title: `${label[0]} · 示例 ${String(i >= 36 ? i - 35 : Math.floor(i / 3) + 1).padStart(2, '0')}`,
    category: label[1], location: label[2], year: '', kind: i >= 36 ? 'panorama' : 'photo',
    image: `/uploads/${id}.jpg`, preview: `/uploads/${id}-preview.jpg`,
    description: '',
    demo: true, credit: `${a.author} · ${a.license} · 预览有缩放与显示裁切`,
    source: a.source, licenseUrl: a.licenseUrl || '', createdAt: new Date().toISOString(),
  });
}
const settings = {
  name: '光屿', subtitle: '摄影作品集', headline: '看见，\n那些安静的瞬间。',
  bio: '',
  email: '', wechat: '',
};
writeFileSync(file, JSON.stringify({ settings, works }, null, 2));
console.log('已生成独立演示：36 幅照片 / 6 幅全景，现有演示素材题材为山川湖海。');
console.log('数据目录：' + dir);
