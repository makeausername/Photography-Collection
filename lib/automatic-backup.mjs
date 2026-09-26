import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { exportBackup } from './backup.mjs';

const filenamePattern=/^portfolio-\d{13}-[a-f0-9-]{36}\.tar\.gz$/;
export function nextBackupAt(hour,now=Date.now()) {
  const china=new Date(now+8*3600000);
  let next=Date.UTC(china.getUTCFullYear(),china.getUTCMonth(),china.getUTCDate(),hour)-8*3600000;
  if(next<=now)next+=86400000;
  return new Date(next).toISOString();
}
export function parseBackupSettings(value) {
  if(typeof value.enabled!=='boolean'||!Number.isInteger(value.hour)||value.hour<0||value.hour>23||!Number.isInteger(value.keep)||value.keep<1||value.keep>30)throw Error('请选择自动备份开关、0～23 点和 1～30 份保留数量');
  return {enabled:value.enabled,hour:value.hour,keep:value.keep};
}
export async function automaticBackups({dataDir,directory=path.join(dataDir,'auto-backups'),snapshot,storage,acquire,release,now=Date.now,exporter=exportBackup}) {
  directory=path.resolve(directory);
  const stateFile=path.join(dataDir,'backup-state.json');
  let state={settings:{enabled:false,hour:3,keep:7},records:[],lastSuccess:null,lastError:'',nextRun:null};
  try {state={...state,...JSON.parse(await readFile(stateFile,'utf8'))};state.settings=parseBackupSettings(state.settings);}
  catch(error){if(error.code!=='ENOENT')throw Error('自动备份配置无法读取，请检查 backup-state.json');}
  let running=false,task=Promise.resolve(),timer;
  const persist=async()=>{const tmp=stateFile+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});await rename(tmp,stateFile);}finally{await unlink(tmp).catch(()=>{});}};
  const filePath=name=>{if(!filenamePattern.test(name))throw Error('备份文件名无效');const file=path.resolve(directory,name);if(path.dirname(file)!==directory)throw Error('备份路径无效');return file;};
  const manager={
    status(){return {...state,running,destination:directory,timezone:'Asia/Shanghai'};},
    async configure(value){if(running)throw Error('备份正在进行，请完成后再修改计划');const settings=parseBackupSettings(value);const previous=state;state={...state,settings,nextRun:settings.enabled?nextBackupAt(settings.hour,now()):null};try{await persist();}catch(error){state=previous;throw error;}return manager.status();},
    async file(name){const record=state.records.find(item=>item.name===name);if(!record)throw Error('备份不存在');const file=filePath(name);await stat(file);return file;},
    start(manual=false){
      if(running || !acquire(manual))return false;
      running=true;
      task=(async()=>{
        const name=`portfolio-${now()}-${randomUUID()}.tar.gz`,file=filePath(name),partial=file+'.part';
        try {
          await mkdir(directory,{recursive:true});
          const output=createWriteStream(partial,{flags:'wx',mode:0o600});
          output.set=output.attachment=()=>output;
          const complete=finished(output);complete.catch(()=>{});
          try {await exporter(dataDir,structuredClone(snapshot()),output,storage);await complete;}
          catch(error){output.destroy();await complete.catch(()=>{});throw error;}
          const checksum=createHash('sha256');for await(const chunk of createReadStream(partial))checksum.update(chunk);
          await rename(partial,file);
          const record={name,createdAt:new Date(now()).toISOString(),bytes:(await stat(file)).size,sha256:checksum.digest('hex')};
          state.records.unshift(record);state.lastSuccess=record.createdAt;state.lastError='';
          // Persist the new archive before retiring any previous good backups.
          state.nextRun=state.settings.enabled?nextBackupAt(state.settings.hour,now()):null;
          await persist();
          while(state.records.length>state.settings.keep){const oldest=state.records.at(-1);await unlink(filePath(oldest.name)).catch(error=>{if(error.code!=='ENOENT')throw error;});state.records.pop();}
        } catch {state.lastError='备份或旧备份清理未完成，请检查目录权限和可用空间。请以备份记录确认已完成的版本。';}
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
