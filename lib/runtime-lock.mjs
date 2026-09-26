import { mkdirSync, openSync, writeFileSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// A container may reuse a PID after restart. Linux start time distinguishes it
// from the process that created the old lock, including after an unclean exit.
function processIdentity(pid) {
  if(process.platform!=='linux')return null;
  const stat=readFileSync(`/proc/${pid}/stat`,'utf8');
  return readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()+':'+stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
}

// The route layer keeps an in-memory snapshot: one writer process per DATA_DIR.
export function acquireDataLock(dataDir) {
  mkdirSync(dataDir,{recursive:true});
  const file=path.join(dataDir,'.writer.lock');
  const owner=JSON.stringify({pid:process.pid,identity:processIdentity(process.pid)});
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const fd=openSync(file,'wx',0o600);writeFileSync(fd,owner);closeSync(fd);
      const release=()=>{try{if(readFileSync(file,'utf8')===owner)unlinkSync(file);}catch{}};
      process.once('exit',release);return release;
    } catch(error) {
      if(error.code!=='EEXIST')throw error;
      let pid,identity;
      try {const record=JSON.parse(readFileSync(file,'utf8'));pid=typeof record==='number'?record:record.pid;identity=record?.identity;}catch{throw Error('无法读取数据目录锁，请检查权限');}
      if(!Number.isInteger(pid)||pid<=0)throw Error('数据目录锁异常，请确认服务已停止后移除 .writer.lock');
      try {
        process.kill(pid,0);
        if(identity&&process.platform==='linux'&&identity!==processIdentity(pid)){unlinkSync(file);continue;}
        throw Error('数据目录正在使用，请先停止网站服务或迁移进程');
      }
      catch(error) {if(error.code==='ESRCH'||error.code==='ENOENT')unlinkSync(file);else throw error;}
    }
  }
  throw Error('无法锁定数据目录');
}
