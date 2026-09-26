import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import sharp from 'sharp';
import OSS from 'ali-oss';
import { openPortfolio } from '../lib/database.mjs';
import { createStorage, storageConfig, cdnSignedURL } from '../lib/storage.mjs';
import { displayImages, protectionSettings } from '../lib/image-protection.mjs';
import { exportBackup } from '../lib/backup.mjs';
import { acquireDataLock } from '../lib/runtime-lock.mjs';

const config={provider:'oss',prefix:'portfolio',expires:300,publicBase:'https://images.example.com',cdnBase:'',bucket:'test-bucket',region:'oss-cn-hangzhou',accessKeyId:'test-only-key',accessKeySecret:'test-only-secret'};
const env={STORAGE_PROVIDER:'oss',OSS_REGION:config.region,OSS_BUCKET:config.bucket,OSS_ACCESS_KEY_ID:config.accessKeyId,OSS_ACCESS_KEY_SECRET:config.accessKeySecret,OSS_PUBLIC_BASE_URL:config.publicBase};
function mockOSS() {
  const objects=new Map();
  return {
    objects,failDelete:false,corrupt:false,
    async put(key,buffer,options) {objects.set(key,{buffer:Buffer.from(buffer),headers:{...options.headers,'content-length':String(buffer.length)}});},
    async head(key) {const item=objects.get(key);if(!item)throw Object.assign(Error('missing'),{status:404});return {res:{headers:item.headers}};},
    async get(key) {const item=objects.get(key);if(!item)throw Object.assign(Error('missing'),{status:404});return {content:this.corrupt?Buffer.from('corrupt'):item.buffer};},
    async delete(key) {if(this.failDelete)throw Error('network');objects.delete(key);},
    async signatureUrlV4(method,expires,request,key) {return `${config.publicBase}/${key}?test-signature=${expires}`;}
  };
}
async function setup(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'portfolio-storage-'));
  const db=openPortfolio(dir);t.after(()=>db.close());
  const client=mockOSS();const store=await createStorage(dir,db,{config,client});
  return {dir,db,client,store};
}
test('SQLite 自动迁移、逐条保存、顺序、回滚与旧 JSON 保留',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'portfolio-db-'));
  const legacy={settings:{name:'摄影师',heroInterval:7},works:[{id:'a',kind:'photo',category:'星空'},{id:'b',kind:'panorama'}],series:[{id:'trip',title:'旅行'}]};
  await writeFile(path.join(dir,'portfolio.json'),JSON.stringify(legacy));
  let db=openPortfolio(dir);
  assert.deepEqual(db.load(),legacy);
  const next={...legacy,settings:{...legacy.settings,name:'更新'},works:[legacy.works[1],{...legacy.works[0],title:'银河'}]};
  db.save(next);assert.deepEqual(db.load(),next);
  assert.throws(()=>db.save({...next,works:[{id:'duplicate'},{id:'duplicate'}]}));
  assert.throws(()=>db.save({...next,settings:{name:'不应保存'},works:[{id:'bigint',value:1n}]}));
  assert.deepEqual(db.load(),next);db.close();
  assert.deepEqual(JSON.parse(await readFile(path.join(dir,'portfolio.json'),'utf8')),legacy);
  db=openPortfolio(dir);assert.deepEqual(db.load(),next);db.close();
});
test('数据目录阻止第二个写入进程',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'portfolio-lock-'));
  const release=acquireDataLock(dir);
  assert.throws(()=>acquireDataLock(dir),/正在使用/);release();
  const again=acquireDataLock(dir);again();
});
test('OSS 配置校验、凭证不出现在状态中、目录穿越拒绝',async t=>{
  assert.deepEqual(storageConfig({}),{provider:'local'});
  for(const patch of [{STORAGE_PROVIDER:'unknown'},{OSS_PUBLIC_BASE_URL:'http://bad.example'},{OSS_PUBLIC_BASE_URL:'https://u:p@example.com'},{OSS_PREFIX:'../private'},{OSS_URL_TTL:'1'},{CDN_BASE_URL:'https://cdn.example.com'}])assert.throws(()=>storageConfig({...env,...patch}));
  const {store}=await setup(t);
  assert.ok(!JSON.stringify(store.describe()).includes(config.accessKeySecret));
  assert.ok(!JSON.stringify(store.describe()).includes(config.accessKeyId));
  await assert.rejects(store.put('../admin.json',Buffer.from('bad')));
});
test('真实 SDK 离线 V4 签名与 CDN A 签名',async()=>{
  const signer=new OSS({region:config.region,bucket:config.bucket,accessKeyId:config.accessKeyId,accessKeySecret:config.accessKeySecret,authorizationV4:true,secure:true,endpoint:config.publicBase,cname:true});
  const url=new URL(await signer.signatureUrlV4('GET',300,{},'portfolio/display/abc.webp'));
  assert.equal(url.origin,config.publicBase);assert.equal(url.pathname,'/portfolio/display/abc.webp');
  assert.equal(url.searchParams.get('x-oss-expires'),'300');assert.equal(url.searchParams.get('x-oss-signature-version'),'OSS4-HMAC-SHA256');assert.ok(!url.toString().includes(config.accessKeySecret));
  assert.equal(cdnSignedURL('https://cdn.example.com','video/standard/test.mp4','aliyuncdnexp1234',1444435200,'0'),'https://cdn.example.com/video/standard/test.mp4?auth_key=1444435200-0-0-23bf85053008f5c0e791667a313e28ce');
});
test('OSS 私有上传、混合读取、展示图直传、删除失败可重试',async t=>{
  const {dir,db,client,store}=await setup(t);await mkdir(path.join(dir,'uploads'));
  await writeFile(path.join(dir,'uploads/legacy.jpg'),'legacy');
  assert.equal((await store.read('uploads/legacy.jpg')).toString(),'legacy');
  const buffer=await sharp({create:{width:1200,height:800,channels:3,background:'red'}}).webp().toBuffer();
  await store.put('uploads/photo.webp',buffer);assert.deepEqual(await store.read('uploads/photo.webp'),buffer);
  await assert.rejects(access(path.join(dir,'uploads/photo.webp')));
  const record=db.asset('uploads/photo.webp');assert.equal(client.objects.get(record.objectKey).headers['x-oss-object-acl'],'private');
  const display=displayImages(path.join(dir,'uploads'),path.join(dir,'display-cache'),store);
  const protectedImage=await display({image:'/uploads/photo.webp',kind:'photo'},'image',protectionSettings({}),480);
  assert.equal((await sharp(protectedImage).metadata()).width,480);
  const key=createHash('sha256').update(protectedImage).digest('hex')+'.webp';
  const url=await store.deliveryURL(key,protectedImage,'image/webp');assert.ok(url.includes('/display/'));assert.ok(!url.includes('/private/'));
  const count=client.objects.size;await store.deliveryURL(key,protectedImage,'image/webp');assert.equal(client.objects.size,count);
  client.failDelete=true;await assert.rejects(store.remove('uploads/photo.webp'));assert.equal(store.describe().pendingDeletes,1);
  client.failDelete=false;assert.equal(await store.retryDeletes(),1);assert.equal(db.asset('uploads/photo.webp'),null);
  assert.equal(client.objects.has(record.objectKey),false);
});
test('迁移完整校验后切换，默认保留本地，损坏时不切换，可续传清理',async t=>{
  const {dir,db,client,store}=await setup(t);await mkdir(path.join(dir,'uploads'));
  await writeFile(path.join(dir,'uploads/legacy.jpg'),'legacy');
  client.corrupt=true;await assert.rejects(store.migrate('uploads/legacy.jpg'));assert.equal(db.asset('uploads/legacy.jpg'),null);
  assert.equal((await store.read('uploads/legacy.jpg')).toString(),'legacy');
  client.corrupt=false;await store.migrate('uploads/legacy.jpg');assert.equal(db.asset('uploads/legacy.jpg').provider,'oss');
  await access(path.join(dir,'uploads/legacy.jpg'));
  const other=await createStorage(dir,db,{config,client});assert.equal((await other.read('uploads/legacy.jpg')).toString(),'legacy');
  await assert.rejects(createStorage(dir,db,{config:{provider:'local'}}),/配置/);
  await store.migrate('uploads/legacy.jpg',{removeLocal:true});await assert.rejects(access(path.join(dir,'uploads/legacy.jpg')));
  assert.equal((await store.read('uploads/legacy.jpg')).toString(),'legacy');
});
test('OSS 连接检查清理探针，失败上传不会登记成功',async t=>{
  const {db,client,store}=await setup(t);
  assert.equal((await store.check()).ok,true);assert.equal(client.objects.size,0);
  const originalHead=client.head.bind(client);client.head=async key=>{const result=await originalHead(key);return {res:{headers:{...result.res.headers,'content-length':'-1'}}};};
  await assert.rejects(store.put('uploads/fail.webp',Buffer.from('test')));assert.equal(db.asset('uploads/fail.webp'),null);
});
test('OSS 全量备份包含 SQLite、图片和个人照片，脱离云端可恢复',async t=>{
  const {dir,db,store}=await setup(t);
  await store.put('uploads/a.webp',Buffer.from('photo'));await store.put('uploads/profile-x.webp',Buffer.from('portrait'));
  const snapshot={settings:{name:'测试',profilePhoto:true,profilePhotoKey:'uploads/profile-x.webp'},works:[{id:'a',image:'/uploads/a.webp',preview:'/uploads/a.webp'}],series:[]};db.save(snapshot);
  const chunks=[];const res=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});res.set=()=>res;res.attachment=()=>res;
  await exportBackup(dir,structuredClone(snapshot),res,store);
  const archive=path.join(dir,'backup.tar.gz');await writeFile(archive,Buffer.concat(chunks));
  const restored=await mkdtemp(path.join(tmpdir(),'portfolio-cloud-restore-'));
  assert.equal(spawnSync('tar',['-xzf',archive,'-C',restored],{windowsHide:true}).status,0);
  const restoredDB=openPortfolio(restored);t.after(()=>restoredDB.close());const local=await createStorage(restored,restoredDB,{config:{provider:'local'}});
  assert.equal(restoredDB.load().settings.profilePhotoKey,'profile.webp');assert.equal((await local.read('uploads/a.webp')).toString(),'photo');assert.equal((await local.read('profile.webp')).toString(),'portrait');
  assert.deepEqual(restoredDB.assets(),[]);await assert.rejects(access(path.join(restored,'admin.json')));
});
