import sharp from 'sharp';
import QRCode from 'qrcode';

export const escapeXML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const titleLines = value => {
  const lines=[];let line='',used=0;
  for(const char of String(value || '')){const units=/[\x00-\x7f]/.test(char)?0.6:1;if(used+units>10.5){lines.push(line);line='';used=0;}line+=char;used+=units;}
  if(line)lines.push(line);return lines;
};
const short = (value, n) => [...String(value || '')].slice(0, n).join('');
export function shareInfo(work, settings, origin) {
  const base = `${origin}/work/${encodeURIComponent(work.id)}`;
  const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(new URL(origin).hostname);
  const byline = work.demo ? `示例图片 · ${work.credit || '原作者见作品页'}` : `摄影 / ${settings.name}`;
  return { url: base, card: base + '/card.jpg', poster: base + '/poster.jpg', qr: base + '/qr.svg', local,
    title: work.title, caption: [work.title, work.location && `拍摄于 ${work.location}`, byline, '查看作品：' + base].filter(Boolean).join('\n') };
}
export function qrImage(url) { return QRCode.toString(url, { type:'svg', margin:4, errorCorrectionLevel:'M', color:{dark:'#20332d',light:'#ffffff'} }); }

export async function shareArtwork(work, settings, info, source, poster) {
  const width = poster ? 1080 : 1200, height = poster ? 1440 : 630;
  const photoBox = poster ? {left:48,top:136,width:984,height:870} : {left:24,top:24,width:760,height:582};
  const photo = await sharp(source).resize({width:photoBox.width,height:photoBox.height,fit:'contain',background:'#18231f'}).jpeg({quality:90}).toBuffer();
  const font = 'Microsoft YaHei, Noto Sans CJK SC, sans-serif';
  const text = (x,y,size,value,fill='#24352f',extra='') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${font}" ${extra}>${escapeXML(value)}</text>`;
  const demoCredit = short('示例 · ' + (work.credit || '原作者见作品页').split(' · ').slice(0,2).join(' / '), 62);
  let art = '';
  if (poster) {
    art += text(48,78,32,'KosmoYonder', '#24352f','letter-spacing="2"');
    art += text(1032,76,17,work.kind==='panorama'?'360° / PANORAMA':'PHOTOGRAPHY / JOURNEYS','#7a8177','text-anchor="end"');
    art += `<path d="M48 106H1032M48 1270H1032" stroke="#c9cdc1"/>`;
    const lines = [...work.title];
    art += text(48,1082,38,lines.slice(0,23).join(''));
    if (lines.length>23) art += text(48,1135,32,lines.slice(23,46).join('') + (lines.length>46?'…':''));
    art += text(48,lines.length>23?1190:1140,22,short([work.location,work.category].filter(Boolean).join(' / '),38),'#6a756b');
    art += text(48,1238,18,work.demo?demoCredit:'© KosmoYonder · 分享展示，使用请联系授权','#6a756b');
    art += text(48,1327,25,'KosmoYonder');
    art += text(48,1374,18,info.local?'风光与旅行摄影':'扫码查看作品','#6a756b');
  } else {
    art += text(824,91,24,'KosmoYonder');
    art += text(824,132,13,work.kind==='panorama'?'360° / PANORAMA':'PHOTOGRAPHY / JOURNEYS','#748074','letter-spacing="1"');
    art += '<path d="M824 174H1160" stroke="#bdc6b8"/>';
    const title = titleLines(work.title);
    for(let i=0;i<3;i++) if(title[i]) art+=text(824,250+i*50,30,title[i]+(i===2&&title.length>3?'…':''));
    art += text(824,444,19,short(work.location || work.category,17),'#697466');
    art += text(824,551,16,work.demo?short('示例 · '+(work.credit || '署名见作品页').split(' · ')[0],28):'© KosmoYonder','#697466');
    art += text(824,583,13,'摄影作品集','#697466');
  }
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${art}</svg>`);
  const layers = [{input:photo,left:photoBox.left,top:photoBox.top},{input:overlay,left:0,top:0}];
  if (poster && !info.local) layers.push({input:await sharp(Buffer.from(await qrImage(info.url))).resize(140,140).png().toBuffer(),left:892,top:1280});
  return sharp({create:{width,height,channels:3,background:'#f3f1e8'}}).composite(layers).jpeg({quality:92}).toBuffer();
}
