import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink, stat, statfs } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { exportBackup } from './backup.mjs';
import { referencedFiles } from './work-lifecycle.mjs';

const filenamePattern=/^portfolio-\d{13}-[a-f0-9-]{36}\.tar\.gz$/;
export function nextBackupAt(hour,now=Date.now()) {
  const china=new Date(now+8*3600000);
  let next=Date.UTC(china.getUTCFullYear(),china.getUTCMonth(),china.getUTCDate(),hour)-8*3600000;
  if(next<=now)next+=86400000;
  return new Date(next).toISOString();
}
export function parseBackupSettings(value) {
  if(typeof value.enabled!=='boolean'||!Number.isInteger(value.hour)||value.hour<0||value.hour>23||!Number.isInteger(value.keep)||value.keep<1||value.keep>30)throw Error('请选择自动备份开关、0～23 点和 1～30 份保留数量');
  const mode=value.mode || 'portable',keepLocal=value.keepLocal ?? value.keep;
  if(!['portable','references'].includes(mode)||!Number.isInteger(keepLocal)||keepLocal<1||keepLocal>value.keep)throw Error('本地保留份数应为 1～总保留份数');
  return {enabled:value.enabled,hour:value.hour,keep:value.keep,mode,keepLocal};
}
export async function automaticBackups({dataDir,directory=path.join(dataDir,'auto-backups'),snapshot,storage,acquire,release,now=Date.now,exporter=exportBackup,offsite=null}) {
  directory=path.resolve(directory);
  const stateFile=path.join(dataDir,'backup-state.json');
  let state={settings:{enabled:false,hour:3,keep:7},records:[],lastSuccess:null,lastError:'',nextRun:null};
  try {state={...state,...JSON.parse(await readFile(stateFile,'utf8'))};state.settings=parseBackupSettings(state.settings);}
  catch(error){if(error.code!=='ENOENT')throw Error('自动备份配置无法读取，请检查 backup-state.json');}
  let running=false,task=Promise.resolve(),timer;
  const persist=async()=>{const tmp=stateFile+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});await rename(tmp,stateFile);}finally{await unlink(tmp).catch(()=>{});}};
  const filePath=name=>{if(!filenamePattern.test(name))throw Error('备份文件名无效');const file=path.resolve(directory,name);if(path.dirname(file)!==directory)throw Error('备份路径无效');return file;};
  const manager={
    status(){return {...state,offsite:offsite?.describe() || null,running,destination:directory,timezone:'Asia/Shanghai'};},
    async configure(value){if(running)throw Error('备份正在进行，请完成后再修改计划');const settings=parseBackupSettings(value);if(!offsite&&settings.keepLocal<settings.keep)throw Error('请先配置异地备份，再减少本地保留份数');if(settings.mode==='references')storage.manifest([...referencedFiles(snapshot())]);const previous=state;state={...state,settings,nextRun:settings.enabled?nextBackupAt(settings.hour,now()):null};try{await persist();}catch(error){state=previous;throw error;}return manager.status();},
    async remote(name){const record=state.records.find(r=>r.name===name);if(!record?.offsite||!offsite||JSON.stringify(record.offsite)!==JSON.stringify(offsite.describe()))throw Error('异地备份配置不匹配');return offsite.stream(name);},
    async file(name){const record=state.records.find(item=>item.name===name);if(!record)throw Error('备份不存在');const file=filePath(name);await stat(file);return file;},
    start(manual=false){
      if(running || !acquire(manual))return false;
      running=true;
      task=(async()=>{
        const name=`portfolio-${now()}-${randomUUID()}.tar.gz`,file=filePath(name),partial=file+'.part';
        try {
          await mkdir(directory,{recursive:true});
          const disk=await statfs(directory);let needed=256*1024*1024;
          if(state.settings.mode!=='references'&&storage?.info){const db=snapshot();const keys=new Set([...(db.works||[]),...(db.trash||[])].flatMap(w=>[w.image,w.preview]).filter(Boolean).map(v=>v.slice(1)));if(db.settings.profilePhoto)keys.add(db.settings.profilePhotoKey||'profile.webp');for(const key of keys)needed+=(await storage.info(key)).size*2;}
          if(disk.bavail*disk.bsize<needed)throw Error('SPACE');
          if(state.settings.mode==='references'&&storage?.pinBackup){const db=snapshot();const keys=new Set([...(db.works||[]),...(db.trash||[])].flatMap(w=>[w.image,w.preview]).filter(Boolean).map(v=>v.slice(1)));if(db.settings.profilePhoto)keys.add(db.settings.profilePhotoKey||'profile.webp');await storage.pinBackup(name,[...keys]);}
          const output=createWriteStream(partial,{flags:'wx',mode:0o600});
          output.set=output.attachment=()=>output;
          const complete=finished(output);complete.catch(()=>{});
          try {await exporter(dataDir,structuredClone(snapshot()),output,storage,{mode:state.settings.mode || 'portable'});await complete;}
          catch(error){output.destroy();await complete.catch(()=>{});throw error;}
          const checksum=createHash('sha256');for await(const chunk of createReadStream(partial))checksum.update(chunk);
          await rename(partial,file);
          const record={name,createdAt:new Date(now()).toISOString(),bytes:(await stat(file)).size,sha256:checksum.digest('hex')};
          record.mode=state.settings.mode || 'portable';
          if(offsite){await offsite.put(name,file,record.sha256);record.offsite=offsite.describe();}
          state.records.unshift(record);state.lastSuccess=record.createdAt;state.lastError='';
          // Persist the new archive before retiring any previous good backups.
          state.nextRun=state.settings.enabled?nextBackupAt(state.settings.hour,now()):null;
          await persist();
          while(state.records.length>state.settings.keep){const oldest=state.records.at(-1);if(oldest.offsite&&offsite&&JSON.stringify(oldest.offsite)===JSON.stringify(offsite.describe()))await offsite.remove(oldest.name);await unlink(filePath(oldest.name)).catch(error=>{if(error.code!=='ENOENT')throw error;});if(oldest.mode==='references')await storage?.releaseBackup?.(oldest.name);state.records.pop();}
          if(offsite)for(const record of state.records.slice(state.settings.keepLocal ?? state.settings.keep))if(record.offsite){await unlink(filePath(record.name)).catch(e=>{if(e.code!=='ENOENT')throw e;});record.localRemoved=true;}
        } catch(error) {if(!state.records.some(r=>r.name===name)){await unlink(file).catch(()=>{});await storage?.releaseBackup?.(name).catch(()=>{});if(offsite)await offsite.remove(name).catch(()=>{});}state.lastError=error.message==='SPACE'?'磁盘剩余空间不足，本次备份未开始。请释放空间或调整备份方式。':'备份或异地同步未完成。请检查磁盘空间、目录权限和 OSS 连接；已完成的历史备份仍保留。';}
        finally {
          await unlink(partial).catch(()=>{});
          state.nextRun=state.settings.enabled?nextBackupAt(state.settings.hour,now()):null;
          try{await persist();}catch{state.lastError='备份状态保存失败，请检查数据目录权限和空间。';}
          running=false;release();
        }
      })();
      return true;
    },
    tick(){if(state.settings.enabled && (!state.nextRun || Date.parse(state.nextRun)<=now()))return manager.start(false);return false;},
    wait(){return task;},
    listen(){timer=setInterval(()=>manager.tick(),60000).unref();manager.tick();},
    close(){clearInterval(timer);}
  };
  return manager;
}
