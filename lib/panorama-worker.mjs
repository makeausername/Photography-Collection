import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';
let source,sourceKey;
export function direction(face,u,v) {
  return {f:[u,-v,-1],b:[-u,-v,1],u:[u,1,v],d:[u,-1,-v],l:[-1,-v,-u],r:[1,-v,u]}[face];
}
export function sampleTile(data,width,height,face,size,x,y,tileSize=512) {
  const tw=Math.min(tileSize,size-x*tileSize),th=Math.min(tileSize,size-y*tileSize),output=Buffer.alloc(tw*th*3);
  for(let row=0;row<th;row++)for(let col=0;col<tw;col++){
    const u=2*(x*tileSize+col+.5)/size-1,v=2*(y*tileSize+row+.5)/size-1;
    const [dx,dy,dz]=direction(face,u,v);
    const sx=(Math.atan2(dx,-dz)/(2*Math.PI)+.5)*width-.5;
    const sy=Math.max(0,Math.min(height-1,(.5-Math.asin(dy/Math.hypot(dx,dy,dz))/Math.PI)*height-.5));
    const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
    for(let c=0;c<3;c++){
      const at=(a,b)=>data[(Math.min(height-1,b)*width+((a%width)+width)%width)*3+c];
      output[(row*tw+col)*3+c]=(1-fy)*((1-fx)*at(ix,iy)+fx*at(ix+1,iy))+fy*((1-fx)*at(ix,iy+1)+fx*at(ix+1,iy+1));
    }
  }
  return {output,width:tw,height:th};
}
parentPort?.on('message',async job=>{
  try {
    if(sourceKey!==job.key){source=await sharp(Buffer.from(job.image)).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});sourceKey=job.key;}
    const tile=sampleTile(source.data,source.info.width,source.info.height,job.face,job.size,job.x,job.y);
    const buffer=await sharp(tile.output,{raw:{width:tile.width,height:tile.height,channels:3}}).webp({quality:85}).toBuffer();
    parentPort.postMessage({buffer});
  } catch {parentPort.postMessage({error:true});}
});
