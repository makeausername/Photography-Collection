import { track } from './insights.js';
import { shareEnvironment, sendToSystem } from './share-support.js';
const $ = s => document.querySelector(s);
let current, returnFocus, loadId=0;
const environment = () => shareEnvironment(navigator.userAgent, typeof navigator.share === 'function', window.isSecureContext);
export async function openShare(work) {track('share',work.id);return openShareEndpoint('/api/share/'+encodeURIComponent(work.id),'分享作品');}
async function openShareEndpoint(endpoint,heading) {
  $('#share-heading').textContent=heading;
  returnFocus=document.activeElement; const ticket=++loadId;
  $('#share-status').textContent='正在加载…'; $('#share-content').hidden=true;
  $('#share-dialog').showModal();
  try {
    const response=await fetch(endpoint);
    if(!response.ok) throw Error('作品暂时无法分享，请稍后再试。');
    const info=await response.json(); if(ticket!==loadId || !$('#share-dialog').open)return;
    current=info; $('#system-share').disabled=false;
    $('#share-link').value=info.url; $('#share-caption').value=info.caption;
    $('#share-title').textContent=info.title;
    $('#share-local').hidden=!info.local;
    $('#share-qr-details').hidden=info.local; $('#share-qr-details').open=false;
    if(!info.local)$('#share-qr').src=info.qr;
    $('#share-poster').src=info.poster; $('#share-card').src=info.card;
    $('#save-poster').href=info.poster;
    $('#share-content').hidden=false;
    choose('wechat');
  } catch(error) {if(ticket===loadId)$('#share-status').textContent=error.message;}
}
function choose(platform) {
  $('#share-status').textContent='';
  for(const b of document.querySelectorAll('[data-share-platform]')) b.setAttribute('aria-pressed',String(b.dataset.sharePlatform===platform));
  $('#share-wechat').hidden=platform!=='wechat'; $('#share-xhs').hidden=platform!=='xhs';
  $('#share-image-label').textContent=platform==='wechat'?'链接封面':'分享图片';
  $('#share-card').hidden=platform!=='wechat'; $('#share-poster').hidden=platform!=='xhs';
  $('#save-poster').textContent=platform==='wechat'?'保存图片发朋友圈':'保存图片';
  const env=environment();
  $('#system-share').hidden=!env.native || env.wechat;
  $('#wechat-menu').hidden=!env.wechat;
  const atWork = location.pathname === new URL(current.url).pathname;
  $('#wechat-menu').textContent=atWork?'如何转发':'打开页面转发';
  $('#wechat-help').textContent=env.wechat
    ? atWork?'点右上角「···」，选择发送给朋友或朋友圈。':'先打开页面，再从右上角「···」转发。'
    : env.native?'选择微信发送；没有微信选项时，可复制链接。':'复制链接后，粘贴到微信聊天中发送。';
}
async function copy(value, fallback, message='已复制') {
  try { await navigator.clipboard.writeText(value); $('#share-status').textContent=message; }
  catch { $(fallback).closest('details')?.setAttribute('open',''); $(fallback).focus(); $(fallback).select(); $('#share-status').textContent='请复制选中的文字。'; }
}
$('#system-share').onclick=async()=>{
  const ticket=loadId; $('#system-share').disabled=true;
  const outcome=await sendToSystem(navigator,{title:current.title,url:current.url});
  if(ticket!==loadId || !$('#share-dialog').open)return;
  $('#system-share').disabled=false;
  if(outcome==='unavailable') {
    $('#system-share').hidden=true;
    $('#share-status').textContent='暂时无法打开分享菜单，请复制链接发送。';
  }
};
$('#wechat-menu').onclick=()=>{
  if(location.pathname!==new URL(current.url).pathname) {
    const url=new URL(current.url);url.searchParams.set('share','wechat');location.assign(url.href);
  } else $('#share-status').textContent='点微信右上角「···」，选择发送给朋友或朋友圈。';
};
for(const button of document.querySelectorAll('[data-share-platform]'))button.onclick=()=>choose(button.dataset.sharePlatform);
$('#copy-share-link').onclick=()=>copy(current.url,'#share-link','已复制，切到微信粘贴发送。');
$('#copy-share-caption').onclick=()=>copy(current.caption,'#share-caption','配文已复制');
$('#close-share').onclick=()=>$('#share-dialog').close();
$('#share-dialog').addEventListener('close',()=>{loadId++;returnFocus?.focus();});
for(const id of ['share-poster','share-card'])$('#'+id).onerror=()=>{$('#share-status').textContent='图片加载失败，请重新打开。';};

for(const button of document.querySelectorAll('[data-page-share]'))button.onclick=()=>{const series=button.dataset.pageShare==='series'?document.body.dataset.seriesId:'';openShareEndpoint('/api/page-share'+(series?'?series='+encodeURIComponent(series):''),series?'分享系列':'分享网站');};
