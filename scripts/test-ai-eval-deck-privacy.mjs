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

T('⭐⭐洗亂不可增減或竄改卡片（只能在看不到的區域之間重發）', () => {
  // ⚠ v6.430（Rule 40 第 3 型：新防護層蓋住舊觀測點）：原本斷言「牌庫的卡片集合不變」。v6.430 起看不到的區域
  //   （牌庫＋蓋著的獎賞卡＋非行動方的手牌）合在一起重發 ⇒ 牌庫單獨的集合會變，但這一條守的意圖
  //   「不可以憑空增減或竄改卡片」沒有變 ⇒ 改成驗「看不到的那一堆」集合不變、各區張數不變，一個字都沒放寬。
  const hiddenBag = (p, handHidden) => [...p.deck, ...p.prizes.filter((c) => !c.faceUp), ...(handHidden ? p.hand : [])]
    .map((c) => c.iid).sort().join(',');
  const sizes = (p) => [p.deck.length, p.prizes.length, p.hand.length].join('/');
  // (a) 不指定行動方：雙方手牌都看不到
  const st = mkState(30);
  const b = st.players.map((p) => [hiddenBag(p, true), sizes(p)]);
  withIsolatedRandom(() => shuffleHiddenZonesForSim(st));
  st.players.forEach((p, i) => {
    assert.equal(hiddenBag(p, true), b[i][0], `玩家 ${i}：看不到的卡片集合必須完全相同（憑空增減＝作弊）`);
    assert.equal(sizes(p), b[i][1], `玩家 ${i}：牌庫／獎賞卡／手牌張數必須不變`);
  });
  // (b) 指定行動方 0：自己的手牌原封不動，其餘同上
  const st2 = mkState(30);
  const hand0 = st2.players[0].hand.map((c) => c.iid).join(',');
  const b2 = st2.players.map((p, i) => hiddenBag(p, i !== 0));
  withIsolatedRandom(() => shuffleHiddenZonesForSim(st2, 0));
  assert.equal(st2.players[0].hand.map((c) => c.iid).join(','), hand0, '行動方自己的手牌不可以被動到');
  st2.players.forEach((p, i) => assert.equal(hiddenBag(p, i !== 0), b2[i], `玩家 ${i}：看不到的卡片集合必須完全相同`));
  // 正對照：竄改一張（換成新 iid）必須被判準抓到
  const st3 = mkState(30);
  const b3 = hiddenBag(st3.players[1], true);
  st3.players[1].deck[0] = { ...st3.players[1].deck[0], iid: '__forged__' };
  assert.notEqual(hiddenBag(st3.players[1], true), b3, '正對照失效：判準抓不到被竄改的卡');
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
  // ⚠ v6.429（fable 審查 A-3）：原本只掃 ai-eval.ts —— ai-slowking.ts 的兩個試跑入口直接 applyAction(cloneState(…))
  //   照樣綠（型態 10：掃描範圍漏掉語義同型的檔案）。改掃 src/lib/game/ 底下**全部** ai*.ts。
  const dirG = join(ROOT, 'src/lib/game');
  const files = readdirSync(dirG).filter((f) => /^ai.*\.ts$/.test(f));
  assert.ok(files.length >= 4 && files.includes('ai-eval.ts') && files.includes('ai.ts'), '掃描器壞了？只掃到 ' + files.join(','));
  let guarded = 0;
  const raw = [];
  for (const f of files) {
    const src = readFileSync(join(dirG, f), 'utf8');
    // 每一處把複本交給引擎的地方，都要先過洗牌
    for (const m of src.matchAll(/applyAction\(\s*cloneState\(/g)) raw.push(f + '@' + m.index);
    guarded += [...src.matchAll(/shuffleHiddenZonesForSim\(cloneState\(/g)].length;
  }
  assert.deepEqual(raw, [],
    '有模擬入口直接把 cloneState 的結果丟給 applyAction，繞過了洗牌防線 —— '
    + '一律要寫成 applyAction(shuffleHiddenZonesForSim(cloneState(state)), …)');
  // 正對照：判準抓得到違規樣本（否定型守衛必須配正對照）
  assert.equal([...'const x = applyAction( cloneState(st), a, pool);'.matchAll(/applyAction\(\s*cloneState\(/g)].length, 1, '判準抓不到違規樣本');
  assert.ok(guarded >= 5, `經過防線的模擬入口只有 ${guarded} 處，應涵蓋全部（試打／評估／換上場估算／牌庫頂借招的試跑）`);
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
