import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, lstat, realpath, readFile, readdir, rename, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { fileChecksum } from '../lib/offsite-backup.mjs';
import { openPortfolio } from '../lib/database.mjs';
import { referencedFiles } from '../lib/work-lifecycle.mjs';
import { createStorage } from '../lib/storage.mjs';

const run=promisify(execFile);
const allowed=name=>/^(portfolio\.(json|sqlite)|backup-manifest\.json|RESTORE\.txt|profile\.webp|uploads\/[a-zA-Z0-9._-]+)$/.test(name)&&!name.includes('..');
export async function restoreBackup({archive,target,sha256,env=process.env,storageFactory=(directory,repository)=>createStorage(directory,repository)}) {
  if(!/^[a-f0-9]{64}$/.test(sha256||''))throw Error('请提供备份记录中的 SHA-256 校验值');
  archive=await realpath(archive);target=path.resolve(target);
  if(await lstat(target).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))throw Error('恢复目录已经存在；请指定全新的目录，现有数据不会被覆盖');
  const parent=await realpath(path.dirname(target));target=path.join(parent,path.basename(target));
  if(await fileChecksum(archive)!==sha256)throw Error('备份校验失败，文件未被解压');
  const {stdout:list}=await run('tar',['-tzf',archive],{maxBuffer:16*1024*1024,windowsHide:true});
  const entries=list.trim().split(/\r?\n/).map(x=>x.replace(/^\.\//,''));
  if(new Set(entries).size!==entries.length||entries.some(n=>!['','.', 'uploads/','uploads'].includes(n)&&!allowed(n)))throw Error('备份包含无效路径或重复文件');
  const {stdout:details}=await run('tar',['-tvzf',archive],{maxBuffer:32*1024*1024,windowsHide:true});
  if(details.trim().split(/\r?\n/).some(line=>!/^[-d]/.test(line)))throw Error('备份不能包含符号链接、硬链接或特殊文件');
  const staging=await mkdtemp(path.join(parent,'.portfolio-restore-'));
  try {
    await run('tar',['-xzf',archive,'-C',staging,'--no-same-owner','--no-same-permissions'],{windowsHide:true});
    const manifest=JSON.parse(await readFile(path.join(staging,'backup-manifest.json'),'utf8'));
    if(manifest.version!==1||!['portable','references'].includes(manifest.mode)||!Array.isArray(manifest.files))throw Error('备份清单无效');
    for(const file of manifest.files){
      if(!allowed(file.file))throw Error('校验清单路径无效');
      const local=path.join(staging,file.file),info=await lstat(local);
      if(!info.isFile()||info.size!==file.bytes||await fileChecksum(local)!==file.sha256)throw Error('备份内容校验失败');
    }
    if(!['portfolio.json','portfolio.sqlite'].every(name=>manifest.files.some(f=>f.file===name)))throw Error('备份缺少作品资料');
    const sql=new DatabaseSync(path.join(staging,'portfolio.sqlite'),{readOnly:true});
    try{if(sql.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('数据库校验失败');}finally{sql.close();}
    const repository=openPortfolio(staging);
    try {
      const snapshot=repository.load(),keys=referencedFiles(snapshot);
      if(snapshot.settings.profilePhoto)keys.add(snapshot.settings.profilePhotoKey||'profile.webp');
      if(manifest.mode==='portable'){
        for(const key of keys)if(!manifest.files.some(f=>f.file===key))throw Error('完整备份缺少图片');
      }else{
        if(env.STORAGE_PROVIDER!=='oss')throw Error('轻量备份需要先配置原 OSS 存储环境');
        const storage=await storageFactory(staging,repository);
        for(const key of keys)await storage.read(key);
      }
    }finally{repository.close();}
    const secure=async dir=>{await chmod(dir,0o700);for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())await secure(f);else await chmod(f,0o600);}};
    await secure(staging);await rename(staging,target);
    return {target,mode:manifest.mode};
  }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==3){console.error('用法：node scripts/restore-backup.mjs 备份.tar.gz 全新数据目录 SHA256');process.exitCode=1;}
  else try{const result=await restoreBackup({archive:args[0],target:args[1],sha256:args[2]});console.log('校验与恢复完成：'+result.target+'\n请使用此目录启动；管理员密码需要重新设置。');}catch{console.error('恢复未完成：请检查校验值、全新目标目录、备份完整性，以及轻量备份所需的 OSS 配置。原目录未覆盖。');process.exitCode=1;}
}
