import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
const root = path.resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:4187';
const password = randomBytes(24).toString('hex');
let server, cookie, dir;
async function start() {
  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dir, PORT: '4187', HOST: '127.0.0.1', ADMIN_PASSWORD: '', TRUST_PROXY: '', STORAGE_PROVIDER:'local', BACKUP_DIR:'', PUBLIC_BASE_URL:'' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('测试服务器启动超时')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('exit', code => { clearTimeout(timer); reject(Error('启动失败 ' + code)); }); server.once('error', reject); });
}
async function stop() { if (!server || server.exitCode !== null) return; const done = new Promise(resolve => server.once('exit', resolve)); server.kill(); await done; }
function request(url, method = 'GET', body, authenticated = true, origin = base) { return fetch(base + url, { method, headers: { ...(method !== 'GET' ? { Origin: origin } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(authenticated && cookie ? { Cookie: cookie } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); }
test('中文后台上传、访问控制、持久化及删除', async t => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'photo-portfolio-test-')); await start(); t.after(stop);
  await t.test('公共页面可直接访问且仅包含对应栏目', async () => {
    for (const [route, section] of [['/works', 'works'], ['/panoramas', 'panoramas'], ['/about', 'about']]) {
      const response = await request(route, 'GET', undefined, false);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, new RegExp(`<section id="${section}"`));
      assert.equal((html.match(/<h1\b/g) || []).length, 1);
      assert.match(html, new RegExp(`href="${route}" aria-current="page"`));
      assert.ok(!html.includes('{{'));
      for (const other of ['works', 'panoramas', 'about'].filter(name => name !== section)) {
        assert.ok(!html.includes(`<section id="${other}"`));
      }
    }
    const home = await request('/').then(r => r.text());
    for (const section of ['works', 'panoramas', 'about']) assert.ok(home.includes(`<section id="${section}"`));
    assert.equal((await request('/missing-page')).status, 404);
  });
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
  function form(buffer, kind) { const f = new FormData(); f.set('photo', new Blob([buffer], { type: 'image/jpeg' }), '测试.jpg'); f.set('title', '中文作品'); f.set('category', '测试分类'); f.set('kind', kind); f.set('status', 'published'); f.set('allowDuplicate', 'true'); return f; }
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
  await t.test('页脚备案直接输出、链接安全与设置清空', async () => {
    const settings = (await request('/api/portfolio').then(r => r.json())).settings;
    const configured = { ...settings, icpNumber: '沪ICP备2025140939号-1', policeNumber: '沪公网安备31000000000000号', homeIntro: '<script>test</script>', xiaohongshuUrl: 'https://www.xiaohongshu.com/user/profile/demo' };
    for (const fields of [{ xiaohongshuUrl: 'javascript:alert(1)' }, { xiaohongshuUrl: 'https://user:password@example.com/' }, { icpNumber: '<img src=x>' }, { policeNumber: '沪公网安备123号' }]) {
      assert.equal((await request('/api/settings', 'PUT', { ...configured, ...fields })).status, 400);
    }
    assert.equal((await request('/api/settings', 'PUT', configured)).status, 200);
    for (const route of ['/', '/works', '/panoramas', '/about']) {
      const html = await request(route).then(r => r.text());
      assert.match(html, /href="https:\/\/beian.miit.gov.cn\/" target="_blank" rel="noopener noreferrer">沪ICP备2025140939号-1<\/a>/);
      assert.match(html, /https:\/\/beian.mps.gov.cn\/#\/query\/webSearch\?code=31000000000000/);
      assert.match(html, /src="\/beian-police.png"/);
      assert.ok(!html.includes('href="/admin"'));
      assert.ok(!html.includes('<script>test</script>'));
      if (route === '/') assert.match(html, /&lt;script&gt;test&lt;\/script&gt;/);
    }
    assert.equal((await request('/beian-police.png')).headers.get('content-type'), 'image/png');
    await stop(); await start();
    assert.match(await request('/').then(r => r.text()), /沪ICP备2025140939号-1/);
    const result = await request('/api/login', 'POST', { password }, false);
    cookie = result.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/settings', 'PUT', { ...settings, icpNumber: '', policeNumber: '', homeIntro: '', xiaohongshuUrl: '' })).status, 200);
    assert.ok(!(await request('/').then(r => r.text())).includes('class="footer-filing"'));
  });
  await t.test('封面独立指定、校验与持久化', async () => {
    const settings = (await request('/api/portfolio').then(r => r.json())).settings;
    assert.equal((await request('/api/settings', 'PUT', { ...settings, coverWorkId: pano.id })).status, 400);
    assert.equal((await request('/api/settings', 'PUT', { ...settings, coverWorkId: 'missing' })).status, 400);
    assert.equal((await request('/api/settings', 'PUT', { ...settings, coverWorkId: photo.id })).status, 200);
    await request(`/api/works/${pano.id}/first`, 'POST', {});
    let data = await request('/api/portfolio').then(r => r.json());
    assert.equal(data.works[0].id, pano.id);
    assert.equal(data.settings.coverWorkId, photo.id);
    await stop(); await start();
    data = await request('/api/portfolio').then(r => r.json());
    assert.equal(data.settings.coverWorkId, photo.id);
    const result = await request('/api/login', 'POST', { password }, false);
    cookie = result.headers.get('set-cookie').split(';')[0];
  });
  await t.test('草稿隔离、批量修改、发布和上传重试', async () => {
    assert.equal((await request('/api/admin/portfolio', 'GET', undefined, false)).status, 401);
    const f = form(jpeg, 'photo'); f.delete('status'); f.set('uploadId', '11111111-1111-4111-8111-111111111111');
    const created = await request('/api/works','POST',f).then(r=>r.json());
    assert.equal(created.status,'draft');
    assert.equal((await request('/api/works','POST',f).then(r=>r.json())).id,created.id);
    const pub = await request('/api/portfolio','GET',undefined,false).then(r=>r.json());
    assert.ok(!pub.works.some(w=>w.id===created.id));
    assert.equal((await request(created.image,'GET',undefined,false)).status,404);
    assert.equal((await request(created.preview,'GET',undefined,false)).status,404);
    assert.equal((await request(created.image)).status,200);
    assert.equal((await request(created.image)).headers.get('cache-control'),'private, no-store');
    const adminData = await request('/api/admin/portfolio').then(r=>r.json());
    assert.ok(adminData.works.some(w=>w.id===created.id));
    const batch = {ids:[photo.id,created.id],changes:{category:'星空银河',location:'四川 · 牛背山'}};
    assert.equal((await request('/api/works/batch','PATCH',batch,false)).status,401);
    assert.equal((await request('/api/works/batch','PATCH',{...batch,ids:[photo.id,'missing']})).status,404);
    assert.equal((await request('/api/works/batch','PATCH',{...batch,changes:{category:''}})).status,400);
    assert.equal((await request('/api/works/batch','PATCH',{...batch,changes:{status:'unknown'}})).status,400);
    assert.equal((await request('/api/works/batch','PATCH',{...batch,changes:{title:'不允许'}})).status,400);
    assert.equal((await request('/api/works/batch','PATCH',batch)).status,200);
    let data=await request('/api/admin/portfolio').then(r=>r.json());
    assert.equal(data.works.find(w=>w.id===photo.id).title,'<img src=x onerror=alert(1)>');
    assert.equal(data.works.find(w=>w.id===created.id).category,'星空银河');
    assert.equal((await request('/api/works/batch','PATCH',{ids:[created.id],changes:{status:'published'}})).status,200);
    assert.ok((await request('/api/portfolio','GET',undefined,false).then(r=>r.json())).works.some(w=>w.id===created.id));
    assert.equal((await request(created.image,'GET',undefined,false)).status,404);
    const displayURL = `/media/${created.id}/image.jpg`;
    assert.equal((await request(displayURL,'GET',undefined,false)).status,200);
    await request('/api/works/batch','PATCH',{ids:[photo.id,created.id],changes:{status:'draft',location:''}});
    assert.equal((await request(displayURL,'GET',undefined,false)).status,404);
    assert.equal((await request('/api/portfolio').then(r=>r.json())).settings.coverWorkId,'');
    await stop(); await start();
    const login=await request('/api/login','POST',{password},false);cookie=login.headers.get('set-cookie').split(';')[0];
    data=await request('/api/admin/portfolio').then(r=>r.json());
    assert.equal(data.works.find(w=>w.id===created.id).status,'draft');
    assert.equal(data.works.find(w=>w.id===photo.id).location,'');
    assert.equal((await request(created.image,'GET',undefined,false)).status,404);
    await request('/api/works/'+created.id,'DELETE');
  });
  await t.test('展示图水印、源文件隔离、尺寸和设置生效', async () => {
    const settings = (await request('/api/admin/portfolio').then(r => r.json())).settings;
    assert.equal(settings.watermark, 'on');
    for (const patch of [{displayMax: 9000}, {watermark: 'bad'}, {watermarkOpacity: 0}, {watermarkPosition: 'top'}, {copyrightNotice: {}}]) {
      assert.equal((await request('/api/settings', 'PUT', {...settings, ...patch})).status, 400);
    }
    const portrait = await sharp({create:{width:1800,height:3200,channels:3,background:'#456789'}}).jpeg().toBuffer();
    const added = await request('/api/works','POST',form(portrait,'photo')).then(r=>r.json());
    const source = path.join(dir,'uploads',path.basename(added.image));
    const before = await readFile(source);
    const pub = await request('/api/portfolio','GET',undefined,false).then(r=>r.json());
    const visible = pub.works.find(w=>w.id===added.id);
    assert.ok(!JSON.stringify(pub).includes('/uploads/'));
    assert.equal((await request(added.image,'GET',undefined,false)).status,404);
    assert.equal((await request(added.preview,'GET',undefined,false)).status,404);
    const response = await request(visible.image,'GET',undefined,false);
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'private, no-store');
    const marked = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(marked).metadata(); assert.equal(meta.height,2400); assert.ok(meta.width<2400);
    const thumb = await request(visible.preview,'GET',undefined,false).then(r=>r.arrayBuffer());
    assert.equal((await sharp(Buffer.from(thumb)).metadata()).height,1200);
    assert.equal((await request('/api/settings','PUT',{...settings,watermark:'off'})).status,200);
    const clean = Buffer.from(await request(visible.image,'GET',undefined,false).then(r=>r.arrayBuffer()));
    assert.notDeepEqual(marked,clean);
    assert.equal((await request('/api/settings','PUT',settings)).status,200);
    assert.deepEqual(Buffer.from(await request(visible.image+'?old=1','GET',undefined,false).then(r=>r.arrayBuffer())),marked);
    assert.deepEqual(await readFile(source),before);
    const panorama = pub.works.find(w=>w.id===pano.id);
    const panoramaMeta = await sharp(Buffer.from(await request(panorama.image,'GET',undefined,false).then(r=>r.arrayBuffer()))).metadata();
    assert.equal(panoramaMeta.width,2048); assert.equal(panoramaMeta.height,1024);
    assert.equal((await request(`/media/${added.id}/original.jpg`,'GET',undefined,false)).status,404);
    await request('/api/works/'+added.id,'DELETE');
    assert.equal((await request(visible.image,'GET',undefined,false)).status,404);
  });
  await t.test('WebP 存储、响应式尺寸、JPEG 兼容和缓存不重复存储', async () => {
    await request('/api/works/batch','PATCH',{ids:[photo.id],changes:{status:'published'}});
    const source = await sharp(await readFile(path.join(dir, 'uploads', path.basename(photo.image)))).metadata();
    assert.equal(source.format, 'webp');
    const adminPreview = await sharp(await readFile(path.join(dir, 'uploads', path.basename(photo.preview)))).metadata();
    assert.equal(adminPreview.format, 'webp'); assert.equal(adminPreview.width, 600);
    const url = `/media/${photo.id}/preview.jpg?w=480`;
    const response = await fetch(base+url,{headers:{Accept:'image/webp,image/jpeg;q=0.8'}});
    assert.equal(response.headers.get('content-type'),'image/webp');
    assert.match(response.headers.get('vary'),/Accept/);
    const webp = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(webp.format,'webp'); assert.equal(webp.width,480);
    const cached = (await readdir(path.join(dir,'display-cache'))).sort();
    const fallback = await fetch(base+url,{headers:{Accept:'image/webp;q=0,image/jpeg'}});
    assert.equal(fallback.headers.get('content-type'),'image/jpeg');
    assert.equal((await sharp(Buffer.from(await fallback.arrayBuffer())).metadata()).width,480);
    assert.deepEqual((await readdir(path.join(dir,'display-cache'))).sort(),cached);
    assert.ok(cached.every(name=>name.endsWith('.webp')));
    assert.equal((await request(`/media/${photo.id}/preview.jpg?w=123`)).status,400);
    assert.equal((await request(`/media/${pano.id}/image.jpg?w=480`)).status,400);
    const panoramaResponse = await fetch(base+`/media/${pano.id}/image.webp`);
    const panorama = await sharp(Buffer.from(await panoramaResponse.arrayBuffer())).metadata();
    assert.equal(panorama.format,'webp'); assert.equal(panorama.width/panorama.height,2);
    await request('/api/works/batch','PATCH',{ids:[photo.id],changes:{status:'draft'}});
    assert.equal((await fetch(base+url,{headers:{Accept:'image/webp'}})).status,404);
  });
  await t.test('精选独立排序、分页搜索、系列、联系设置和服务器渲染链接', async () => {
    const added=[];
    for(let i=1;i<=8;i++){const f=form(jpeg,'photo');f.set('title','分页作品-'+i);f.set('location',i<4?'川西':'青海');f.set('category','云海雾景');added.push(await request('/api/works','POST',f).then(r=>r.json()));}
    const first=await request('/api/library?q='+encodeURIComponent('分页作品')+'&kind=photo').then(r=>r.json());
    assert.equal(first.total,8);assert.equal(first.works.length,6);assert.equal(first.pages,2);
    const second=await request('/api/library?q='+encodeURIComponent('分页作品')+'&page=2').then(r=>r.json());assert.equal(second.works.length,2);assert.ok(second.works.every(w=>!first.works.some(a=>a.id===w.id)));
    const location=await request('/api/library?q='+encodeURIComponent('川西')).then(r=>r.json());assert.equal(location.total,3);
    const ids=added.slice(0,6).map(w=>w.id);
    assert.equal((await request('/api/featured','PUT',{featuredPhotos:ids,featuredPanoramas:[pano.id]},false)).status,401);
    assert.equal((await request('/api/featured','PUT',{featuredPhotos:[...ids,added[6].id],featuredPanoramas:[]})).status,400);
    assert.equal((await request('/api/featured','PUT',{featuredPhotos:ids,featuredPanoramas:[pano.id]})).status,200);
    await request('/api/works/'+added[7].id+'/first','POST',{});
    let site=await request('/api/site').then(r=>r.json());assert.deepEqual(site.photos.map(w=>w.id),ids);assert.ok(site.categories.includes('云海雾景'));assert.ok(!JSON.stringify(site).includes('sourceHash'));assert.ok(!JSON.stringify(site).includes('/uploads/'));
    assert.ok((await request('/').then(r=>r.text())).includes('href="/work/'+ids[0]+'"'));
    const series=await request('/api/series','POST',{title:'沿途 <script>no</script>',description:'一段真实的旅途',status:'published'}).then(r=>r.json());
    assert.equal((await request('/api/works/batch','PATCH',{ids:[ids[0],ids[1],pano.id],changes:{seriesId:series.id}})).status,200);
    assert.equal((await request('/api/library?series='+series.id).then(r=>r.json())).total,2);
    const seriesHTML=await request('/series/'+series.id).then(r=>r.text());assert.ok(seriesHTML.includes('&lt;script&gt;no&lt;/script&gt;'));assert.equal((seriesHTML.match(/<h1\b/g)||[]).length,1);assert.ok(seriesHTML.includes('/work/'+ids[0]));
    const neighbors=await request('/api/work/'+ids[0]+'?series='+series.id).then(r=>r.json());assert.equal(neighbors.total,2);assert.equal(neighbors.previous,ids[1]);
    const settings=(await request('/api/admin/portfolio').then(r=>r.json())).settings;
    assert.equal((await request('/api/settings','PUT',{...settings,email:'test@example.com',vcgUrl:'https://www.vcg.com/example',tuchongUrl:'https://tuchong.com/example',wechat:''})).status,200);
    assert.deepEqual((await request('/api/site').then(r=>r.json())).photos.map(w=>w.id),ids);
    const about=await request('/about').then(r=>r.text());assert.ok(about.includes('mailto:test@example.com'));assert.ok(about.includes('https://www.vcg.com/example'));assert.ok(about.includes('https://tuchong.com/example'));
    const sitemap=await request('/sitemap.xml').then(r=>r.text());assert.ok(sitemap.includes('/series/'+series.id));assert.ok(sitemap.includes('/work/'+ids[0]));
    await request('/api/works/batch','PATCH',{ids:[ids[0]],changes:{status:'draft'}});
    assert.ok(!(await request('/sitemap.xml').then(r=>r.text())).includes('/work/'+ids[0]));assert.ok(!(await request('/api/site').then(r=>r.json())).photos.some(w=>w.id===ids[0]));
    await request('/api/series/'+series.id,'PUT',{title:'沿途',status:'draft'});assert.equal((await request('/series/'+series.id)).status,404);assert.equal((await request('/api/library?series='+series.id)).status,404);
    assert.match(await request('/robots.txt').then(r=>r.text()),/Sitemap:/);
    const missing=await request('/missing-page');assert.equal(missing.status,404);assert.match(await missing.text(),/这一页不在这里了/);
    for(const work of added)await request('/api/works/'+work.id,'DELETE');
    await request('/api/works/batch','PATCH',{ids:[pano.id],changes:{seriesId:''}});
    await request('/api/settings','PUT',settings);
    await request('/api/featured','PUT',{featuredPhotos:[],featuredPanoramas:[]});
  });
  await t.test('封面轮播校验、独立排序、裁切持久化和下架回退', async () => {
    await request('/api/works/batch','PATCH',{ids:[photo.id],changes:{status:'published'}});
    const another=await request('/api/works','POST',form(jpeg,'photo')).then(r=>r.json());
    const slides=[{workId:another.id,x:25,y:70,mobileX:80,mobileY:35},{workId:photo.id,x:50,y:50,mobileX:50,mobileY:50}];
    assert.equal((await request('/api/hero','PUT',{slides},false)).status,401);
    for(const invalid of [[{...slides[0],workId:pano.id}],[slides[0],slides[0]],[{...slides[0],x:101}],[{...slides[0],mobileX:'20'}],Array(6).fill(slides[0]),null]) assert.equal((await request('/api/hero','PUT',{slides:invalid})).status,400);
    for (const playback of [{heroAutoplay:'yes'},{heroAutoplay:false},{heroInterval:2},{heroInterval:31},{heroInterval:7.5},{heroInterval:'bad'}]) assert.equal((await request('/api/hero','PUT',{slides,...playback})).status,400);
    assert.equal((await request('/api/hero','PUT',{slides,heroAutoplay:'off',heroInterval:10})).status,200);
    // Older callers updating only slides must preserve the playback preferences.
    assert.equal((await request('/api/hero','PUT',{slides})).status,200);
    let site=await request('/api/site').then(r=>r.json());assert.deepEqual(site.heroSlides.map(s=>s.work.id),[another.id,photo.id]);assert.equal(site.heroSlides[0].mobileX,80);assert.deepEqual(site.photos,[]);assert.equal(site.settings.heroAutoplay,'off');assert.equal(site.settings.heroInterval,10);
    assert.ok(!JSON.stringify(site.heroSlides).includes('/uploads/'));
    const home=await request('/').then(r=>r.text());assert.ok(!home.includes('hero-previous'));assert.ok(!home.includes('hero-next'));assert.ok(!home.includes('hero-position'));assert.match(home,/id="hero-toggle"/);assert.match(home,/id="photo-count" class="work-count" hidden/);assert.ok(!home.includes('>拖动查看四周。</p>'));assert.match(home,/--hero-mx:80%/);assert.match(home,new RegExp('/media/'+another.id+'/image.jpg'));assert.ok(!home.includes('<img src=x onerror=alert(1)>'));
    await stop();await start();
    const login=await request('/api/login','POST',{password},false);cookie=login.headers.get('set-cookie').split(';')[0];
    const persisted=await request('/api/admin/portfolio').then(r=>r.json());assert.deepEqual(persisted.heroSlides,slides);assert.equal(persisted.settings.heroAutoplay,'off');assert.equal(persisted.settings.heroInterval,10);
    await request('/api/works/batch','PATCH',{ids:[another.id],changes:{status:'draft'}});
    site=await request('/api/site').then(r=>r.json());assert.deepEqual(site.heroSlides.map(s=>s.work.id),[photo.id]);
    assert.equal((await request('/api/hero','PUT',{slides:[slides[0]]})).status,400);
    await request('/api/hero','PUT',{slides:[]});assert.equal((await request('/api/site').then(r=>r.json())).heroSlides.length,1);
    assert.deepEqual((await request('/api/admin/portfolio').then(r=>r.json())).heroSlides,[]);
    await request('/api/works/'+another.id,'DELETE');
  });
  await t.test('重复上传提示、个人照片、空间统计与可还原备份', async () => {
    const duplicate=form(eq,'panorama');duplicate.delete('allowDuplicate');const duplicateResponse=await request('/api/works','POST',duplicate);assert.equal(duplicateResponse.status,409);assert.equal((await duplicateResponse.json()).duplicate.id,pano.id);
    assert.equal((await request('/api/admin/storage','GET',undefined,false)).status,401);assert.equal((await request('/api/admin/backup','GET',undefined,false)).status,401);
    assert.equal((await request('/api/admin/storage/check','POST',{},false)).status,401);
    assert.equal((await request('/api/admin/storage/retry-deletes','POST',{},false)).status,401);
    assert.equal((await request('/api/admin/storage/check','POST',{})).status,200);
    const profile=new FormData();profile.set('photo',new Blob([jpeg],{type:'image/jpeg'}),'profile.jpg');assert.equal((await request('/api/profile-photo','POST',profile)).status,200);
    const publicProfile=await request('/profile.webp','GET',undefined,false);assert.equal(publicProfile.status,200);assert.equal(publicProfile.headers.get('content-type'),'image/webp');
    assert.match(await request('/about').then(r=>r.text()),/class="profile-photo"/);
    const storage=await request('/api/admin/storage').then(r=>r.json());assert.ok(storage.sourceBytes>0);assert.ok(storage.previewBytes>0);assert.ok(storage.cacheLimit>=storage.cacheBytes);
    const exported=await request('/api/admin/backup');assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);
    const backupFile=path.join(dir,'test-backup.tar.gz');await writeFile(backupFile,Buffer.from(await exported.arrayBuffer()));
    const restored=await mkdtemp(path.join(os.tmpdir(),'portfolio-restore-test-'));
    const extraction=spawnSync('tar',['-xzf',backupFile,'-C',restored],{windowsHide:true});assert.equal(extraction.status,0,extraction.stderr.toString());
    const snapshot=JSON.parse(await readFile(path.join(restored,'portfolio.json'),'utf8'));assert.equal(snapshot.works.length,(await request('/api/admin/portfolio').then(r=>r.json())).works.length);
    assert.ok((await readdir(restored)).includes('portfolio.sqlite'));
    assert.equal(storage.database,'sqlite');assert.equal(storage.provider,'local');
    assert.ok(!(await readdir(restored)).includes('admin.json'));assert.ok(!(await readdir(restored)).includes('display-cache'));
    for(const work of snapshot.works)assert.deepEqual(await readFile(path.join(restored,'uploads',path.basename(work.image))),await readFile(path.join(dir,'uploads',path.basename(work.image))));
    assert.deepEqual(await readFile(path.join(restored,'profile.webp')),await readFile(path.join(dir,'profile.webp')));
    assert.equal((await readdir(path.join(dir,'.exports'))).length,0);
  });
  await t.test('独立分享页、卡片尺寸、注入防护与隐藏后撤回', async () => {
    await request('/api/works/batch','PATCH',{ids:[photo.id],changes:{status:'published'}});
    const info = await request('/api/share/'+photo.id,'GET',undefined,false).then(r=>r.json());
    assert.equal(info.url,base+'/work/'+photo.id); assert.equal(info.local,true);
    assert.ok(!JSON.stringify(info).includes('/uploads/'));
    const html = await request('/work/'+photo.id,'GET',undefined,false).then(r=>r.text());
    assert.ok(html.includes('property="og:image"')); assert.ok(html.includes(info.card));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>')); assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    for (const [asset,width,height] of [['card.jpg',1200,630],['poster.jpg',1080,1440]]) {
      const response = await request('/work/'+photo.id+'/'+asset,'GET',undefined,false);
      assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'private, no-store');
      const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.equal(meta.width,width); assert.equal(meta.height,height);
    }
    const qr=await request('/work/'+photo.id+'/qr.svg','GET',undefined,false);
    assert.equal(qr.status,200); assert.match(await qr.text(),/<svg/);
    await request('/api/works/batch','PATCH',{ids:[photo.id],changes:{status:'draft'}});
    for (const url of ['/api/share/'+photo.id,'/work/'+photo.id,'/work/'+photo.id+'/card.jpg','/work/'+photo.id+'/poster.jpg','/work/'+photo.id+'/qr.svg']) assert.equal((await request(url,'GET',undefined,false)).status,404);
  });
  await t.test('替换图片保持链接和资料，失败保留原图', async () => {
    const previous=(await request('/api/admin/portfolio').then(r=>r.json())).works.find(w=>w.id===photo.id);
    const invalid=await request('/api/works/'+photo.id+'/image','POST',form(Buffer.from('invalid'),'photo'));assert.equal(invalid.status,400);
    assert.equal((await request('/api/admin/portfolio').then(r=>r.json())).works.find(w=>w.id===photo.id).image,previous.image);
    assert.equal((await request('/api/works/'+pano.id+'/image','POST',form(jpeg,'photo'))).status,400);
    const changed=await sharp({create:{width:900,height:600,channels:3,background:'#7c3841'}}).jpeg().toBuffer();
    const response=await request('/api/works/'+photo.id+'/image','POST',form(changed,'photo'));assert.equal(response.status,200);
    const replacement=(await response.json()).work;assert.notEqual(replacement.image,previous.image);assert.equal(replacement.id,photo.id);
    for(const key of ['title','category','description','status','seriesId'])assert.equal(replacement[key],previous[key]);
    assert.equal((await request(previous.image)).status,404);assert.equal((await request(replacement.image)).status,200);photo=replacement;
  });
  await t.test('系列顺序独立保存与站点、系列分享卡片', async () => {
    await request('/api/works/batch','PATCH',{ids:[photo.id],changes:{status:'published'}});
    const second=await request('/api/works','POST',form(jpeg,'photo')).then(r=>r.json());
    const series=await request('/api/series','POST',{title:'旅行 <山海>',status:'published'}).then(r=>r.json());
    await request('/api/works/batch','PATCH',{ids:[photo.id,second.id],changes:{seriesId:series.id}});
    const initial=(await request('/api/admin/portfolio').then(r=>r.json())).works.map(w=>w.id);
    assert.equal((await request('/api/series/'+series.id,'PUT',{title:series.title,workOrder:[second.id,second.id]})).status,409);
    assert.equal((await request('/api/series/'+series.id,'PUT',{title:series.title,workOrder:[second.id]})).status,409);
    assert.equal((await request('/api/series/'+series.id,'PUT',{title:series.title,workOrder:[photo.id,second.id]})).status,200);
    assert.deepEqual((await request('/api/library?series='+series.id).then(r=>r.json())).works.map(w=>w.id),[photo.id,second.id]);
    assert.deepEqual((await request('/api/admin/portfolio').then(r=>r.json())).works.map(w=>w.id),initial);
    for(const query of ['', '?series='+series.id]){
      const info=await request('/api/page-share'+query,'GET',undefined,false).then(r=>r.json());assert.ok(!JSON.stringify(info).includes('/uploads/'));
      const html=await request(query?'/series/'+series.id:'/').then(r=>r.text());assert.ok(html.includes(info.card));
      for(const [asset,w,h] of [['card',1200,630],['poster',1080,1440]]){const response=await fetch(info[asset]);assert.equal(response.status,200);const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(meta.width,w);assert.equal(meta.height,h);}
    }
    await request('/api/series/'+series.id,'PUT',{title:series.title,status:'draft'});assert.equal((await request('/api/page-share?series='+series.id)).status,404);assert.equal((await request('/share/series/'+series.id+'/card.jpg')).status,404);
    await request('/api/works/'+second.id,'DELETE');
  });
  await t.test('回收站隔离、重启恢复及彻底删除', async () => {
    const before=(await readdir(path.join(dir,'uploads'))).length;
    assert.equal((await request('/api/works/'+photo.id,'DELETE')).status,200);
    assert.equal((await request('/api/admin/trash','GET',undefined,false)).status,401);
    for(const route of ['/api/work/'+photo.id,'/media/'+photo.id+'/image.jpg','/work/'+photo.id,photo.image])assert.equal((await request(route,'GET',undefined,false)).status,404);
    assert.equal((await request(photo.image)).status,200);assert.equal((await readdir(path.join(dir,'uploads'))).length,before);
    await stop();await start();cookie=(await request('/api/login','POST',{password},false)).headers.get('set-cookie').split(';')[0];
    assert.ok((await request('/api/admin/trash').then(r=>r.json())).works.some(w=>w.id===photo.id));
    assert.equal((await request('/api/admin/trash/'+photo.id+'/restore','POST',{})).status,200);
    assert.equal((await request('/work/'+photo.id)).status,200);
    assert.equal((await request('/api/admin/portfolio').then(r=>r.json())).works.find(w=>w.id===photo.id).image,photo.image);
    await request('/api/works/'+photo.id,'DELETE');
    assert.equal((await request('/api/admin/trash/'+photo.id,'DELETE',{})).status,400);
    assert.equal((await request('/api/admin/trash/'+photo.id,'DELETE',{confirm:true})).status,200);
    assert.equal((await request(photo.image)).status,404);assert.equal((await readdir(path.join(dir,'uploads'))).length,before-2);
  });
  await t.test('自动备份鉴权、计划保存和归档恢复', async () => {
    assert.equal((await request('/api/admin/backups','GET',undefined,false)).status,401);
    assert.equal((await request('/api/admin/backups/run','POST',{},false)).status,401);
    assert.equal((await request('/api/admin/backups','PUT',{enabled:true,hour:24,keep:7})).status,400);
    assert.equal((await request('/api/admin/backups','PUT',{enabled:false,hour:4,keep:2})).status,200);
    assert.equal((await request('/api/admin/backups/run','POST',{})).status,202);
    let state;for(let i=0;i<100;i++){state=await request('/api/admin/backups').then(r=>r.json());if(!state.running)break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(state.running,false);assert.equal(state.lastError,'');assert.equal(state.records.length,1);assert.equal(state.records[0].sha256.length,64);
    const route='/api/admin/backups/'+state.records[0].name+'/download';assert.equal((await request(route,'GET',undefined,false)).status,401);
    const archive=await request(route);assert.equal(archive.status,200);const file=path.join(dir,'automatic-test.tar.gz');await writeFile(file,Buffer.from(await archive.arrayBuffer()));
    const restored=await mkdtemp(path.join(os.tmpdir(),'portfolio-auto-restore-'));const extraction=spawnSync('tar',['-xzf',file,'-C',restored],{windowsHide:true});assert.equal(extraction.status,0);
    const snapshot=JSON.parse(await readFile(path.join(restored,'portfolio.json'),'utf8'));assert.ok(snapshot.trash.length>0);
    for(const work of [...snapshot.works,...snapshot.trash])assert.deepEqual(await readFile(path.join(restored,work.image)),await readFile(path.join(dir,work.image)));
    assert.equal((await request('/api/logout','POST',{})).status,200);assert.equal((await request('/api/works/'+pano.id,'DELETE')).status,401);
  });
});
