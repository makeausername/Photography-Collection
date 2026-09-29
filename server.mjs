import { offsiteBackup } from './lib/offsite-backup.mjs';
import { mountJournal, journalEntries } from './lib/journal.mjs';
import { panoramaConfig, panoramaTiles } from './lib/panorama-tiles.mjs';
import { insights } from './lib/insights.mjs';
import { resolveHeroSlides, parseHeroSlides, parseHeroPlayback } from './lib/hero.mjs';
import { libraryPage, queryWorks, publicWork, publicSeries, siteData, workYear } from './lib/library.mjs';
import { exportBackup, storageInfo } from './lib/backup.mjs';
import { openPortfolio } from './lib/database.mjs';
import { createStorage } from './lib/storage.mjs';
import { acquireDataLock } from './lib/runtime-lock.mjs';
import { recycleWork, restoreWork, expiredTrash, referencedFiles, parseSeriesOrder, TRASH_DAYS } from './lib/work-lifecycle.mjs';
import { prepareWorkImages } from './lib/work-images.mjs';
import { automaticBackups } from './lib/automatic-backup.mjs';
import { pageShare, pageShareArtwork } from './lib/page-sharing.mjs';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPublicPage, validSocialURL } from './lib/public-pages.mjs';
import { shareInfo, shareArtwork, qrImage } from './lib/sharing.mjs';
import { protectionSettings, parseProtection, displayImages } from './lib/image-protection.mjs';

sharp.cache({ files: 0 });
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
acquireDataLock(dataDir);
const uploads = path.join(dataDir, 'uploads');
mkdirSync(uploads, { recursive: true });
const repository = openPortfolio(dataDir);
const storage = await createStorage(dataDir, repository);
const stats = insights(dataDir);
const displayImage = displayImages(uploads, path.join(dataDir, 'display-cache'), storage);
const tileImage=panoramaTiles(path.join(dataDir,'panorama-cache'),displayImage,storage);
const authPath = path.join(dataDir, 'admin.json');
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
function writeJSON(file, value) {
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
let db = repository.load();
let auth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, 'utf8')) : null;
const save = next => { repository.save(next); db = next; };
function setPassword(password) {
  const salt = randomBytes(32).toString('hex');
  auth = { salt, hash: scryptSync(password, salt, 64).toString('hex') };
  writeJSON(authPath, auth);
}
if (!auth && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD 至少需要 12 个字符');
  setPassword(process.env.ADMIN_PASSWORD);
}
const sessions = new Map();
const attempts = new Map();
const cleanup = setInterval(() => {
  for (const [key, val] of sessions) if (val < Date.now()) sessions.delete(key);
  for (const [key, val] of attempts) if (val.until < Date.now()) attempts.delete(key);
}, 60000).unref();
function token(req) { return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('portfolio_session='))?.split('=')[1]; }
function isAdmin(req) { return (sessions.get(token(req)) || 0) > Date.now(); }
function local(req) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && ['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname) && !req.headers['x-forwarded-for']; }
function admin(req, res, next) { if (!isAdmin(req)) return res.status(401).json({ error: '请先登录管理后台' }); next(); }
function session(req, res) {
  const id = randomBytes(32).toString('hex');
  sessions.set(id, Date.now() + 12 * 3600000);
  res.cookie('portfolio_session', id, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 12 * 3600000, path: '/' });
}
let exporting = false, activeWrites = 0, maintenance = false;
app.use((req, res, next) => {
  const mediaOrigins=storage.origins.join(' ');
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: ${mediaOrigins}; connect-src 'self' ${mediaOrigins}; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (!origin || origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: '请求来源无效，请从本站页面操作' });
    if (exporting || maintenance) return res.status(409).json({error:'正在备份或清理回收站，请完成后再修改作品'});
    activeWrites++;
    let released=false;
    const release=()=>{if(!released){released=true;activeWrites--;}};
    res.once('finish',release);res.once('close',release);
  }
  next();
});
app.use(express.json({ limit: '256kb' }));
const published = work => work.status !== 'draft';
app.get('/api/portfolio', (req, res) => {
  const works = db.works.filter(published).map(publicWork);
  const settings = { ...protectionSettings(db.settings), coverWorkId: works.some(w => w.id === db.settings.coverWorkId) ? db.settings.coverWorkId : '' };
  res.json({ settings, works });
});
app.post('/api/events',(req,res)=>{
  const {work='',event}=req.body || {};
  if(typeof work!=='string'||work.length>80||!['view','share','contact'].includes(event))return res.sendStatus(400);
  if(work&&!db.works.some(w=>w.id===work&&published(w)))return res.sendStatus(404);
  if(!isAdmin(req)&&req.get('DNT')!=='1')stats.record(work,event,req.ip || '');
  res.sendStatus(204);
});
app.get('/api/admin/insights',admin,(req,res)=>res.json(stats.report(db.works)));
app.get('/api/library-facets',(req,res)=>{
  if(req.query.series&&!publicSeries(db).some(s=>s.id===req.query.series))return res.sendStatus(404);
  const works=queryWorks(db,{kind:req.query.kind,series:req.query.series});
  const values=key=>[...new Set(works.map(w=>key==='year'?workYear(w):w[key]).filter(Boolean))].sort((a,b)=>b.localeCompare(a,'zh-CN'));
  res.json({locations:values('location'),years:values('year')});
});
app.get('/api/site', (req, res) => res.json(siteData(db, protectionSettings(db.settings))));
mountJournal(app,{admin,snapshot:()=>db,save,render:renderPublicPage,origin:req=>publicOrigin(req)});
app.get('/api/library', (req, res) => {
  if (req.query.series && !publicSeries(db).some(series => series.id === req.query.series)) return res.sendStatus(404);
  res.json(libraryPage(db, req.query));
});
app.get('/api/work/:id', (req, res) => {
  const work = db.works.find(work => work.id === req.params.id && published(work));
  if (!work) return res.sendStatus(404);
  const series = publicSeries(db).some(item=>item.id===req.query.series) ? req.query.series : pageSeries(work);
  const works = queryWorks(db, { ...req.query, series, kind: work.kind });
  const index = works.findIndex(item => item.id === work.id);
  res.json({ work: publicWork(work), previous: index > 0 ? works[index - 1].id : null, next: index >= 0 && index < works.length - 1 ? works[index + 1].id : null, position: index + 1, total: works.length });
});
app.put('/api/featured', admin, (req, res) => {
  const patch = {};
  for (const [key, kind, max] of [['featuredPhotos', 'photo', 6], ['featuredPanoramas', 'panorama', 3]]) {
    const ids = req.body[key];
    if (!Array.isArray(ids) || ids.length > max || new Set(ids).size !== ids.length || ids.some(id => !db.works.some(work => work.id === id && work.kind === kind && published(work)))) return res.status(400).json({ error: '精选只能选择已发布作品，照片最多六张，全景最多三个' });
    patch[key] = ids;
  }
  save({ ...db, settings: { ...db.settings, ...patch } }); res.json({ ok: true });
});
app.put('/api/hero', admin, (req, res) => {
  try {
    const heroSlides = parseHeroSlides(req.body.slides, db.works);
    const playback = parseHeroPlayback(req.body, db.settings);
    save({...db, settings:{...db.settings, heroSlides, ...playback}}); res.json({ok:true});
  } catch (error) { res.status(400).json({error:error.message}); }
});
app.get('/api/admin/storage', admin, async (req, res, next) => {
  try { res.json({...await storageInfo(dataDir, db), ...storage.describe()}); } catch (error) { next(error); }
});
app.post('/api/admin/storage/check', admin, async (req,res) => {
  try {res.json(await storage.check());}catch {res.status(503).json({error:'存储连接检查失败，请核对服务器上的 OSS 配置和读写权限'});}
});
app.post('/api/admin/storage/retry-deletes', admin, async (req,res) => {
  try {res.json({removed:await storage.retryDeletes()});}catch {res.status(503).json({error:'清理未完成，请检查 OSS 连接后重试'});}
});
app.get('/api/admin/backup', admin, async (req, res) => {
  if (exporting || maintenance || activeWrites) return res.status(409).json({ error: '正在保存作品或导出备份，请稍后再试' });
  exporting = true;
  try { await exportBackup(dataDir, structuredClone(db), res, storage); }
  catch { if (!res.headersSent) res.status(503).json({ error: '备份未完成，请检查磁盘空间及 tar 是否可用，再重新下载' }); else res.destroy(); }
  finally { exporting = false; }
});
const backups=await automaticBackups({dataDir,directory:process.env.BACKUP_DIR || undefined,snapshot:()=>db,storage,offsite:await offsiteBackup(),
  acquire:manual=>{if(exporting||maintenance||activeWrites>(manual?1:0))return false;exporting=true;return true;},release:()=>{exporting=false;}});
app.get('/api/admin/backups',admin,(req,res)=>res.json(backups.status()));
app.put('/api/admin/backups',admin,async(req,res)=>{try{res.json(await backups.configure(req.body));}catch(error){res.status(400).json({error:error.message});}});
app.post('/api/admin/backups/run',admin,(req,res)=>{if(!backups.start(true))return res.status(409).json({error:'正在保存或备份，请稍后重试'});res.status(202).json({ok:true});});
app.get('/api/admin/backups/:name/download',admin,async(req,res)=>{try{res.set('Cache-Control','private, no-store');res.download(await backups.file(req.params.name));}catch{try{const stream=await backups.remote(req.params.name);res.attachment(req.params.name);stream.on('error',()=>res.destroy());stream.pipe(res);}catch{res.status(404).json({error:'备份文件暂时无法读取，请检查异地存储配置'});}}});
app.post('/api/series', admin, (req, res) => {
  const title = text(req.body.title, 80), status = req.body.status || 'draft';
  if (!title || !['draft', 'published'].includes(status)) return res.status(400).json({error:'请填写系列名称并选择发布状态'});
  const entry = { id: randomUUID(), title, location:text(req.body.location,100), period:text(req.body.period,80), description: text(req.body.description, 1500), status };
  save({ ...db, series: [...(db.series || []), entry] }); res.status(201).json(entry);
});
app.put('/api/series/:id', admin, (req, res) => {
  const current = (db.series || []).find(item => item.id === req.params.id);
  if (!current) return res.sendStatus(404);
  const title = text(req.body.title, 80), status = req.body.status || current.status;
  if (!title || !['draft', 'published'].includes(status)) return res.status(400).json({error:'请填写系列名称并选择发布状态'});
  const coverWorkId = text(req.body.coverWorkId, 80);
  if (coverWorkId && !db.works.some(work => work.id === coverWorkId && work.seriesId === current.id && published(work))) return res.status(400).json({error:'封面请选择该系列已发布的作品'});
  let workOrder=current.workOrder;
  if(req.body.workOrder!==undefined) {try{workOrder=parseSeriesOrder(req.body.workOrder,db.works,current.id);}catch(error){return res.status(409).json({error:error.message});}}
  const updated = {...current, title, location:text(req.body.location,100), period:text(req.body.period,80), description:text(req.body.description,1500), status, coverWorkId,...(workOrder?{workOrder}:{})};
  save({...db,series:db.series.map(item=>item.id===current.id?updated:item)}); res.json(updated);
});
app.get('/api/admin/portfolio', admin, (req, res) => res.json({ ...db, settings: protectionSettings(db.settings), heroSlides: Array.isArray(db.settings.heroSlides) ? db.settings.heroSlides.filter(slide => db.works.some(work => work.id === slide.workId && work.kind === 'photo' && published(work))) : resolveHeroSlides(db) }));
app.get('/api/session', (req, res) => res.json({ authenticated: isAdmin(req), setupRequired: !auth, canSetup: !auth && local(req) }));
app.post('/api/setup', (req, res) => {
  if (auth) return res.status(409).json({ error: '管理员密码已经设置' });
  if (!local(req)) return res.status(403).json({ error: '首次设置需从服务器本机访问，或由管理员配置 ADMIN_PASSWORD' });
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) return res.status(400).json({ error: '请设置 12～128 个字符的密码' });
  setPassword(password); session(req, res); res.json({ ok: true });
});
app.post('/api/login', (req, res) => {
  const key = req.ip;
  const attempt = attempts.get(key) || { count: 0, until: Date.now() + 15 * 60000 };
  if (attempt.count >= 10 && attempt.until > Date.now()) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后重试' });
  const password = req.body.password;
  if (!auth || typeof password !== 'string' || password.length > 128 || !timingSafeEqual(Buffer.from(auth.hash, 'hex'), scryptSync(password, auth.salt, 64))) {
    attempt.count++; attempts.set(key, attempt); return res.status(401).json({ error: '密码不正确' });
  }
  attempts.delete(key); session(req, res); res.json({ ok: true });
});
app.post('/api/logout', admin, (req, res) => { sessions.delete(token(req)); res.clearCookie('portfolio_session', { path: '/' }); res.json({ ok: true }); });
function text(value, max = 200) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function pageSeries(work) { return publicSeries(db).some(s=>s.id===work.seriesId) ? work.seriesId : ''; }
function workFields(body) {
  const title = text(body.title, 80), category = text(body.category, 40);
  if (!title || !category) throw new Error('请填写作品标题和分类');
  const seriesId = text(body.seriesId, 80);
  if (seriesId && !(db.series || []).some(series => series.id === seriesId)) throw Error('旅行系列不存在');
  const licensing={};
  for(const key of ['vcgLicenseUrl','tuchongLicenseUrl']) { licensing[key]=text(body[key],500); if(licensing[key]&&!validSocialURL(licensing[key]))throw Error('授权链接请填写 HTTPS 地址'); }
  const panoramaMode=body.panoramaMode || 'auto';if(!['auto','single','tiles'].includes(panoramaMode))throw Error('全景显示方式无效');
  return { ...licensing, panoramaMode, title, category, seriesId, description: text(body.description, 1500), location: text(body.location, 100), year: text(body.year, 20) };
}
function workStatus(value, fallback = 'draft') {
  if (value === undefined) return fallback;
  if (!['draft', 'published'].includes(value)) throw Error('作品状态无效');
  return value;
}
const pendingUploads = new Set();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 14 } });
app.post('/api/profile-photo', admin, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({error:'请选择照片'});
    const meta = await sharp(req.file.buffer, { limitInputPixels: 160000000 }).metadata();
    if (!['jpeg','png','webp'].includes(meta.format) || (meta.pages || 1) > 1) return res.status(400).json({error:'请选择静态 JPG、PNG 或 WebP 照片'});
    const previous=db.settings.profilePhotoKey || 'profile.webp';
    const key=storage.provider==='oss' ? `uploads/profile-${randomUUID()}.webp` : 'profile.webp';
    const buffer=await sharp(req.file.buffer).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer();
    await storage.put(key,buffer);
    save({...db, settings:{...db.settings,profilePhoto:true,profilePhotoKey:key}});
    if(previous!==key)await storage.remove(previous).catch(()=>{});
    res.json({ok:true});
  } catch (error) { next(error); }
});
app.get('/profile.webp', async (req,res) => {
  if (!db.settings.profilePhoto) return res.sendStatus(404);
  res.set('Cache-Control','private, no-store');
  try {await deliverImage(res,await storage.read(db.settings.profilePhotoKey || 'profile.webp'),'webp');}
  catch {res.sendStatus(503);}
});
app.post('/api/works', admin, upload.single('photo'), async (req, res, next) => {
  let image, preview, uploadId;
  try {
    const fields = workFields(req.body);
    const status = workStatus(req.body.status);
    if (req.body.uploadId) {
      if (!/^[a-f0-9-]{36}$/.test(req.body.uploadId)) return res.status(400).json({ error: '上传标识无效，请重新选择文件' });
      const existing = db.works.find(work => work.uploadId === req.body.uploadId);
      if (existing) return res.json(existing);
      if (pendingUploads.has(req.body.uploadId)) return res.status(409).json({ error: '这张照片仍在处理，请稍后重试' });
      uploadId = req.body.uploadId; pendingUploads.add(uploadId);
    }
    if (!req.file) return res.status(400).json({ error: '请选择照片' });
    const kind = req.body.kind === 'panorama' ? 'panorama' : 'photo';
    const sourceHash = createHash('sha256').update(req.file.buffer).digest('hex');
    const duplicate = db.works.find(work => work.sourceHash === sourceHash && work.kind === kind);
    if (duplicate && req.body.allowDuplicate !== 'true') return res.status(409).json({ error: '这张图片已经上传：' + duplicate.title, duplicate: { id: duplicate.id, title: duplicate.title } });
    const meta = await sharp(req.file.buffer, { limitInputPixels: 160000000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) return res.status(400).json({ error: '请上传静态 JPG、PNG 或 WebP 图片' });
    const rotated = [5, 6, 7, 8].includes(meta.orientation);
    const ratio = rotated ? meta.height / meta.width : meta.width / meta.height;
    if (kind === 'panorama' && Math.abs(ratio - 2) > 0.03) return res.status(400).json({ error: '360° 全景需要宽高比为 2:1 的完整球形全景图，请先在相机软件中拼接导出' });
    const id = randomUUID(); image = `${id}.webp`; preview = `${id}-preview.webp`;
    const pipeline = sharp(req.file.buffer, { limitInputPixels: 160000000 }).rotate();
    const {data:sourceBuffer,info:stored} = await pipeline.clone().resize({ width: kind === 'panorama' ? 8192 : 2800, height: kind === 'panorama' ? undefined : 2800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, effort: 4 }).toBuffer({resolveWithObject:true});
    await storage.put('uploads/'+image,sourceBuffer);
    await storage.put('uploads/'+preview,await pipeline.clone().resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85, effort: 4 }).toBuffer());
    const work = { id, ...fields, sourceHash, kind, status, width: stored.width, height: stored.height, ...(uploadId ? { uploadId } : {}), image: `/uploads/${image}`, preview: `/uploads/${preview}`, demo: false, createdAt: new Date().toISOString() };
    save({ ...db, works: [work, ...db.works] }); res.status(201).json(work);
  } catch (error) {
    for (const file of [image, preview].filter(Boolean)) await storage.remove('uploads/'+file).catch(()=>{});
    if (/标题|分类|状态|系列|授权|全景显示|Input|image|pixel|buffer|unsupported|corrupt/i.test(error.message)) return res.status(400).json({ error: /标题|分类|状态|系列|授权|全景显示/.test(error.message) ? error.message : '图片无法读取或像素过大，请导出为 JPG 后重试（最大 1.6 亿像素）' });
    next(error);
  } finally { if (uploadId) pendingUploads.delete(uploadId); }
});
app.patch('/api/works/batch', admin, (req, res) => {
  const { ids, changes } = req.body;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) return res.status(400).json({ error: '请选择 1～200 幅作品' });
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some(key => !['category', 'location', 'status', 'seriesId'].includes(key))) return res.status(400).json({ error: '请选择要修改的题材、地点或发布状态' });
  if (ids.some(id => !db.works.some(work => work.id === id))) return res.status(404).json({ error: '部分作品已不存在，请刷新后重新选择' });
  try {
    const patch = {};
    if ('category' in changes) { patch.category = text(changes.category, 40); if (!patch.category) throw Error('作品题材不能为空'); }
    if ('location' in changes) { if (typeof changes.location !== 'string') throw Error('拍摄地点无效'); patch.location = text(changes.location, 100); }
    if ('status' in changes) patch.status = workStatus(changes.status);
    if ('seriesId' in changes) { patch.seriesId = text(changes.seriesId,80); if (patch.seriesId && !(db.series || []).some(series=>series.id===patch.seriesId)) throw Error('旅行系列不存在'); }
    const selected = new Set(ids);
    save({ ...db, works: db.works.map(work => selected.has(work.id) ? { ...work, ...patch } : work) });
    res.json({ updated: ids.length });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.put('/api/works/:id', admin, (req, res) => {
  const work = db.works.find(x => x.id === req.params.id);
  if (!work) return res.status(404).json({ error: '作品不存在' });
  try { const updated = { ...work, ...workFields({ ...work, ...req.body }), status: workStatus(req.body.status, work.status || 'published') }; save({ ...db, works: db.works.map(w => w.id === work.id ? updated : w) }); res.json(updated); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/works/:id/first', admin, (req, res) => {
  const index = db.works.findIndex(x => x.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '作品不存在' });
  save({ ...db, works: [db.works[index], ...db.works.filter((_, i) => i !== index)] }); res.json({ ok: true });
});
app.delete('/api/works/:id', admin, (req, res) => {
  try{save(recycleWork(db,req.params.id));res.json({ok:true,retentionDays:TRASH_DAYS});}
  catch(error){res.status(404).json({error:error.message});}
});
app.get('/api/admin/trash',admin,(req,res)=>res.json({works:db.trash || [],retentionDays:TRASH_DAYS}));
app.post('/api/admin/trash/:id/restore',admin,(req,res)=>{try{save(restoreWork(db,req.params.id));res.json({ok:true});}catch(error){res.status(404).json({error:error.message});}});
async function removeUnusedFiles(urls) {
  const referenced=referencedFiles(db);let pending=false;
  for(const url of new Set(urls))if(url?.startsWith('/uploads/')&&!referenced.has(url.slice(1))) {try{await storage.remove(url.slice(1));}catch{pending=true;}}
  return pending;
}
async function purgeWork(id) {
  const work=(db.trash || []).find(item=>item.id===id);if(!work)throw Error('回收站中没有这幅作品');
  save({...db,trash:db.trash.filter(item=>item.id!==id)});
  return removeUnusedFiles([work.image,work.preview]);
}
app.delete('/api/admin/trash/:id',admin,async(req,res)=>{
  if(req.body.confirm!==true)return res.status(400).json({error:'请确认永久删除，删除后无法恢复'});
  try{res.json({ok:true,cleanupPending:await purgeWork(req.params.id)});}catch(error){res.status(404).json({error:error.message});}
});
const replacing=new Set();
app.post('/api/works/:id/image',admin,upload.single('photo'),async(req,res)=>{
  const work=db.works.find(item=>item.id===req.params.id);
  if(!work)return res.status(404).json({error:'作品不存在'});
  if(!req.file)return res.status(400).json({error:'请选择替换图片'});
  if(replacing.has(work.id))return res.status(409).json({error:'这幅作品正在替换，请稍后重试'});
  replacing.add(work.id);let prepared,switched=false;
  try {
    prepared=await prepareWorkImages(req.file.buffer,work.kind,storage);
    const current=db.works.find(item=>item.id===work.id);
    if(!current||current.image!==work.image){res.status(409).json({error:'作品已发生变化，请刷新后重试'});return;}
    const updated={...current,...prepared,demo:false};
    if(current.demo)for(const key of ['credit','source','licenseUrl'])delete updated[key];
    save({...db,works:db.works.map(item=>item.id===work.id?updated:item)});switched=true;
    const cleanupPending=await removeUnusedFiles([work.image,work.preview]);
    res.json({work:updated,cleanupPending});
  } catch {res.status(400).json({error:'替换未完成。请检查图片格式、全景比例和存储连接；原图片仍保留。'});}
  finally {if(prepared&&!switched)await removeUnusedFiles([prepared.image,prepared.preview]);replacing.delete(work.id);}
});
app.put('/api/settings', admin, (req, res) => {
  const body = req.body;
  let protection;
  try { protection = parseProtection(body, db.settings); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (!text(body.name, 40)) return res.status(400).json({ error: '请填写网站名称' });
  const email = text(body.email, 150);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  const coverWorkId = body.coverWorkId === undefined ? (db.settings.coverWorkId || '') : text(body.coverWorkId, 80);
  if (coverWorkId && !db.works.some(work => work.id === coverWorkId && work.kind === 'photo')) return res.status(400).json({ error: '请选择现有的普通照片作为首页封面' });
  const shareCoverWorkId=body.shareCoverWorkId===undefined?(db.settings.shareCoverWorkId || ''):text(body.shareCoverWorkId,80);
  if(shareCoverWorkId&&!db.works.some(work=>work.id===shareCoverWorkId&&published(work)))return res.status(400).json({error:'分享封面请选择已发布作品'});
  const footer = Object.fromEntries([['homeIntro', 180], ['xiaohongshuUrl', 500], ['vcgUrl', 500], ['tuchongUrl', 500], ['icpNumber', 60], ['policeNumber', 60]].map(([key, max]) => [key, text(body[key] ?? db.settings[key], max)]));
  for (const key of ['vcgUrl','tuchongUrl']) if (footer[key] && !validSocialURL(footer[key])) return res.status(400).json({error:'请填写有效的 HTTPS 图库主页链接'});
  if (footer.xiaohongshuUrl && !validSocialURL(footer.xiaohongshuUrl)) return res.status(400).json({ error: '请填写有效的 HTTPS 小红书主页链接' });
  if (footer.icpNumber && !/^[\u4e00-\u9fff]ICP备\d{6,20}号(?:-\d+)?$/.test(footer.icpNumber)) return res.status(400).json({ error: '请填写完整 ICP 备案号，例如：沪ICP备2025140939号-1' });
  if (footer.policeNumber && !/^[\u4e00-\u9fff]+公网安备\s*\d{14}\s*号$/.test(footer.policeNumber)) return res.status(400).json({ error: '请填写完整公安备案号，包含 14 位数字和末尾的“号”' });
  save({ ...db, settings: { ...db.settings, name: text(body.name, 40), subtitle: text(body.subtitle, 60), headline: text(body.headline ?? db.settings.headline, 100), coverWorkId, shareCoverWorkId, bio: text(body.bio, 1500), email, wechat: text(body.wechat, 80), ...footer, ...protection } });
  res.json(db.settings);
});
app.post('/api/password', admin, (req, res) => {
  const { current, password } = req.body;
  if (typeof current !== 'string' || current.length > 128 || !timingSafeEqual(Buffer.from(auth.hash, 'hex'), scryptSync(current, auth.salt, 64))) return res.status(400).json({ error: '当前密码不正确' });
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) return res.status(400).json({ error: '新密码需要 12～128 个字符' });
  setPassword(password); sessions.clear(); session(req, res); res.json({ ok: true });
});
async function deliverImage(res,buffer,format,allowed=()=>true) {
  const type=format==='webp'?'image/webp':'image/jpeg';
  const key=createHash('sha256').update(buffer).digest('hex')+'.'+format;
  const url=await storage.deliveryURL(key,buffer,type,res.req.method==='HEAD'?'HEAD':'GET');
  if(!allowed())return res.sendStatus(404);
  if(url)return res.redirect(302,url);
  res.type(type).send(buffer);
}
app.get('/api/panorama/:id',(req,res)=>{
 const work=db.works.find(w=>w.id===req.params.id&&w.kind==='panorama'&&published(w));
 if(!work)return res.sendStatus(404);res.json(panoramaConfig(work));
});
app.get('/panorama/:id/:level/:face/:x/:tile',async(req,res)=>{
 res.set('Cache-Control','private, no-store');
 const work=db.works.find(w=>w.id===req.params.id&&w.kind==='panorama'&&published(w));
 if(!work||!/^\d+\.webp$/.test(req.params.tile))return res.sendStatus(404);
 const settings=protectionSettings(db.settings),same=()=>db.works.some(w=>w.id===work.id&&w.image===work.image&&published(w))&&JSON.stringify(protectionSettings(db.settings))===JSON.stringify(settings);
 try{const buffer=await tileImage(work,settings,{level:Number(req.params.level),face:req.params.face,x:Number(req.params.x),y:Number(req.params.tile.split('.')[0])});if(!same())return res.sendStatus(404);await deliverImage(res,buffer,'webp',same);}catch(error){res.sendStatus(error.message==='INVALID_TILE'?404:503);}
});
app.get('/media/:id/:variant', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const work = db.works.find(w => w.id === req.params.id && published(w));
  if (!work || !['image.jpg', 'preview.jpg', 'image.webp'].includes(req.params.variant)) return res.sendStatus(404);
  const width = req.query.w === undefined ? 0 : Number(req.query.w);
  if (req.query.w !== undefined && !['480', '960'].includes(req.query.w)) return res.sendStatus(400);
  if (width && work.kind === 'panorama' && req.params.variant.startsWith('image.')) return res.sendStatus(400);
  const settings = protectionSettings(db.settings);
  res.vary('Accept');
  try {
    const webp = await displayImage(work, req.params.variant.split('.')[0], settings, width);
    // Old clients receive JPEG without retaining another disk copy.
    const format = req.params.variant.endsWith('.webp') ? 'webp' : req.accepts(['image/webp', 'image/jpeg']) === 'image/webp' && /image\/webp/i.test(req.get('Accept') || '') ? 'webp' : 'jpg';
    const content = format === 'webp' ? webp : await sharp(webp).jpeg({ quality: 90 }).toBuffer();
    if (!db.works.some(w => w.id === work.id && published(w))) return res.sendStatus(404);
    if (JSON.stringify(settings) !== JSON.stringify(protectionSettings(db.settings))) return res.sendStatus(503);
    await deliverImage(res,content,format,()=>db.works.some(w=>w.id===work.id&&w.image===work.image&&published(w)) && JSON.stringify(settings)===JSON.stringify(protectionSettings(db.settings)));
  } catch { res.status(503).send('图片暂时无法显示，请稍后重试'); }
});
const publicOrigin = req => {
  const url = new URL(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('网站公开地址无效');
  return url.origin;
};
app.get('/api/page-share',(req,res)=>{
  const value=pageShare(db,publicOrigin(req),typeof req.query.series==='string'?req.query.series:'');
  if(!value)return res.sendStatus(404);res.json(value.info);
});
let pageShareJobs=0;
async function pageShareAsset(req,res){
  res.set('Cache-Control','private, no-store');
  const origin=publicOrigin(req),seriesId=req.params.id || '',value=pageShare(db,origin,seriesId);
  if(!value||!['card.jpg','poster.jpg','qr.svg'].includes(req.params.asset))return res.sendStatus(404);
  if(pageShareJobs>=4)return res.sendStatus(503);pageShareJobs++;
  const settings=protectionSettings(db.settings),same=()=>JSON.stringify(pageShare(db,origin,seriesId))===JSON.stringify(value)&&JSON.stringify(protectionSettings(db.settings))===JSON.stringify(settings);
  try {
    if(req.params.asset==='qr.svg'){const svg=await qrImage(value.info.url);if(!same())return res.sendStatus(404);return res.type('svg').send(svg);}
    const source=value.cover?await displayImage(value.cover,'preview',{...settings,watermark:'on'}):null;
    const buffer=await pageShareArtwork(settings,value,source,req.params.asset==='poster.jpg');
    await deliverImage(res,buffer,'jpg',same);
  }catch{res.status(503).send('分享封面暂时无法显示，请稍后重试');}
  finally{pageShareJobs--;}
}
app.get('/share/site/:asset',pageShareAsset);
app.get('/share/series/:id/:asset',pageShareAsset);
app.get('/api/share/:id', (req,res) => {
  const work = db.works.find(w => w.id === req.params.id && published(w));
  if (!work) return res.sendStatus(404);
  res.json(shareInfo(work, db.settings, publicOrigin(req)));
});
app.get('/work/:id', (req,res) => {
  res.set('Cache-Control', 'private, no-store');
  const work = db.works.find(w => w.id === req.params.id && published(w));
  if (!work) return res.status(404).type('html').send(renderPublicPage('notfound', db.settings));
  res.type('html').send(renderPublicPage('work', db.settings, work, shareInfo(work,db.settings,publicOrigin(req)), { origin: publicOrigin(req), db }));
});
let shareJobs = 0;
app.get('/work/:id/:asset', async (req,res) => {
  res.set('Cache-Control','private, no-store');
  const work = db.works.find(w => w.id === req.params.id && published(w));
  if (!work || !['card.jpg','poster.jpg','qr.svg'].includes(req.params.asset)) return res.sendStatus(404);
  if (shareJobs >= 4) return res.status(503).send('分享图片正在准备，请稍后重试');
  shareJobs++;
  const settings = protectionSettings(db.settings);
  try {
    const info = shareInfo(work, settings, publicOrigin(req));
    let content;
    if (req.params.asset === 'qr.svg') content = await qrImage(info.url);
    else {
      const source = await displayImage(work, 'preview', {...settings,watermark:'on'});
      content = await shareArtwork(work,settings,info,source,req.params.asset === 'poster.jpg');
    }
    if (!db.works.some(w => w.id === work.id && published(w))) return res.sendStatus(404);
    if (JSON.stringify(settings) !== JSON.stringify(protectionSettings(db.settings))) return res.sendStatus(503);
    if(req.params.asset.endsWith('.svg'))res.type('svg').send(content);
    else await deliverImage(res,content,'jpg',()=>db.works.some(w=>w.id===work.id&&w.image===work.image&&published(w)) && JSON.stringify(settings)===JSON.stringify(protectionSettings(db.settings)));
  } catch { res.status(503).send('分享图片生成失败，请稍后重试'); }
  finally { shareJobs--; }
});
app.use('/uploads', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const url = '/uploads' + req.path;
  if (![...db.works,...(db.trash || [])].some(work => (work.image === url || work.preview === url) && isAdmin(req))) return res.sendStatus(404);
  try {res.type(path.extname(url)).send(await storage.read(url.slice(1)));}catch {res.sendStatus(503);}
});
app.use('/vendor/pannellum', express.static(path.join(root, 'node_modules/pannellum/build'), { maxAge: '1d' }));
app.get('/admin', (req, res) => res.sendFile(path.join(root, 'public/admin.html')));
for (const [route, page] of [['/', 'home'], ['/works', 'works'], ['/panoramas', 'panoramas'], ['/about', 'about']]) {
  app.get(route, (req, res) => res.type('html').send(renderPublicPage(page, db.settings, undefined, undefined, { origin: publicOrigin(req), db, query: req.query })));
}
app.get('/series/:id', (req,res) => {
  const series = publicSeries(db).find(item=>item.id===req.params.id);
  if (!series) return res.status(404).type('html').send(renderPublicPage('notfound',db.settings));
  res.type('html').send(renderPublicPage('series',db.settings,undefined,undefined,{origin:publicOrigin(req),db,series,query:{...req.query,series:series.id}}));
});
app.get('/robots.txt', (req,res) => res.type('text').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /uploads/\nSitemap: ${publicOrigin(req)}/sitemap.xml\n`));
app.get('/sitemap.xml', (req,res) => {
  const urls = ['/', '/works', '/panoramas', '/about', ...(journalEntries(db).length?['/journal',...journalEntries(db).map(entry=>'/journal/'+encodeURIComponent(entry.id))]:[]), ...db.works.filter(published).map(work=>'/work/'+encodeURIComponent(work.id)), ...publicSeries(db).map(series=>'/series/'+encodeURIComponent(series.id))];
  const escape = value => value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(url=>'<url><loc>'+escape(publicOrigin(req)+url)+'</loc></url>').join('')+'</urlset>');
});
app.use(express.static(path.join(root, 'public'), { maxAge: 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((req,res) => res.status(404).type('html').send(renderPublicPage('notfound',db.settings)));
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 200 MB' : '上传内容不符合要求，请每次选择一张照片' });
  if (error.type === 'entity.too.large' || error instanceof SyntaxError) return res.status(400).json({ error: '请求内容无效或过大' });
  // SDK errors may contain signed URLs or credentials; never echo/log the raw error.
  console.error('请求失败:', error instanceof multer.MulterError ? 'upload' : 'storage-or-server'); res.status(500).json({ error: '保存失败，请检查存储连接和可用空间后重试' });
});
// Fill dimensions for older libraries once, sharing reads when demo works reuse a source.
const dimensions = new Map();
let dimensionsChanged = false;
for (const work of db.works) {
  if (work.width && work.height || !work.image?.startsWith('/uploads/')) continue;
  const source = path.join(uploads, path.basename(work.image));
  if (!dimensions.has(source)) dimensions.set(source, await storage.read(work.image.slice(1)).then(buffer=>sharp(buffer).metadata()).catch(() => null));
  const meta = dimensions.get(source);
  if (meta?.width && meta?.height) {
    const rotated = [5, 6, 7, 8].includes(meta.orientation);
    work.width = rotated ? meta.height : meta.width; work.height = rotated ? meta.width : meta.height;
    dimensionsChanged = true;
  }
}
if (dimensionsChanged) save(db);
const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
const httpServer = app.listen(port, host, () => console.log(`摄影作品集已启动：http://${host}:${port}\n中文后台：http://${host}:${port}/admin`));
// Allow large uploads over slower connections (Node defaults to five minutes).
httpServer.requestTimeout = 20 * 60 * 1000;
backups.listen();
async function cleanExpiredTrash(){
  if(exporting||maintenance||activeWrites)return;
  maintenance=true;
  try{for(const work of expiredTrash(db))await purgeWork(work.id);}catch{console.error('回收站清理未完成，稍后重试');}
  finally{maintenance=false;}
}
setInterval(cleanExpiredTrash,3600000).unref();
await cleanExpiredTrash();
