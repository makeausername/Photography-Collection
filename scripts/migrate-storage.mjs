import { referencedFiles } from '../lib/work-lifecycle.mjs';
import path from 'node:path';
import { openPortfolio } from '../lib/database.mjs';
import { createStorage } from '../lib/storage.mjs';
import { acquireDataLock } from '../lib/runtime-lock.mjs';

const dir=path.resolve(process.env.DATA_DIR || 'data');
const release=acquireDataLock(dir);
let repository;
try {
  repository=openPortfolio(dir);
  const storage=await createStorage(dir,repository);
  const db=repository.load();
  const keys=referencedFiles(db);
  const apply=process.argv.includes('--apply'),removeLocal=process.argv.includes('--remove-local');
  if(removeLocal&&!apply)throw Error('--remove-local 必须与 --apply 一起使用');
  console.log(`共 ${keys.size} 个引用文件；${apply?'迁移并校验':'仅预览，不上传'}；${removeLocal?'校验后移除本地副本':'保留本地副本'}。`);
  if(apply) {
    if(storage.provider!=='oss')throw Error('请先设置 STORAGE_PROVIDER=oss 并完成配置');
    await storage.check();
    let count=0;
    for(const key of keys) {await storage.migrate(key,{removeLocal});console.log(`已校验 ${++count}/${keys.size}`);}
    console.log('迁移完成，可启动网站。');
  }
} catch(error) {console.error('迁移未完成。已完成的文件可续传，本地文件默认保留。请检查配置、连接、空间及数据目录锁。');process.exitCode=1;}
finally {repository?.close();release();}
