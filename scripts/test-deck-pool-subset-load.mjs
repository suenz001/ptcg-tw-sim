/** v5.894 對戰按牌組只載必要卡包:card-set-map.json + loadDeckSets()。
 *  ① 對照表涵蓋所有 live 卡(每張都有 set) ② loadDeckSets 只回傳所屬卡包的卡+正確 missingIds。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dp-s.js'), E = join(ROOT, '.dp-e.ts'), O = join(ROOT, '.dp-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { loadDeckSets, loadCardSetMap, deckEntriesAllInPool } from './src/lib/cards/pool';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { loadDeckSets, loadCardSetMap, deckEntriesAllInPool } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
// fetch shim:把 /cards/xxx.json?v= 映射到本地檔
const staticRoot = join(ROOT, 'static');
const fetchShim = async (url) => {
  const s = String(url);
  if (s.includes('card-set-map.json')) {
    const f = join(staticRoot, 'card-set-map.json');
    if (!existsSync(f)) return { ok:false, status:404, json: async()=>({}) };
    return { ok:true, status:200, json: async()=>JSON.parse(readFileSync(f,'utf8')) };
  }
  const m = s.match(/\/cards\/([^?]+)/);
  const file = join(dir, m[1]);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  const txt = readFileSync(file, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};

let pass = 0, fail = 0;
const T = (n, f) => f.then ? f.then(()=>{console.log('  OK',n);pass++;}).catch(e=>{console.log('  FAIL',n,'::',e.message);fail++;}) : (()=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}})();

const live = JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code);
const liveSet = new Set(live);

await T('★對照表涵蓋所有 live 卡(每張 live 卡都有 set 對應)', async () => {
  const map = await loadCardSetMap(fetchShim);
  let missing = 0, total = 0;
  for (const code of live) {
    const cards = JSON.parse(readFileSync(join(dir, code+'.json'),'utf8'));
    for (const c of cards) { if (c?.id==null) continue; total++; if (!map[String(c.id)]) missing++; }
  }
  assert.equal(missing, 0, `有 ${missing}/${total} 張 live 卡在對照表查無 set`);
});

await T('★loadDeckSets 只回傳所屬卡包的卡(取兩個卡包各1張)', async () => {
  // 取 SV5K 與 MJ 各一張卡 id
  const sv5k = JSON.parse(readFileSync(join(dir,'SV5K.json'),'utf8'));
  const mj = JSON.parse(readFileSync(join(dir,'MJ.json'),'utf8'));
  const id1 = String(sv5k[0].id), id2 = String(mj[0].id);
  const { cards, missingIds } = await loadDeckSets([id1, id2, id1], fetchShim); // 含重複 id
  const ids = new Set(cards.map(c=>String(c.id)));
  assert.ok(ids.has(id1) && ids.has(id2), '兩卡都在回傳卡集內');
  assert.equal(missingIds.length, 0, '無 missing');
  // 回傳只含這兩個卡包 → 卡數 = SV5K + MJ,不含其他包
  const setCodes = new Set(cards.map(c=>c.setCode));
  assert.ok(setCodes.has('SV5K') && setCodes.has('MJ'), '含 SV5K+MJ');
  assert.equal(setCodes.size, 2, `只載 2 個卡包(實際 ${[...setCodes]})`);
});

await T('★未知 cardId → 回報 missingIds(供呼叫端 fallback 全載)', async () => {
  const { missingIds } = await loadDeckSets(['999999999'], fetchShim);
  assert.ok(missingIds.includes('999999999'), '未知 id 進 missingIds');
});

await T('deckEntriesAllInPool:全在→true、缺一→false、空→false', () => {
  const pool = new Map([['1',{}],['2',{}]]);
  assert.equal(deckEntriesAllInPool([{cardId:'1'},{cardId:'2'}], pool), true);
  assert.equal(deckEntriesAllInPool([{cardId:'1'},{cardId:'9'}], pool), false, '缺卡→false');
  assert.equal(deckEntriesAllInPool([], pool), false, '空→false');
  assert.equal(deckEntriesAllInPool(null, pool), false);
});

setTimeout(()=>{ console.log('\n對戰按牌組載入(v5.894):PASS '+pass+' / FAIL '+fail); process.exit(fail?1:0); }, 100);
