import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const file = path.join(dir, 'portfolio.json');
if (existsSync(file)) { console.log('已有作品数据，跳过演示初始化。'); process.exit(0); }
mkdirSync(path.join(dir, 'uploads'), { recursive: true });
const assets = JSON.parse(readFileSync(path.join(root, 'demo/attribution.json'), 'utf8')).assets;
const labels = [ ['山湖之间', '自然风光', '加拿大 · 梦莲湖'], ['沙的纹理', '自然风光', '利比亚 · 撒哈拉'], ['瀑布与光', '自然风光', '冰岛 · 塞里雅兰'], ['湖畔，环顾四周', '360° 全景', '美国 · 阿卡迪亚国家公园'] ];
const works = [];
for (let i = 0; i < assets.length; i++) {
  const a = assets[i], id = 'demo-' + i, image = id + '.jpg', preview = id + '-preview.jpg';
  copyFileSync(path.join(root, 'demo', a.file), path.join(dir, 'uploads', image));
  await sharp(path.join(root, 'demo', a.file)).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 86 }).toFile(path.join(dir, 'uploads', preview));
  works.push({ id, title: labels[i][0], category: labels[i][1], location: labels[i][2], year: '', kind: i === 3 ? 'panorama' : 'photo', image: '/uploads/' + image, preview: '/uploads/' + preview, description: '演示素材，用于预览作品集效果。请在后台替换为你自己的摄影作品。', demo: true, credit: `${a.author} · ${a.license} · 预览有缩放与显示裁切`, source: a.source, licenseUrl: a.licenseUrl || '', createdAt: new Date().toISOString() });
}
writeFileSync(file, JSON.stringify({ settings: { name: '光屿', subtitle: '摄影作品集', headline: '看见，\n那些安静的瞬间。', bio: '这是摄影作品集的演示版本。\n你可以在中文后台设置自己的名字、个人介绍和联系方式，并替换这里的演示照片。', email: '', wechat: '' }, works }, null, 2));
console.log('已导入 3 张摄影演示素材和 1 张 360° 全景演示素材。');
