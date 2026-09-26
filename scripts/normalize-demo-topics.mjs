import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data/many-works-demo/portfolio.json');
if (existsSync(path.join(path.dirname(file), 'portfolio.sqlite'))) throw Error('已有 SQLite 作品库，请通过后台管理作品；演示初始化只用于新数据目录。');
if (!existsSync(file)) throw new Error('请先生成多作品演示数据。');
const db = JSON.parse(readFileSync(file, 'utf8'));
const oldTopics = new Set(['自然风光', '山川湖泊', '沙漠纹理', '瀑布溪流', '360° 全景']);
const backup = file + '.before-subjects';
if (!existsSync(backup)) copyFileSync(file, backup);
let count = 0;
for (const work of db.works) {
  if (work.demo && /^many-demo-\d+$/.test(work.id) && oldTopics.has(work.category)) {
    work.category = '山川湖海';
    count++;
  }
}
db.settings.bio = db.settings.bio.replace('36 幅摄影作品，分为 3 个分类。', '36 幅摄影演示作品，按题材浏览，拍摄地点单独展示。');
writeFileSync(file + '.tmp', JSON.stringify(db, null, 2));
renameSync(file + '.tmp', file);
console.log(`已调整 ${count} 条演示作品的题材，作品地点保持原值。`);
