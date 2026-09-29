import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { queryWorks } from '../lib/library.mjs';
import { insights } from '../lib/insights.mjs';
import { panoramaConfig, panoramaTiles } from '../lib/panorama-tiles.mjs';
import { sampleTile, direction } from '../lib/panorama-worker.mjs';
import { offsiteBackup, fileChecksum } from '../lib/offsite-backup.mjs';
import { exportBackup } from '../lib/backup.mjs';
import { automaticBackups } from '../lib/automatic-backup.mjs';
import { restoreBackup } from '../scripts/restore-backup.mjs';
import { renderPublicPage } from '../lib/public-pages.mjs';
import sharp from 'sharp';

test('按地点年份筛选、最新排序和系列内部顺序独立',()=>{
  const db={works:[{id:'a',kind:'photo',location:'四川',year:'2024 年 9 月',createdAt:'2024',seriesId:'s'},{id:'b',kind:'photo',location:'云南',year:'2025',createdAt:'2025',seriesId:'s'},{id:'c',kind:'photo',status:'draft',createdAt:'2026'}],series:[{id:'s',workOrder:['a','b']}]};
  assert.deepEqual(queryWorks(db,{sort:'latest'}).map(w=>w.id),['b','a']);
  assert.deepEqual(queryWorks(db,{location:'四川',year:'2024'}).map(w=>w.id),['a']);
  assert.deepEqual(queryWorks(db,{series:'s',sort:'latest'}).map(w=>w.id),['a','b']);
});
test('访问统计去重、隐私和跨重启汇总',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'insights-')),work={id:'a',title:'山'};
  let stats=insights(dir);stats.record('a','view','127.0.0.1');stats.record('a','view','127.0.0.1');stats.record('a','share','127.0.0.1');
  assert.equal(stats.report([work]).totals.view,1);stats.close();stats=insights(dir);assert.equal(stats.report([work]).totals.share,1);stats.close();
  assert.equal((await readFile(path.join(dir,'insights.sqlite'))).includes(Buffer.from('127.0.0.1')),false);
});
test('全景配置、六面方向和分块结果',async()=>{
  assert.equal(panoramaConfig({id:'a',width:2048}).type,'equirectangular');
  assert.equal(panoramaConfig({id:'a',width:8192}).multiRes.maxLevel,3);
  assert.equal(panoramaConfig({id:'a',width:8192,panoramaMode:'single'}).type,'equirectangular');
  assert.deepEqual(direction('f',0,0),[0,-0,-1]);assert.deepEqual(direction('r',0,0),[1,-0,0]);assert.deepEqual(direction('u',0,0),[0,1,0]);
  const pixels=Buffer.alloc(128*64*3,120);for(const face of ['f','b','u','d','l','r'])assert.ok(sampleTile(pixels,128,64,face,16,0,0).output.every(x=>x===120));
  const dir=await mkdtemp(path.join(tmpdir(),'tiles-')),buffer=await sharp(pixels,{raw:{width:128,height:64,channels:3}}).webp().toBuffer();
  const generate=panoramaTiles(dir,async()=>buffer,{info:async()=>({fingerprint:'a'})});
  const result=await generate({id:'a',image:'/uploads/a.webp',width:4096},{},{level:1,face:'f',x:0,y:0});assert.equal((await sharp(result).metadata()).width,512);
  await assert.rejects(generate({id:'a',image:'/uploads/a.webp',width:4096},{},{level:9,face:'f',x:0,y:0}),/INVALID_TILE/);
});
test('授权信息和结构化版权信息正确转义',()=>{
  const work={id:'a',kind:'photo',title:'</script><img>',description:'hello',vcgLicenseUrl:'https://example.com/license'};
  const html=renderPublicPage('work',{name:'KosmoYonder'},work,null,{origin:'https://example.com',db:{settings:{},works:[work],series:[]}});
  assert.match(html,/data-license/);const json=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json).name,work.title);assert.ok(!json.includes('</script>'));assert.equal(JSON.parse(json).acquireLicensePage,work.vcgLicenseUrl);
});
test('完整备份校验恢复、禁止覆盖和损坏拒绝',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'restore-'));await mkdir(path.join(dir,'uploads'));await writeFile(path.join(dir,'uploads/a.webp'),'sample');
  const snapshot={settings:{},works:[{id:'a',image:'/uploads/a.webp',preview:'/uploads/a.webp'}],series:[]};
  const chunks=[],res=new Writable({write(chunk,encoding,done){chunks.push(chunk);done();}});res.set=res.attachment=()=>res;
  await exportBackup(dir,snapshot,res);const archive=path.join(dir,'backup.tar.gz');await writeFile(archive,Buffer.concat(chunks));const sha256=await fileChecksum(archive),target=path.join(dir,'restored');
  await restoreBackup({archive,target,sha256});assert.equal(await readFile(path.join(target,'uploads/a.webp'),'utf8'),'sample');
  await assert.rejects(restoreBackup({archive,target,sha256}),/已经存在/);
  await assert.rejects(restoreBackup({archive,target:target+'-bad',sha256:'0'.repeat(64)}),/校验失败/);
});
test('异地同步失败保留旧备份、成功后按本地保留数量清理',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'offsite-'));let fail=false,now=Date.now();const remote=new Set();
  const offsite={describe:()=>({bucket:'test'}),put:async name=>{if(fail)throw Error('failed');remote.add(name);},remove:async name=>remote.delete(name)};
  const manager=await automaticBackups({dataDir:dir,snapshot:()=>({settings:{},works:[]}),acquire:()=>true,release:()=>{},now:()=>now,offsite,exporter:async(a,b,res)=>res.end('archive')});
  await manager.configure({enabled:true,hour:3,keep:2,keepLocal:1});
  for(let i=0;i<2;i++){now++;manager.start();await manager.wait();}assert.equal(manager.status().records.length,2);assert.equal(remote.size,2);assert.equal((await readdir(path.join(dir,'auto-backups'))).length,1);
  const previous=manager.status().records.map(r=>r.name);fail=true;now++;manager.start();await manager.wait();assert.ok(manager.status().lastError);assert.deepEqual(manager.status().records.map(r=>r.name),previous);assert.equal(remote.size,2);
});
test('异地备份上传校验和对象路径限制',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'backup-cloud-')),file=path.join(dir,'a');await writeFile(file,'abc');const sha=await fileChecksum(file);let headers;
  const client={multipartUpload:async(k,f,options)=>{headers=options.headers;},head:async()=>({res:{headers:{'content-length':'3','x-oss-meta-sha256':sha}}}),delete:async()=>{}};
  const remote=await offsiteBackup({BACKUP_OSS_BUCKET:'test-bucket',BACKUP_OSS_REGION:'oss-cn-hangzhou'},client);
  await remote.put('portfolio-1750000000000-00000000-0000-0000-0000-000000000000.tar.gz',file,sha);assert.equal(headers['x-oss-object-acl'],'private');await assert.rejects(remote.remove('../secret'));
});
