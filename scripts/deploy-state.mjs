import { existsSync, mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync, chmodSync, chownSync, readdirSync, unlinkSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPortfolio } from '../lib/database.mjs';
import { acquireDataLock } from '../lib/runtime-lock.mjs';
import { nextBackupAt } from '../lib/automatic-backup.mjs';

export function validateDomain(value){
  const domain=String(value || '').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
  if(domain.length>253||!domain.includes('.')||!domain.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(domain.split('.').at(-1))||/\.(localhost|local|internal|test|invalid)$/.test(domain))throw Error('请填写公网域名，不含路径、端口或通配符。中文域名请使用 Punycode。');
  return domain;
}
const siteDefaults={name:'KosmoYonder',subtitle:'风光与旅行摄影',homeIntro:'主要拍自然风光，常拍星空、朝霞晚霞和云海，偶尔也拍人像。',bio:'我是 KosmoYonder，主要拍自然风光，偶尔也拍人像。常拍的题材有星空银河、朝霞晚霞、云海和山川。\n\n喜欢四处旅行，也喜欢一个人在路上，按自己的节奏走走停停。\n\n名字里的 K 是我的名字首字母，Yonder 是远方的意思。\n\n视觉中国、图虫签约摄影师。',email:'',wechat:'',icpNumber:'',heroAutoplay:'on',heroInterval:7};
const readJSON=file=>JSON.parse(readFileSync(file,'utf8'));
function safePath(file){if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('部署目录中存在符号链接，已停止写入');}
function privateWrite(file,value){safePath(file);const temporary=file+'.'+randomBytes(8).toString('hex')+'.tmp';try{writeFileSync(temporary,value,{mode:0o600,flag:'wx'});renameSync(temporary,file);chmodSync(file,0o600);}finally{if(existsSync(temporary))unlinkSync(temporary);}}
const shellQuote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
function ownData(directory){
  safePath(directory);
  for(const entry of readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);safePath(file);if(entry.isDirectory())ownData(file);else {chmodSync(file,0o600);if(process.platform==='linux'&&process.getuid()===0)chownSync(file,1000,1000);}}
  chmodSync(directory,0o700);if(process.platform==='linux'&&process.getuid()===0)chownSync(directory,1000,1000);
}
export function deploymentReport(state,credential,source){
  const quote=shellQuote(source),base='https://'+state.domain;
  return `# KosmoYonder 部署资料（请私下保存）

生成时间：${new Date().toISOString()}
部署状态：${state.verifiedAt?'HTTPS 与本站标识检查通过，检查时间 '+state.verifiedAt:'已初始化；尚未通过公网 HTTPS 检查，不代表上线完成。'}

## 访问与登录

- 网站：${base}/
- 后台：${base}/admin
- 管理员：单管理员模式，无需用户名。
- 初始密码：${credential.passwordCurrent ? '`'+credential.password+'`' : '沿用已有密码；本文件不显示过期密码。'}
- 登录后可在“修改密码”中修改。修改后这里的初始密码会失效，请同步更新自己保存的资料。

## 数据与证书

- 安装目录：${source}
- GitHub 仓库：https://github.com/makeausername/Photography-Collection（main 分支）
- 本次初始化源码版本：${state.sourceCommit || '未记录'}
- 数据库：SQLite，文件 .deployment/data/portfolio.sqlite；无独立数据库用户名或密码，不开放数据库端口。
- 作品文件与登录资料：.deployment/data/（密码仅保存加盐哈希）。
- 定时备份：.deployment/backups/；首次安装默认每天北京时间 03:00，保留 7 份。后续以后台保存的计划为准。
- 证书和 ACME 账户：.deployment/caddy-data/；Caddy 自动申请、续期并将 HTTP 跳转 HTTPS，无需另设续期 cron。
- 部署环境：.deployment/deploy.env；初始凭据：.deployment/credentials.json；本资料：.deployment/部署资料.md。
- 上述资料目录不进入 Git、不进入镜像构建上下文，不由网站提供下载；请用 SSH / SFTP 下载本文件到自己的设备。
- 图片默认保存在本地。OSS 需要真实 Bucket、域名和授权配置，不会自动创建或购买云资源。

## 维护命令

在安装目录执行：

~~~bash
cd ${quote}
sudo bash deploy.sh status
sudo bash deploy.sh logs
sudo bash deploy.sh verify
sudo bash deploy.sh stop
sudo bash deploy.sh start
~~~

更新：本地修改并推送到 GitHub 后，先在后台“存储与备份”生成并下载完整备份，再在服务器执行：

~~~bash
cd ${quote}
sudo bash deploy.sh update
~~~

该命令自动从 GitHub main 拉取并快进更新，再构建部署。源码有本地修改、历史分叉或远端包含私密目录时会停止，不强制重置。也可运行 sudo bash update.sh，效果相同。

服务器的 OSS 等个性配置放在 .deployment/compose.override.yaml（权限 600），不要修改受 Git 跟踪的 deploy/compose.yaml。更新自动读取并保留私密配置。

更新不重置数据库、管理员密码或证书。构建失败会停止更新；启动失败可查看日志并还原上一版源码后重试。脚本不会自动做代码回滚。

## 备份与恢复

定时归档与网站默认在同一台服务器，请定期下载或同步到独立设备。可将独立磁盘挂载到 .deployment/backups/，保持 UID/GID 1000 可写；容器路径固定为 /app/backups。

完整迁移：先停止服务，将整个 .deployment 目录安全复制到新服务器的源码目录下，保留权限（包含证书、密码哈希和初始凭据）。更新 DNS 后运行 sudo bash deploy.sh；安装目录可变，域名保持一致。不要同时在两台机器上写同一份数据。

仅恢复后台下载的作品归档：先停止服务并保留旧数据，将归档解压到全新的 .deployment/data/（不要套额外子目录）。归档不含密码和证书。将旧 credentials.json 移到安全备份位置，再运行 sudo bash deploy.sh；会生成新的管理员密码及本资料。不要覆盖运行中的数据库，也不要把旧 -wal/-shm 文件与恢复的数据库混在一起。

不要删除 .deployment，不要将备份或凭据目录放到公开网站根目录。服务器快照或目录复制必须在停服后进行。

## 上线后核对

首次安装不导入演示照片。请上传自己的作品，填写邮箱、小红书及图库主页，并确认域名对应的备案信息后填写。已知 ICP 编号为沪ICP备2025140939号-1，本脚本不会自动将它挂到未经核对的新域名。

请在手机网络检查图片、全景、微信分享与后台上传，并下载一份备份验证。HTTPS 检查由本服务器执行，不能替代独立网络验收。保持域名解析和 80/443 可达，证书才能自动续期。
`;
}
export function initializeDeployment({directory,domain,instanceId,source,now=Date.now()}){
  domain=validateDomain(domain);if(!/^[a-f0-9]{32}$/.test(instanceId || ''))throw Error('部署标识无效');
  directory=path.resolve(directory);safePath(directory);mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
  const data=path.join(directory,'data'),backups=path.join(directory,'backups');
  for(const folder of [data,backups]){safePath(folder);mkdirSync(folder,{recursive:true,mode:0o700});}
  const stateFile=path.join(directory,'deployment.json'),credentialFile=path.join(directory,'credentials.json'),authFile=path.join(data,'admin.json');
  for(const file of [stateFile,credentialFile,authFile,path.join(data,'portfolio.sqlite'),path.join(data,'portfolio.json'),path.join(data,'backup-state.json')])safePath(file);
  const previous=existsSync(stateFile)?readJSON(stateFile):null;
  if(previous&&(previous.domain!==domain||previous.instanceId!==instanceId))throw Error('域名或部署标识与已有数据不一致，未修改原配置');
  // deploy.sh stops the only application container before this initializer runs.
  const release=acquireDataLock(data);let credential;
  try {
    if(existsSync(credentialFile))credential=readJSON(credentialFile);
    if(!existsSync(authFile)){
      if(credential && !credential.initializing)throw Error('登录资料丢失，请按部署资料恢复或移走旧凭据后重新初始化');
      if(!credential){const password=randomBytes(24).toString('base64url'),salt=randomBytes(32).toString('hex');credential={password,salt,hash:scryptSync(password,salt,64).toString('hex'),initializing:true};privateWrite(credentialFile,JSON.stringify(credential,null,2));}
      privateWrite(authFile,JSON.stringify({salt:credential.salt,hash:credential.hash},null,2));
    }
    if(credential?.initializing){credential.initializing=false;privateWrite(credentialFile,JSON.stringify(credential,null,2));}
    const fresh=!existsSync(path.join(data,'portfolio.sqlite'))&&!existsSync(path.join(data,'portfolio.json'));
    const repo=openPortfolio(data);try{if(fresh)repo.save({settings:siteDefaults,works:[],series:[]});}finally{repo.close();}
    const schedule=path.join(data,'backup-state.json');if(!existsSync(schedule))privateWrite(schedule,JSON.stringify({settings:{enabled:true,hour:3,keep:7},records:[],lastSuccess:null,lastError:'',nextRun:nextBackupAt(3,now)},null,2));
    const sourceFile=path.join(directory,'current-source-commit'),commit=existsSync(sourceFile)?readFileSync(sourceFile,'utf8').trim():'';
    const state={...previous,domain,instanceId,sourceCommit:/^[a-f0-9]{40,64}$/.test(commit)?commit:null,createdAt:previous?.createdAt || new Date(now).toISOString(),verifiedAt:null};
    privateWrite(stateFile,JSON.stringify(state,null,2));
    writeReport(directory,state,credential,source);
  }finally{release();}
  ownData(data);ownData(backups);
}
function writeReport(directory,state,credential,source){
  const auth=readJSON(path.join(directory,'data','admin.json'));
  const expected=credential?.password? scryptSync(credential.password,auth.salt,64):null;
  const passwordCurrent=!!expected && /^[a-f0-9]{128}$/.test(auth.hash) && timingSafeEqual(expected,Buffer.from(auth.hash,'hex'));
  privateWrite(path.join(directory,'部署资料.md'),deploymentReport(state,{...credential,passwordCurrent},source));
}
export function verifyDeploymentReport(directory,source){
  const state=readJSON(path.join(directory,'deployment.json'));state.verifiedAt=new Date().toISOString();privateWrite(path.join(directory,'deployment.json'),JSON.stringify(state,null,2));
  const credential=existsSync(path.join(directory,'credentials.json'))?readJSON(path.join(directory,'credentials.json')):null;writeReport(directory,state,credential,source);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const directory=process.env.DEPLOYMENT_DIR || '/deployment',source=process.env.DEPLOYMENT_SOURCE || '.';
    if(process.argv[2]==='initialize')initializeDeployment({directory,domain:process.env.DOMAIN,instanceId:process.env.DEPLOYMENT_ID,source});
    else if(process.argv[2]==='verified')verifyDeploymentReport(directory,source);
    else throw Error('未知初始化操作');
    console.log('部署资料已保存，密码未输出到终端。');
  }catch{console.error('初始化未完成。请检查域名配置、私密数据文件、数据目录锁和读写权限；脚本不会重置已有密码。');process.exitCode=1;}
}
