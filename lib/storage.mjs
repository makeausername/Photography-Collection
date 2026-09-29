import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const validKey = key => typeof key === 'string' && /^(uploads\/[a-zA-Z0-9._-]+|profile\.webp)$/.test(key) && !key.includes('..');
const httpsOrigin = (value, label) => {
  let url;try {url=new URL(value);}catch {throw Error(label+' 必须是 HTTPS 根域名');}
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error(label+' 必须是 HTTPS 根域名');
  return url.origin;
};
export function storageConfig(env = process.env) {
  const provider=env.STORAGE_PROVIDER || 'local';
  if (!['local','oss'].includes(provider)) throw Error('STORAGE_PROVIDER 只支持 local 或 oss');
  if (provider === 'local') return {provider};
  for (const key of ['OSS_REGION','OSS_BUCKET','OSS_ACCESS_KEY_ID','OSS_ACCESS_KEY_SECRET','OSS_PUBLIC_BASE_URL']) if (!env[key]) throw Error('OSS 配置缺少 '+key);
  if (!/^oss-[a-z0-9-]+$/.test(env.OSS_REGION) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.OSS_BUCKET)) throw Error('OSS 地域或 Bucket 名称无效');
  const prefix=env.OSS_PREFIX || 'portfolio';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw Error('OSS_PREFIX 格式无效');
  const expires=Number(env.OSS_URL_TTL || 300);
  if (!Number.isInteger(expires) || expires<60 || expires>3600) throw Error('OSS_URL_TTL 应为 60～3600 秒');
  const publicBase=httpsOrigin(env.OSS_PUBLIC_BASE_URL,'OSS_PUBLIC_BASE_URL');
  const endpoint=env.OSS_ENDPOINT ? httpsOrigin(env.OSS_ENDPOINT,'OSS_ENDPOINT') : undefined;
  const cdnBase=env.CDN_BASE_URL ? httpsOrigin(env.CDN_BASE_URL,'CDN_BASE_URL') : '';
  if (cdnBase && !/^[a-zA-Z0-9]{6,128}$/.test(env.CDN_AUTH_KEY || '')) throw Error('使用 CDN 时必须配置 A 类型鉴权密钥 CDN_AUTH_KEY');
  return {provider,prefix,expires,publicBase,cdnBase,cdnKey:env.CDN_AUTH_KEY,endpoint,region:env.OSS_REGION,bucket:env.OSS_BUCKET,accessKeyId:env.OSS_ACCESS_KEY_ID,accessKeySecret:env.OSS_ACCESS_KEY_SECRET,stsToken:env.OSS_STS_TOKEN || undefined};
}
export function cdnSignedURL(base,key,secret,now=Math.floor(Date.now()/1000),rand=randomUUID().replaceAll('-','')) {
  const uri='/'+key;
  const digest=createHash('md5').update(`${uri}-${now}-${rand}-0-${secret}`).digest('hex');
  return `${base}${uri}?auth_key=${now}-${rand}-0-${digest}`;
}

export async function createStorage(dataDir, repository, {config=storageConfig(), client, signer} = {}) {
  if (config.provider === 'oss' && !client) {
    const {default:OSS}=await import('ali-oss');
    const options={region:config.region,bucket:config.bucket,accessKeyId:config.accessKeyId,accessKeySecret:config.accessKeySecret,stsToken:config.stsToken,authorizationV4:true,secure:true,timeout:60000};
    const endpoint=config.endpoint || config.publicBase;
    client=new OSS({...options,endpoint,cname:!new URL(endpoint).hostname.endsWith('.aliyuncs.com')});
    signer=new OSS({...options,endpoint:config.publicBase,cname:true});
  }
  signer ||= client;
  const pinsFile=path.join(dataDir,'backup-pins.json');
  let pins={};try{pins=JSON.parse(await readFile(pinsFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('备份图片保留记录无法读取');}
  const persistPins=async next=>{const temporary=pinsFile+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(next),{mode:0o600});await rename(temporary,pinsFile);pins=next;}finally{await unlink(temporary).catch(()=>{});}};
  const pinned=objectKey=>Object.values(pins).some(records=>records.some(r=>r.objectKey===objectKey));
  const localPath=key=>{if(!validKey(key))throw Error('文件路径无效');return path.join(dataDir,key);};
  function remote(record) {
    if (!client || record.bucket !== config.bucket || record.region !== config.region) throw Error('当前 OSS 配置与图片所在存储空间不一致');
    return record.objectKey;
  }
  async function putRemote(objectKey, buffer, type, cache='private, no-store') {
    const sha256=hash(buffer);
    await client.put(objectKey,buffer,{headers:{'Content-Type':type,'Cache-Control':cache,'x-oss-object-acl':'private','x-oss-meta-sha256':sha256}});
    const result=await client.head(objectKey);
    if (Number(result.res.headers['content-length'])!==buffer.length || result.res.headers['x-oss-meta-sha256']!==sha256) throw Error('OSS 文件校验未通过');
    return {provider:'oss',objectKey,bucket:config.bucket,region:config.region,size:buffer.length,sha256,type};
  }
  const store={
    provider:config.provider,
    async pinBackup(name,keys){const records=store.manifest(keys);await persistPins({...pins,[name]:records});},
    async releaseBackup(name){
      const records=pins[name] || [],next={...pins};delete next[name];
      for(const record of records)if(!Object.values(next).some(list=>list.some(r=>r.objectKey===record.objectKey))&&!repository.assets().some(r=>r.objectKey===record.objectKey&&!r.pendingDelete))await client.delete(remote(record));
      await persistPins(next);
    },
    manifest(keys){if(config.provider!=='oss')throw Error('轻量备份要求全部图片已迁移到 OSS');return keys.map(key=>{localPath(key);const record=repository.asset(key);if(record?.provider!=='oss'||record.pendingDelete)throw Error('轻量备份要求全部图片已迁移到 OSS');remote(record);return {key,...record};});},
    origins:config.provider==='oss' ? [config.publicBase,config.cdnBase].filter(Boolean) : [],
    describe() {
      const records=repository.assets();
      return {provider:config.provider,database:'sqlite',bucket:config.bucket || '',region:config.region || '',cdn:!!config.cdnBase,remoteFiles:records.filter(x=>x.provider==='oss'&&!x.pendingDelete).length,remoteBytes:records.filter(x=>x.provider==='oss'&&!x.pendingDelete).reduce((n,x)=>n+x.size,0),pendingDeletes:records.filter(x=>x.pendingDelete).length};
    },
    async info(key) {
      localPath(key);
      const record=repository.asset(key);
      if(record?.provider==='oss') { remote(record); return {...record,fingerprint:record.sha256}; }
      const info=await stat(localPath(key));
      return {provider:'local',size:info.size,fingerprint:`${info.size}:${info.mtimeMs}`};
    },
    async read(key) {
      localPath(key);
      const record=repository.asset(key);
      if(record?.provider==='oss') {
        const result=await client.get(remote(record));
        if (hash(result.content)!==record.sha256) throw Error('图片完整性校验失败');
        return result.content;
      }
      return readFile(localPath(key));
    },
    async put(key,buffer,type=/\.jpe?g$/i.test(key)?'image/jpeg':'image/webp') {
      const file=localPath(key);
      if(config.provider==='oss') {
        // Immutable object names also make simultaneous profile replacements safe.
        const objectKey=`${config.prefix}/private/${key}/${hash(buffer)}.webp`;
        const record=await putRemote(objectKey,buffer,type);
        repository.setAsset(key,record);
      } else {
        await mkdir(path.dirname(file),{recursive:true});
        const tmp=file+'.'+randomUUID()+'.tmp';
        try {await writeFile(tmp,buffer);await rename(tmp,file);} finally {await unlink(tmp).catch(()=>{});}
        repository.setAsset(key,{provider:'local',size:buffer.length,sha256:hash(buffer),type});
      }
    },
    async remove(key) {
      localPath(key);
      const record=repository.asset(key);
      if(record?.provider==='oss') {
        repository.setAsset(key,{...record,pendingDelete:true});
        if(!pinned(record.objectKey))await client.delete(remote(record));
      }
      await unlink(localPath(key)).catch(error=>{if(error.code!=='ENOENT')throw error;});
      repository.removeAsset(key);
    },
    async retryDeletes() {
      let removed=0;
      for(const entry of repository.assets().filter(x=>x.pendingDelete)) {await store.remove(entry.key);removed++;}
      return removed;
    },
    async migrate(key,{removeLocal=false}={}) {
      const file=localPath(key);
      if(config.provider!=='oss')throw Error('迁移前请配置 OSS');
      const existing=repository.asset(key);
      if(existing?.provider==='oss') { await store.read(key); }
      else {
        const buffer=await readFile(file);
        const objectKey=`${config.prefix}/private/${key}/${hash(buffer)}`;
        const record=await putRemote(objectKey,buffer,/\.jpe?g$/i.test(key)?'image/jpeg':'image/webp');
        const result=await client.get(objectKey);
        if(!buffer.equals(result.content))throw Error('迁移后校验失败');
        // Switch the reference only after the full remote object passes verification.
        repository.setAsset(key,record);
      }
      if(removeLocal) {
        const local=await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(local && hash(local)!==repository.asset(key).sha256)throw Error('本地文件已改变，保留原文件');
        await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
      }
    },
    async deliveryURL(key, buffer, type, method='GET') {
      if(config.provider!=='oss')return null;
      if(!/^[a-f0-9]{64}\.(webp|jpg)$/.test(key))throw Error('展示图标识无效');
      const objectKey=`${config.prefix}/display/${key}`;
      try {await client.head(objectKey);} catch(error) {if(error.status!==404)throw error;await putRemote(objectKey,buffer,type,'public, max-age=300');}
      if(config.cdnBase)return cdnSignedURL(config.cdnBase,objectKey,config.cdnKey);
      return signer.signatureUrlV4(method,config.expires,{headers:{},queries:{}},objectKey);
    },
    async check() {
      if(!client){const key=`uploads/check-${randomUUID()}.webp`,buffer=Buffer.from('storage-check');try{await store.put(key,buffer);if(!buffer.equals(await store.read(key)))throw Error('校验失败');}finally{await store.remove(key);}return {ok:true,provider:'local'};}
      const key=`${config.prefix}/checks/${randomUUID()}.txt`,buffer=Buffer.from('storage-check');
      try {await putRemote(key,buffer,'text/plain');const result=await client.get(key);if(!buffer.equals(result.content))throw Error('校验失败');}
      finally {await client.delete(key);}
      return {ok:true,provider:'oss'};
    }
  };
  // Never silently fall back to a stale local copy when cloud credentials are absent/wrong.
  for(const entry of repository.assets())if(entry.provider==='oss')remote(entry);
  return store;
}
