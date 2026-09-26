import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const defaults = { settings: { name: '光屿', subtitle: '摄影作品集', bio: '', email: '', wechat: '' }, works: [], series: [] };

// Keep the route-level snapshot API while storing/updating individual records transactionally.
export function openPortfolio(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'portfolio.sqlite');
  const sql = new DatabaseSync(file);
  sql.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL,
      kind TEXT, status TEXT, category TEXT, series_id TEXT);
    CREATE INDEX IF NOT EXISTS works_filter ON works(kind,status,category,series_id);
    CREATE TABLE IF NOT EXISTS series (id TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
    PRAGMA user_version=1;`);
  const getMeta = sql.prepare('SELECT value FROM metadata WHERE key=?');
  const setMeta = sql.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value');
  const upsertWork = sql.prepare(`INSERT INTO works VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    position=excluded.position,payload=excluded.payload,kind=excluded.kind,status=excluded.status,category=excluded.category,series_id=excluded.series_id
    WHERE payload<>excluded.payload OR position<>excluded.position`);
  const upsertSeries = sql.prepare('INSERT INTO series VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,payload=excluded.payload WHERE payload<>excluded.payload OR position<>excluded.position');
  function save(snapshot) {
    if (!snapshot?.settings || !Array.isArray(snapshot.works) || (snapshot.series && !Array.isArray(snapshot.series))) throw Error('作品数据格式无效');
    for (const list of [snapshot.works, snapshot.series || []]) {
      if (list.some(item => !item || typeof item.id !== 'string' || !item.id) || new Set(list.map(item => item.id)).size !== list.length) throw Error('作品或系列标识无效');
    }
    sql.exec('BEGIN IMMEDIATE');
    try {
      const { works, series = [], ...rest } = snapshot;
      setMeta.run('portfolio', JSON.stringify(rest));
      works.forEach((work, index) => upsertWork.run(work.id,index,JSON.stringify(work),work.kind || '',work.status || 'published',work.category || '',work.seriesId || ''));
      series.forEach((entry,index) => upsertSeries.run(entry.id,index,JSON.stringify(entry)));
      for (const [table, entries] of [['works',works],['series',series]]) {
        const ids = new Set(entries.map(entry => entry.id));
        const remove = sql.prepare(`DELETE FROM ${table} WHERE id=?`);
        for (const {id} of sql.prepare(`SELECT id FROM ${table}`).all()) if (!ids.has(id)) remove.run(id);
      }
      sql.exec('COMMIT');
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }
  try {
    if (!getMeta.get('portfolio')) {
      const legacy = path.join(dataDir,'portfolio.json');
      save(existsSync(legacy) ? JSON.parse(readFileSync(legacy,'utf8')) : defaults);
      // Leave the legacy JSON untouched as a pre-migration recovery copy.
    }
  } catch (error) { sql.close(); throw error; }
  return {
    file, save,
    load() { return { ...JSON.parse(getMeta.get('portfolio').value), works:sql.prepare('SELECT payload FROM works ORDER BY position').all().map(row=>JSON.parse(row.payload)), series:sql.prepare('SELECT payload FROM series ORDER BY position').all().map(row=>JSON.parse(row.payload)) }; },
    asset(key) { const row=sql.prepare('SELECT payload FROM assets WHERE key=?').get(key); return row ? JSON.parse(row.payload) : null; },
    assets() { return sql.prepare('SELECT key,payload FROM assets').all().map(row=>({key:row.key,...JSON.parse(row.payload)})); },
    setAsset(key, value) { sql.prepare('INSERT INTO assets VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload').run(key,JSON.stringify(value)); },
    removeAsset(key) { sql.prepare('DELETE FROM assets WHERE key=?').run(key); },
    close() { sql.close(); }
  };
}
