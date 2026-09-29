import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function fileChecksum(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export async function offsiteBackup(env=process.env,client) {
  if(!env.BACKUP_OSS_BUCKET)return null;
  const region=env.BACKUP_OSS_REGION,bucket=env.BACKUP_OSS_BUCKET,prefix=env.BACKUP_OSS_PREFIX||'kosmoyonder-backups';
  if(!/^oss-[a-z0-9-]+$/.test(region||'')||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)||!/^[-\w]+(?:\/[-\w]+)*$/.test(prefix))throw Error('异地备份地域、Bucket 或目录无效');
  if(!client){if(!env.BACKUP_OSS_ACCESS_KEY_ID||!env.BACKUP_OSS_ACCESS_KEY_SECRET)throw Error('异地备份缺少专用访问密钥');const {default:OSS}=await import('ali-oss');client=new OSS({region,bucket,accessKeyId:env.BACKUP_OSS_ACCESS_KEY_ID,accessKeySecret:env.BACKUP_OSS_ACCESS_KEY_SECRET,secure:true,authorizationV4:true,timeout:120000});}
  const key=name=>{if(!/^portfolio-\d{13}-[a-f0-9-]{36}\.tar\.gz$/.test(name))throw Error('备份文件名无效');return prefix+'/'+name;};
  return {
    describe(){return {bucket,region,prefix};},
    async put(name,file,sha256){const size=(await stat(file)).size;await client.multipartUpload(key(name),file,{headers:{'Content-Type':'application/gzip','x-oss-object-acl':'private','x-oss-meta-sha256':sha256}});const result=await client.head(key(name));if(Number(result.res.headers['content-length'])!==size||result.res.headers['x-oss-meta-sha256']!==sha256)throw Error('异地备份校验失败');},
    async remove(name){await client.delete(key(name));},
    async stream(name){return (await client.getStream(key(name))).stream;}
  };
}
