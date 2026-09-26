import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';

export async function prepareWorkImages(buffer,kind,storage) {
  const meta=await sharp(buffer,{limitInputPixels:160000000}).metadata();
  if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages || 1)>1)throw Error('请选择静态 JPG、PNG 或 WebP 图片');
  const rotated=[5,6,7,8].includes(meta.orientation),ratio=rotated?meta.height/meta.width:meta.width/meta.height;
  if(kind==='panorama'&&Math.abs(ratio-2)>0.03)throw Error('全景需要宽高比为 2:1 的完整球形全景图');
  const id=randomUUID(),image=`uploads/${id}.webp`,preview=`uploads/${id}-preview.webp`;
  const pipeline=sharp(buffer,{limitInputPixels:160000000}).rotate();
  try {
    const {data,info}=await pipeline.clone().resize({width:kind==='panorama'?8192:2800,height:kind==='panorama'?undefined:2800,fit:'inside',withoutEnlargement:true}).webp({quality:90,effort:4}).toBuffer({resolveWithObject:true});
    await storage.put(image,data);
    await storage.put(preview,await pipeline.clone().resize({width:600,height:600,fit:'inside',withoutEnlargement:true}).webp({quality:85,effort:4}).toBuffer());
    return {image:'/'+image,preview:'/'+preview,width:info.width,height:info.height,sourceHash:createHash('sha256').update(buffer).digest('hex'),imageUpdatedAt:new Date().toISOString()};
  } catch(error) {for(const key of [image,preview])await storage.remove(key).catch(()=>{});throw error;}
}
