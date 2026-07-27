// 守衛：AI 的引擎試打**不可以偷看牌庫順序**（v6.041）。
//
// 【為什麼需要這道防線】
// 現役有 111 個招式會抽牌或查看牌庫（「從自己的牌庫抽出N張」「查看自己的牌庫上方9張」…）。
// AI 評估一招時是真的用引擎打一次，所以引擎會**真的翻牌庫**。只要估值讀到任何受此
// 影響的結果，AI 就等於知道了自己牌庫的順序 —— 那是本站一路守下來的資訊紅線
// （v5.963 牌庫搜尋 0-pick 漏洗、v6.021 picker 前公開 log 洩漏候選）。
//
// ⚠這種洩漏是**不可見**的：不會有錯誤訊息、不會有畫面異常，只會讓 AI 在某些卡上
//   莫名地強。所以必須靠守衛，不能靠肉眼。
//
// 【防線的形狀】中央化：所有模擬入口在 clone 之後、applyAction 之前，一律先把雙方
// 牌庫洗亂。洗亂後的模擬在資訊論上等價於一次合法的隨機採樣（牌庫順序本來就不可知），
// 即使日後有人在估值端讀了依賴牌庫的欄位，也讀不到真實順序。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-dp-s.js'), E = join(ROOT, '.x-dp-e.ts'), O = join(ROOT, '.x-dp-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame } from './src/lib/game/engine';\n"
  + "export { shuffleHiddenZonesForSim, withIsolatedRandom, evaluateAttack } from './src/lib/game/ai-eval';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, shuffleHiddenZonesForSim, withIsolatedRandom, evaluateAttack }
  = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const liveC = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveC.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
function mkState(deckLen = 30) {
  const s = createGame({ name: 'P1', entries: [{ cardId: '13163', count: 1 }] },
                       { name: 'P2', entries: [{ cardId: '13163', count: 1 }] }, pool);
  const mkDeck = () => Array.from({ length: deckLen }, () => inst('13163'));
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], deck: mkDeck() }, { ...s.players[1], deck: mkDeck() }] };
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：這個專案真的有大量「會翻牌庫」的招式（沒有的話這道防線就是多餘的）', () => {
  let n = 0;
  const seen = new Set();
  for (const c of pool.values()) {
    if (!c || c.supertype !== 'Pokemon' || !['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of (c.attacks ?? [])) {
      const ef = a.effect ?? '';
      if (/自己的牌庫|牌庫上方/.test(ef) && /抽|查看|確認/.test(ef)) {
        const k = `${c.name}|${a.name}`;
        if (!seen.has(k)) { seen.add(k); n++; }
      }
    }
  }
  assert.ok(n > 20, `會翻自己牌庫的招式應該不少，實得 ${n}`);
  console.log(`   現役會抽牌／查看自己牌庫的招式：${n} 個 → 試打必定翻牌庫`);
});

T('⭐⭐洗亂後牌庫順序確實改變（否則防線形同虛設）', () => {
  const st = mkState(30);
  const before = st.players[0].deck.map((c) => c.iid);
  withIsolatedRandom(() => shuffleHiddenZonesForSim(st));
  const after = st.players[0].deck.map((c) => c.iid);
  assert.equal(after.length, before.length, '張數不可變');
  const samePos = after.filter((iid, i) => iid === before[i]).length;
  assert.ok(samePos < before.length * 0.6,
    `洗牌後有 ${samePos}/${before.length} 張留在原位 —— 幾乎沒洗到，防線無效`);
});

T('⭐⭐洗亂不可增減或竄改牌庫內容（只能換順序）', () => {
  const st = mkState(30);
  const before = [...st.players[0].deck.map((c) => c.iid)].sort();
  withIsolatedRandom(() => shuffleHiddenZonesForSim(st));
  const after = [...st.players[0].deck.map((c) => c.iid)].sort();
  assert.deepEqual(after, before, '洗牌只能改順序，卡片集合必須完全相同（憑空增減＝作弊）');
});

T('⭐雙方牌庫都要洗（對手的牌庫 AI 更沒有理由知道）', () => {
  const st = mkState(30);
  const b0 = st.players[0].deck.map((c) => c.iid);
  const b1 = st.players[1].deck.map((c) => c.iid);
  withIsolatedRandom(() => shuffleHiddenZonesForSim(st));
  const same0 = st.players[0].deck.map((c) => c.iid).filter((x, i) => x === b0[i]).length;
  const same1 = st.players[1].deck.map((c) => c.iid).filter((x, i) => x === b1[i]).length;
  assert.ok(same0 < b0.length * 0.6, '我方牌庫應被洗亂');
  assert.ok(same1 < b1.length * 0.6, '對手牌庫也應被洗亂');
});

T('⭐⭐所有模擬入口都必須經過這道中央防線（不可有人繞過去）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/ai-eval.ts'), 'utf8');
  // 每一處把複本交給引擎的地方，都要先過洗牌
  const rawClones = [...src.matchAll(/applyAction\(\s*cloneState\(/g)];
  assert.deepEqual(rawClones.map((m) => m.index), [],
    '有模擬入口直接把 cloneState 的結果丟給 applyAction，繞過了洗牌防線 —— '
    + '一律要寫成 applyAction(shuffleHiddenZonesForSim(cloneState(state)), …)');
  const guarded = [...src.matchAll(/shuffleHiddenZonesForSim\(cloneState\(/g)].length;
  assert.ok(guarded >= 3, `經過防線的模擬入口只有 ${guarded} 處，應涵蓋全部（試打／評估／換上場估算）`);
});

T('⭐洗牌必須用隔離的 PRNG，不可消耗真實對局的隨機序列', () => {
  const st = mkState(30);
  const orig = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return orig(); };
  try { evaluateAttack(st, 0, 0, pool); } finally { Math.random = orig; }
  assert.equal(calls, 0,
    `評估（含洗牌）期間外部 Math.random 被呼叫 ${calls} 次 —— `
    + '洗牌是為了防洩漏而加的，不能反過來污染真實對局的牌堆與擲幣');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
