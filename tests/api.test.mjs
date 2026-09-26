import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
const root = path.resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:4187';
const password = randomBytes(24).toString('hex');
let server, cookie, dir;
async function start() {
  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dir, PORT: '4187', HOST: '127.0.0.1', ADMIN_PASSWORD: '', TRUST_PROXY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('测试服务器启动超时')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('exit', code => { clearTimeout(timer); reject(Error('启动失败 ' + code)); }); server.once('error', reject); });
}
async function stop() { if (!server || server.exitCode !== null) return; const done = new Promise(resolve => server.once('exit', resolve)); server.kill(); await done; }
function request(url, method = 'GET', body, authenticated = true, origin = base) { return fetch(base + url, { method, headers: { ...(method !== 'GET' ? { Origin: origin } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(authenticated && cookie ? { Cookie: cookie } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); }
test('中文后台上传、访问控制、持久化及删除', async t => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'photo-portfolio-test-')); await start(); t.after(stop);
  await t.test('首次设置与登录保护', async () => {
    assert.equal((await request('/api/session').then(r => r.json())).setupRequired, true);
    assert.equal((await request('/api/settings', 'PUT', { name: '非法修改' }, false)).status, 401);
    assert.equal((await request('/api/setup', 'POST', { password }, false, 'https://example.com')).status, 403);
    assert.equal((await request('/api/setup', 'POST', { password: 'short' }, false)).status, 400);
    const result = await request('/api/setup', 'POST', { password }, false); assert.equal(result.status, 200); cookie = result.headers.get('set-cookie').split(';')[0];
    assert.match(result.headers.get('set-cookie'), /HttpOnly/); assert.match(result.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal((await request('/api/setup', 'POST', { password }, false)).status, 409);
    assert.equal((await request('/data/admin.json')).status, 404);
    assert.equal((await request('/api/login', 'POST', { password: 'incorrect' }, false)).status, 401);
  });
  let photo, pano;
  const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#416d52' } }).jpeg().toBuffer();
  const eq = await sharp({ create: { width: 2048, height: 1024, channels: 3, background: '#5686ac' } }).jpeg().toBuffer();
  function form(buffer, kind) { const f = new FormData(); f.set('photo', new Blob([buffer], { type: 'image/jpeg' }), '测试.jpg'); f.set('title', '中文作品'); f.set('category', '测试分类'); f.set('kind', kind); return f; }
  await t.test('验证图片格式及全景比例', async () => {
    assert.equal((await request('/api/works', 'POST', form(jpeg, 'photo'), false)).status, 401);
    assert.equal((await request('/api/works', 'POST', form(jpeg, 'panorama'))).status, 400);
    assert.equal((await request('/api/works', 'POST', form(Buffer.from('<script>bad</script>'), 'photo'))).status, 400);
    const result = await request('/api/works', 'POST', form(jpeg, 'photo')); assert.equal(result.status, 201); photo = await result.json();
    const pr = await request('/api/works', 'POST', form(eq, 'panorama')); assert.equal(pr.status, 201); pano = await pr.json();
    assert.equal((await request(photo.image)).status, 200); assert.equal((await request(pano.preview)).status, 200);
  });
  await t.test('编辑信息、顺序、网站名称', async () => {
    const edited = await request('/api/works/' + photo.id, 'PUT', { title: '<img src=x onerror=alert(1)>', category: '中文分类', description: '描述\n第二行', location: '测试地点' }); assert.equal(edited.status, 200);
    assert.equal((await request(`/api/works/${photo.id}/first`, 'POST', {})).status, 200);
    assert.equal((await request('/api/settings', 'PUT', { name: '测试摄影师', headline: '中文标题', email: 'invalid' })).status, 400);
    assert.equal((await request('/api/settings', 'PUT', { name: '测试摄影师', headline: '中文标题', bio: '个人介绍' })).status, 200);
    const data = await request('/api/portfolio').then(r => r.json()); assert.equal(data.works[0].id, photo.id); assert.equal(data.settings.name, '测试摄影师');
    assert.equal((await request('/api/settings', 'PUT', { name: '恶意网站' }, true, 'https://example.com')).status, 403);
  });
  await t.test('重启后作品与密码仍保留，旧会话失效', async () => {
    await stop(); await start();
    const data = await request('/api/portfolio').then(r => r.json()); assert.equal(data.works.length, 2); assert.equal(data.settings.name, '测试摄影师');
    assert.equal((await request('/api/settings', 'PUT', { name: '未授权' })).status, 401);
    const result = await request('/api/login', 'POST', { password }, false); assert.equal(result.status, 200); cookie = result.headers.get('set-cookie').split(';')[0];
    assert.ok(!(await readFile(path.join(dir, 'admin.json'), 'utf8')).includes(password));
  });
  await t.test('删除图片并阻止注销后修改', async () => {
    assert.equal((await request('/api/works/' + photo.id, 'DELETE')).status, 200);
    assert.equal((await request(photo.image)).status, 404); assert.equal((await readdir(path.join(dir, 'uploads'))).length, 2);
    assert.equal((await request('/api/logout', 'POST', {})).status, 200);
    assert.equal((await request('/api/works/' + pano.id, 'DELETE')).status, 401);
  });
});
