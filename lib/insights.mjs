import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// Aggregate counts only; IP addresses and visitor identifiers are never persisted.
export function insights(directory) {
  const sql=new DatabaseSync(path.join(directory,'insights.sqlite'));
  sql.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS events(day TEXT,work TEXT,event TEXT,count INTEGER,PRIMARY KEY(day,work,event))');
  const seen=new Map(),salt=randomBytes(32);
  const statement=sql.prepare('INSERT INTO events VALUES(?,?,?,1) ON CONFLICT(day,work,event) DO UPDATE SET count=count+1');
  let cleaned='';
  return {
    record(work,event,address,now=Date.now()) {
      if(!['view','share','contact'].includes(event))return false;
      const day=new Date(now+8*3600000).toISOString().slice(0,10);
      const key=createHash('sha256').update(salt).update(address+'|'+work+'|'+event).digest('hex');
      if((seen.get(key)||0)>now)return false;
      for(const [k,expiry]of seen)if(expiry<=now)seen.delete(k);
      if(seen.size>=10000)return false;
      seen.set(key,now+30*60000);statement.run(day,work,event);
      if(cleaned!==day){sql.prepare('DELETE FROM events WHERE day<?').run(new Date(now-365*86400000).toISOString().slice(0,10));cleaned=day;}
      return true;
    },
    report(works,now=Date.now()) {
      const since=new Date(now+8*3600000-29*86400000).toISOString().slice(0,10);
      const totals={view:0,share:0,contact:0},byWork=new Map();
      for(const row of sql.prepare('SELECT work,event,SUM(count) AS count FROM events WHERE day>=? GROUP BY work,event').all(since)){
        totals[row.event]+=row.count;
        const work=works.find(w=>w.id===row.work);if(!work)continue;
        if(!byWork.has(row.work))byWork.set(row.work,{id:row.work,title:work.title,view:0,share:0,contact:0});
        byWork.get(row.work)[row.event]+=row.count;
      }
      return {since,totals,works:[...byWork.values()].sort((a,b)=>b.view-a.view).slice(0,30)};
    },
    close(){sql.close();}
  };
}
