import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { imageCache } from './image-cache.mjs';
export function panoramaConfig(work) {
  const enabled=work.panoramaMode==='tiles'||(work.panoramaMode!=='single'&&work.width>=4096);
  if(!enabled)return {type:'equirectangular',panorama:'/media/'+encodeURIComponent(work.id)+'/image.jpg'};
  const cubeResolution=work.width>=8192?2048:work.width>=4096?1024:512;
  return {type:'multires',multiRes:{path:'/panorama/'+encodeURIComponent(work.id)+'/%l/%s/%x/%y',extension:'webp',tileResolution:512,cubeResolution,maxLevel:Math.log2(cubeResolution/512)+1}};
}
export function panoramaTiles(directory,displayImage,storage) {
  const cache=imageCache(directory,{maxBytes:256*1024*1024}),pending=new Map();
  let worker,workerKey='',serial=Promise.resolve(),queued=0,idle;
  const stop=()=>{worker?.terminate();worker=undefined;workerKey='';};
  return async(work,settings,{level,face,x,y})=>{
    const config=panoramaConfig(work).multiRes;
    if(!config||!['f','b','u','d','l','r'].includes(face)||![level,x,y].every(Number.isInteger)||level<1||level>config.maxLevel)throw Error('INVALID_TILE');
    const size=512*2**(level-1),count=size/512;
    if(x<0||y<0||x>=count||y>=count)throw Error('INVALID_TILE');
    const info=await storage.info(work.image.slice(1));
    const sourceKey=createHash('sha256').update(JSON.stringify([work.image,info.fingerprint,!!work.demo,settings])).digest('hex');
    const key=createHash('sha256').update(sourceKey+':'+[level,face,x,y].join(':')).digest('hex');
    const cached=await cache.get(key);if(cached)return cached;
    if(pending.has(key))return pending.get(key);
    if(queued>=64)throw Error('BUSY');queued++;
    const job=serial.then(async()=>{
      clearTimeout(idle);
      const image=workerKey!==sourceKey?await displayImage(work,'image',settings):undefined;
      if(!worker){worker=new Worker(new URL('./panorama-worker.mjs',import.meta.url));worker.unref();}
      const buffer=await new Promise((resolve,reject)=>{
        const current=worker,timer=setTimeout(()=>{cleanup();stop();reject(Error('TIMEOUT'));},30000);
        const cleanup=()=>{clearTimeout(timer);current.off('message',message);current.off('error',error);current.off('exit',exit);};
        const error=()=>{cleanup();stop();reject(Error('TILE_FAILED'));};
        const exit=()=>error();
        const message=result=>{cleanup();if(result.error){stop();reject(Error('TILE_FAILED'));}else{workerKey=sourceKey;resolve(Buffer.from(result.buffer));}};
        current.once('message',message);current.once('error',error);current.once('exit',exit);
        current.postMessage({key:sourceKey,image,face,size,x,y});
      });
      await cache.put(key,buffer);return buffer;
    });
    pending.set(key,job);serial=job.catch(()=>{});
    job.finally(()=>{queued--;pending.delete(key);idle=setTimeout(stop,60000);idle.unref();}).catch(()=>{});
    return job;
  };
}
