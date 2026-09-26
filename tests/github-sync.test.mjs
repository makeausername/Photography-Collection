import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const slash=value=>value.replaceAll('\\','/');
function git(dir,...args){const r=spawnSync('git',['-C',dir,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function setup(){
  const root=mkdtempSync(path.join(os.tmpdir(),'kosmo-github-')),remote=path.join(root,'remote.git'),author=path.join(root,'author'),server=path.join(root,'server');
  mkdirSync(remote);mkdirSync(author);git(remote,'init','--bare','--initial-branch=main');git(author,'init','--initial-branch=main');git(author,'config','user.name','Deployment Test');git(author,'config','user.email','test@example.invalid');
  writeFileSync(path.join(author,'.gitignore'),'.deployment/\n');writeFileSync(path.join(author,'app.txt'),'first');git(author,'add','.gitignore','app.txt');git(author,'commit','-m','initial');git(author,'remote','add','origin',slash(remote));git(author,'push','origin','main');git(root,'clone','--branch','main',slash(remote),slash(server));mkdirSync(path.join(server,'.deployment'));writeFileSync(path.join(server,'.deployment','secret'),'keep-private');
  return {root,remote,author,server};
}
function sync(f){return spawnSync(bash,['-c','export PATH=/usr/bin:/bin:/mingw64/bin:$PATH; set -euo pipefail; source "$1"; github_sync "$2" "$3" main','_',slash(path.resolve(import.meta.dirname,'../scripts/github-sync.sh')),slash(f.server),slash(f.remote)],{encoding:'utf8'});}
test('GitHub 更新快进到远端提交并保留私密数据',()=>{
  if(process.platform==='win32')assert.ok(existsSync(bash));
  const f=setup();writeFileSync(path.join(f.author,'app.txt'),'second');git(f.author,'add','app.txt');git(f.author,'commit','-m','update');git(f.author,'push','origin','main');
  const result=sync(f);assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(path.join(f.server,'app.txt'),'utf8'),'second');assert.equal(readFileSync(path.join(f.server,'.deployment','secret'),'utf8'),'keep-private');assert.equal(git(f.server,'rev-parse','HEAD'),git(f.author,'rev-parse','HEAD'));
});
test('GitHub 更新拒绝覆盖本地修改、分叉历史和远端私密路径',()=>{
  const f=setup();writeFileSync(path.join(f.server,'app.txt'),'local edit');assert.notEqual(sync(f).status,0);assert.equal(readFileSync(path.join(f.server,'app.txt'),'utf8'),'local edit');
  git(f.server,'config','user.name','Test');git(f.server,'config','user.email','test@example.invalid');git(f.server,'add','app.txt');git(f.server,'commit','-m','local-only');const previous=git(f.server,'rev-parse','HEAD');assert.notEqual(sync(f).status,0);assert.equal(git(f.server,'rev-parse','HEAD'),previous);
  const other=setup();mkdirSync(path.join(other.author,'.deployment'));writeFileSync(path.join(other.author,'.deployment','secret'),'remote must not overwrite');git(other.author,'add','-f','.deployment/secret');git(other.author,'commit','-m','bad runtime data');git(other.author,'push','origin','main');assert.notEqual(sync(other).status,0);assert.equal(readFileSync(path.join(other.server,'.deployment','secret'),'utf8'),'keep-private');
});
