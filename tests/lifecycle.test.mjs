import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { automaticBackups, nextBackupAt } from '../lib/automatic-backup.mjs';
import { recycleWork, restoreWork, expiredTrash, referencedFiles } from '../lib/work-lifecycle.mjs';

test('30 天回收期限、共享图片引用与恢复资料',()=>{
  const now=Date.parse('2026-09-26T00:00:00Z'),work={id:'a',image:'/uploads/shared.webp',preview:'/uploads/preview.webp',status:'published',seriesId:'s'};
  const db={settings:{},series:[{id:'s'}],works:[work,{...work,id:'b'}]};
  const recycled=recycleWork(db,'a',now);assert.equal(recycled.works.length,1);assert.equal(expiredTrash(recycled,now+30*86400000-1).length,0);assert.equal(expiredTrash(recycled,now+30*86400000).length,1);
  assert.equal(referencedFiles(recycled).size,2);assert.deepEqual(restoreWork(recycled,'a').works,db.works);
  recycled.series=[];assert.equal(restoreWork(recycled,'a').works[0].seriesId,'');
});
test('北京时间日计划、错过计划补跑与备份保留',async()=>{
  assert.equal(nextBackupAt(3,Date.parse('2026-09-25T18:00:00Z')),'2026-09-25T19:00:00.000Z');
  assert.equal(nextBackupAt(3,Date.parse('2026-09-25T19:00:00Z')),'2026-09-26T19:00:00.000Z');
  const dir=await mkdtemp(path.join(os.tmpdir(),'backup-lifecycle-'));let now=Date.parse('2026-09-26T00:00:00Z'),blocked=false,fail=false,locked=false;
  const options={dataDir:dir,snapshot:()=>({settings:{},works:[]}),now:()=>now,acquire:()=>{if(blocked||locked)return false;locked=true;return true;},release:()=>{locked=false;},exporter:async(a,b,output)=>{if(fail)throw Error('synthetic failure');output.end('complete backup');}};
  const manager=await automaticBackups(options);await manager.configure({enabled:true,hour:3,keep:2});
  for(let i=0;i<3;i++){now++;assert.equal(manager.start(true),true);assert.equal(manager.start(true),false);await manager.wait();}
  assert.equal(manager.status().records.length,2);assert.equal((await readdir(path.join(dir,'auto-backups'))).length,2);
  const previous=structuredClone(manager.status().records);fail=true;manager.start(true);await manager.wait();assert.deepEqual(manager.status().records,previous);assert.ok(manager.status().lastError);assert.equal(locked,false);
  assert.equal(await readFile(await manager.file(previous[0].name),'utf8'),'complete backup');await assert.rejects(manager.file('../secret'));
  fail=false;now=Date.parse(manager.status().nextRun)+1000;const restarted=await automaticBackups(options);blocked=true;assert.equal(restarted.tick(),false);blocked=false;assert.equal(restarted.tick(),true);await restarted.wait();assert.equal(restarted.status().lastError,'');assert.equal(restarted.status().records.length,2);
});
