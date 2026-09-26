import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initializeDeployment, verifyDeploymentReport, validateDomain } from '../scripts/deploy-state.mjs';
import { openPortfolio } from '../lib/database.mjs';
import { acquireDataLock } from '../lib/runtime-lock.mjs';

const fixture=()=>({directory:mkdtempSync(path.join(tmpdir(),'kosmo-deploy-test-')),domain:'photos.example.com',instanceId:'a'.repeat(32),source:'/opt/kosmoyonder',now:Date.parse('2026-09-26T00:00:00Z')});
const read=file=>JSON.parse(readFileSync(file,'utf8'));
test('生产初始化生成随机密码、空作品库及备份计划，不泄漏密码到公开设置',()=>{
  const options=fixture();initializeDeployment(options);
  const credentials=read(path.join(options.directory,'credentials.json')),auth=read(path.join(options.directory,'data','admin.json'));
  assert.equal(credentials.password.length,32);assert.match(credentials.password,/^[A-Za-z0-9_-]+$/);
  assert.equal(scryptSync(credentials.password,auth.salt,64).toString('hex'),auth.hash);assert.equal(auth.password,undefined);
  const repo=openPortfolio(path.join(options.directory,'data'));const db=repo.load();repo.close();assert.equal(db.settings.name,'KosmoYonder');assert.equal(db.settings.icpNumber,'');assert.deepEqual(db.works,[]);assert.ok(!JSON.stringify(db).includes(credentials.password));
  const plan=read(path.join(options.directory,'data','backup-state.json'));assert.deepEqual(plan.settings,{enabled:true,hour:3,keep:7});assert.equal(plan.nextRun,'2026-09-26T19:00:00.000Z');
  const report=readFileSync(path.join(options.directory,'部署资料.md'),'utf8');assert.ok(report.includes(credentials.password));assert.ok(report.includes('尚未通过公网 HTTPS'));assert.ok(report.includes('https://photos.example.com/admin'));
  if(process.platform!=='win32')assert.equal(statSync(path.join(options.directory,'部署资料.md')).mode&0o777,0o600);
  const another=fixture();initializeDeployment(another);assert.notEqual(read(path.join(another.directory,'credentials.json')).password,credentials.password);
});
test('重复部署保留作品、密码和自定义备份计划；核验成功后才标记 HTTPS 已通过',()=>{
  const options=fixture();initializeDeployment(options);
  const authPath=path.join(options.directory,'data','admin.json'),auth=readFileSync(authPath,'utf8');
  const repo=openPortfolio(path.join(options.directory,'data'));const db=repo.load();repo.save({...db,settings:{...db.settings,name:'保留我的设置'},works:[{id:'keep',title:'我的作品'}]});repo.close();
  const schedule=path.join(options.directory,'data','backup-state.json');writeFileSync(schedule,JSON.stringify({settings:{enabled:false,hour:9,keep:3},records:[]}));
  initializeDeployment(options);assert.equal(readFileSync(authPath,'utf8'),auth);assert.equal(read(schedule).settings.hour,9);
  const reopened=openPortfolio(path.join(options.directory,'data'));assert.equal(reopened.load().works[0].id,'keep');assert.equal(reopened.load().settings.name,'保留我的设置');reopened.close();
  verifyDeploymentReport(options.directory,options.source);assert.ok(read(path.join(options.directory,'deployment.json')).verifiedAt);assert.match(readFileSync(path.join(options.directory,'部署资料.md'),'utf8'),/HTTPS 与本站标识检查通过/);
  assert.throws(()=>initializeDeployment({...options,domain:'another.example.com'}),/不一致/);assert.equal(readFileSync(authPath,'utf8'),auth);
});
test('保留原管理员以及恢复中断初始化，不输出过期密码',()=>{
  const options=fixture();initializeDeployment(options);const credentialFile=path.join(options.directory,'credentials.json'),credential=read(credentialFile),authFile=path.join(options.directory,'data','admin.json');
  const changed={salt:'test-only-salt',hash:scryptSync('changed-test-only-password','test-only-salt',64).toString('hex')};writeFileSync(authFile,JSON.stringify(changed));
  initializeDeployment(options);assert.deepEqual(read(authFile),changed);assert.ok(!readFileSync(path.join(options.directory,'部署资料.md'),'utf8').includes(credential.password));
  // A crash after writing credentials but before writing admin.json must reuse the password.
  const resumed=fixture();const fs=path.join(resumed.directory,'credentials.json');writeFileSync(fs,JSON.stringify({...credential,initializing:true}));initializeDeployment(resumed);assert.equal(read(fs).password,credential.password);assert.equal(read(path.join(resumed.directory,'data','admin.json')).hash,credential.hash);
});
test('域名拒绝命令、路径、端口、私有后缀和数字 IP，初始化拒绝在用数据目录',()=>{
  assert.equal(validateDomain('https://Photos.Example.com/'),'photos.example.com');
  for(const input of ['localhost','127.0.0.1','example.com:443','example.com/admin','*.example.com','example.com;touch /tmp/evil','$(id).example.com','example.com\nEVIL=value','a.local','-bad.example.com'])assert.throws(()=>validateDomain(input));
  const options=fixture(),data=path.join(options.directory,'data'),release=acquireDataLock(data);
  try{assert.throws(()=>initializeDeployment(options),/正在使用/);assert.equal(existsSync(path.join(data,'admin.json')),false);}finally{release();}
});
test('生产配置隔离端口、凭据目录和证书目录',()=>{
  const root=path.resolve(import.meta.dirname,'..'),compose=readFileSync(path.join(root,'deploy','compose.yaml'),'utf8');
  const app=compose.split('  portfolio:')[1].split('  caddy:')[0];assert.ok(!app.includes('ports:'));assert.ok(!app.includes('ADMIN_PASSWORD'));assert.ok(!app.includes('/deployment'));
  assert.ok(compose.includes('../.deployment/caddy-data:/data'));assert.ok(compose.includes('condition: service_healthy'));
  for(const name of ['.gitignore','.dockerignore'])assert.ok(readFileSync(path.join(root,name),'utf8').includes('.deployment'));
});
test('初始化命令不在正常输出或配置损坏错误中打印密码',()=>{
  const options=fixture(),script=path.resolve(import.meta.dirname,'../scripts/deploy-state.mjs');
  const env={...process.env,DOMAIN:options.domain,DEPLOYMENT_ID:options.instanceId,DEPLOYMENT_DIR:options.directory,DEPLOYMENT_SOURCE:options.source};
  const result=spawnSync(process.execPath,[script,'initialize'],{env,encoding:'utf8'});assert.equal(result.status,0);
  const password=read(path.join(options.directory,'credentials.json')).password;assert.ok(!(result.stdout+result.stderr).includes(password));
  writeFileSync(path.join(options.directory,'credentials.json'),'invalid-private-value-'+password);
  const invalid=spawnSync(process.execPath,[script,'initialize'],{env,encoding:'utf8'});assert.equal(invalid.status,1);assert.ok(!(invalid.stdout+invalid.stderr).includes(password));
});
