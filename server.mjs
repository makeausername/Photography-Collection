import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const uploads = path.join(dataDir, 'uploads');
mkdirSync(uploads, { recursive: true });
const dbPath = path.join(dataDir, 'portfolio.json');
const authPath = path.join(dataDir, 'admin.json');
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
function writeJSON(file, value) {
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
let db = existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : {
  settings: { name: '光屿', subtitle: '摄影作品集', headline: '看见，\n那些安静的瞬间。', bio: '', email: '', wechat: '' }, works: []
};
let auth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, 'utf8')) : null;
const save = next => { writeJSON(dbPath, next); db = next; };
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
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (!origin || origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: '请求来源无效，请从本站页面操作' });
  }
  next();
});
app.use(express.json({ limit: '64kb' }));
app.get('/api/portfolio', (req, res) => res.json(db));
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
function workFields(body) {
  const title = text(body.title, 80), category = text(body.category, 40);
  if (!title || !category) throw new Error('请填写作品标题和分类');
  return { title, category, description: text(body.description, 1500), location: text(body.location, 100), year: text(body.year, 20) };
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024, files: 1, fields: 12 } });
app.post('/api/works', admin, upload.single('photo'), async (req, res, next) => {
  let image, preview;
  try {
    const fields = workFields(req.body);
    if (!req.file) return res.status(400).json({ error: '请选择照片' });
    const kind = req.body.kind === 'panorama' ? 'panorama' : 'photo';
    const meta = await sharp(req.file.buffer, { limitInputPixels: 160000000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) return res.status(400).json({ error: '请上传静态 JPG、PNG 或 WebP 图片' });
    const rotated = [5, 6, 7, 8].includes(meta.orientation);
    const ratio = rotated ? meta.height / meta.width : meta.width / meta.height;
    if (kind === 'panorama' && Math.abs(ratio - 2) > 0.03) return res.status(400).json({ error: '360° 全景需要宽高比为 2:1 的完整球形全景图，请先在相机软件中拼接导出' });
    const id = randomUUID(); image = `${id}.jpg`; preview = `${id}-preview.jpg`;
    const pipeline = sharp(req.file.buffer, { limitInputPixels: 160000000 }).rotate();
    await pipeline.clone().resize({ width: kind === 'panorama' ? 8192 : 2800, withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(path.join(uploads, image));
    await pipeline.clone().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(uploads, preview));
    const work = { id, ...fields, kind, image: `/uploads/${image}`, preview: `/uploads/${preview}`, demo: false, createdAt: new Date().toISOString() };
    save({ ...db, works: [work, ...db.works] }); res.status(201).json(work);
  } catch (error) {
    for (const file of [image, preview].filter(Boolean)) { try { unlinkSync(path.join(uploads, file)); } catch {} }
    if (/标题|分类|Input|image|pixel|buffer|unsupported|corrupt/i.test(error.message)) return res.status(400).json({ error: /标题|分类/.test(error.message) ? error.message : '图片无法读取或像素过大，请导出为 JPG 后重试（最大 1.6 亿像素）' });
    next(error);
  }
});
app.put('/api/works/:id', admin, (req, res) => {
  const work = db.works.find(x => x.id === req.params.id);
  if (!work) return res.status(404).json({ error: '作品不存在' });
  try { const updated = { ...work, ...workFields(req.body) }; save({ ...db, works: db.works.map(w => w.id === work.id ? updated : w) }); res.json(updated); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/works/:id/first', admin, (req, res) => {
  const index = db.works.findIndex(x => x.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '作品不存在' });
  save({ ...db, works: [db.works[index], ...db.works.filter((_, i) => i !== index)] }); res.json({ ok: true });
});
app.delete('/api/works/:id', admin, (req, res) => {
  const work = db.works.find(x => x.id === req.params.id);
  if (!work) return res.status(404).json({ error: '作品不存在' });
  save({ ...db, works: db.works.filter(x => x.id !== work.id) });
  for (const url of [work.image, work.preview]) if (url?.startsWith('/uploads/')) { try { unlinkSync(path.join(uploads, path.basename(url))); } catch {} }
  res.json({ ok: true });
});
app.put('/api/settings', admin, (req, res) => {
  const body = req.body;
  if (!text(body.name, 40)) return res.status(400).json({ error: '请填写网站名称' });
  const email = text(body.email, 150);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  save({ ...db, settings: { name: text(body.name, 40), subtitle: text(body.subtitle, 60), headline: text(body.headline, 100), bio: text(body.bio, 1500), email, wechat: text(body.wechat, 80) } });
  res.json(db.settings);
});
app.post('/api/password', admin, (req, res) => {
  const { current, password } = req.body;
  if (typeof current !== 'string' || current.length > 128 || !timingSafeEqual(Buffer.from(auth.hash, 'hex'), scryptSync(current, auth.salt, 64))) return res.status(400).json({ error: '当前密码不正确' });
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) return res.status(400).json({ error: '新密码需要 12～128 个字符' });
  setPassword(password); sessions.clear(); session(req, res); res.json({ ok: true });
});
app.use('/uploads', express.static(uploads, { dotfiles: 'deny', immutable: true, maxAge: '1y' }));
app.use('/vendor/pannellum', express.static(path.join(root, 'node_modules/pannellum/build'), { maxAge: '1d' }));
app.get('/admin', (req, res) => res.sendFile(path.join(root, 'public/admin.html')));
app.use(express.static(path.join(root, 'public'), { maxAge: 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 64 MB' : '上传内容不符合要求，请每次选择一张照片' });
  if (error.type === 'entity.too.large' || error instanceof SyntaxError) return res.status(400).json({ error: '请求内容无效或过大' });
  console.error('请求失败:', error.message); res.status(500).json({ error: '保存失败，请检查服务器存储空间后重试' });
});
const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`摄影作品集已启动：http://${host}:${port}\n中文后台：http://${host}:${port}/admin`));
