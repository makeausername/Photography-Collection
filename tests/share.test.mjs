import test from 'node:test';
import assert from 'node:assert/strict';
import { shareEnvironment, sendToSystem } from '../public/share-support.js';
test('微信内与系统分享按能力分流，不假定浏览器能指定微信',()=>{
  assert.deepEqual(shareEnvironment('Windows MicroMessenger',true,true),{wechat:true,native:true});
  assert.deepEqual(shareEnvironment('iPhone Safari',true,true),{wechat:false,native:true});
  assert.equal(shareEnvironment('Windows Chrome',false,true).native,false);
  assert.equal(shareEnvironment('Android Chrome',true,false).native,false);
});
test('系统分享保持当前作品链接，取消不当作失败或已发送',async()=>{
  const data={title:'雪山',url:'https://example.com/work/1'}; let sent;
  assert.equal(await sendToSystem({share:async d=>{sent=d;}},data),'opened');
  assert.deepEqual(sent,data);
  assert.equal(await sendToSystem({share:async()=>{throw Object.assign(Error(),{name:'AbortError'});}},data),'cancelled');
  assert.equal(await sendToSystem({share:async()=>{throw Object.assign(Error(),{name:'NotAllowedError'});}},data),'unavailable');
  assert.equal(await sendToSystem({},data),'unavailable');
  assert.equal(await sendToSystem({canShare:()=>false,share:()=>assert.fail()},data),'unavailable');
});
