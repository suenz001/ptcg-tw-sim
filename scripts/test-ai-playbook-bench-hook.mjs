// 批次 4b 守衛：打法表接上「備戰優先序」這個決策點。
//
// 這是第一個會**真的改變 AI 行為**的接線，所以要同時證明兩件相反的事：
//
//   ① **沒有表時，決策與接線前逐步完全相同**（不是「差不多」）。
//      作法：同一個 bundle 內跑兩場固定種子的對局 —— 一場沒有表、一場載入真表但
//      牌組不適用 —— 兩者的動作序列必須**逐一相同**。這比「跑得動就好」強得多：
//      任何一個 off-by-one 的分數污染都會讓序列岔開。
//   ② **有表且適用時，行為確實改變**。否則接了等於沒接，而且不會有任何錯誤訊息。
//
// ⚠為什麼要用「載入真表但不適用」當對照組，而不是只測 null：
//   真正的風險不是「沒有表」，是「表被套到不該套的牌組上」。這條同時擋住那個。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const TA = async (n, fn) => { try { await fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const S = join(ROOT, '.x-bh-s.js'), E = join(ROOT, '.x-bh-e.ts'), O = join(ROOT, '.x-bh-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + "export * from './src/lib/game/ai-playbook';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const realPb = JSON.parse(readFileSync(join(ROOT, 'static/ai-playbooks/n-zoroark-ex.json'), 'utf8'));

// 對照用牌組：與 sim-ai-battle.mjs 同一套（已知能穩定跑完整局），**不含**索羅亞克ex
const DECK = [
  ['16622', 3], ['16597', 2], ['16554', 4], ['16555', 2], ['16593', 2], ['16592', 2], ['16607', 2],
  ['17122', 4], ['17119', 3], ['17141', 3], ['17111', 2], ['17105', 2], ['17143', 1],
  ['17134', 3], ['17127', 1], ['17195', 2], ['17200', 4], ['17165', 3], ['17198', 1],
  ['17216', 14],
].map(([cardId, count]) => ({ cardId, count }));

function withSeededRandom(seed, fn) {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return fn(); } finally { Math.random = orig; }
}

/** 跑一場固定種子的 AI vs AI，回傳「動作序列指紋」。 */
function playAndTrace(seed, maxIter = 3000) {
  return withSeededRandom(seed, () => {
    let st = mod.createGame({ name: 'A', entries: DECK }, { name: 'B', entries: DECK }, pool);
    const trace = [];
    let rejected = 0;
    for (let i = 0; i < maxIter && st.phase !== 'game-over'; i++) {
      let actor;
      if (st.phase === 'setup') {
        const mul = st.pendingMulliganDraw ?? [0, 0];
        actor = mul[0] > 0 ? 0 : (mul[1] > 0 ? 1 : (!st.setupDone[0] ? 0 : (!st.setupDone[1] ? 1 : 0)));
      } else if (st.pendingSelection) actor = st.pendingSelection.actorIdx;
      else if (st.players[0].active === null && st.players[0].bench.length > 0) actor = 0;
      else if (st.players[1].active === null && st.players[1].bench.length > 0) actor = 1;
      else actor = st.activePlayerIndex;
      const act = mod.getAIAction(st, pool, actor);
      if (!act) break;
      // 指紋只記「決策」本身（型別＋關鍵欄位），不記盤面 —— 盤面差異一定源自決策差異
      trace.push(`${actor}:${act.type}:${act.iid ?? act.toIid ?? act.attackIndex ?? act.abilityIndex ?? ''}`);
      const next = mod.applyAction(st, act, pool);
      if (next === st) { if (++rejected > 5) break; continue; }
      rejected = 0;
      st = next;
      if (trace.length >= 120) break;   // 夠長就停（CI 時間）
    }
    return trace;
  });
}

T('前提：對照牌組確實**不含**索羅亞克ex（否則「不適用」的對照組不成立）', () => {
  const names = new Set(DECK.map((e) => pool.get(e.cardId)?.name).filter(Boolean));
  assert.ok(!names.has('N的索羅亞克ex'), '對照牌組不該含索羅亞克ex');
  assert.ok(names.size > 5, '牌組卡名應解析得出來，實得 ' + names.size);
});

T('⭐⭐沒有表時，動作序列與「載入真表但牌組不適用」逐步完全相同', () => {
  mod.clearPlaybook();
  const noPb = playAndTrace(20260727);
  assert.ok(noPb.length > 10, '對局應跑得夠長才有比對價值，實得 ' + noPb.length + ' 步');

  // 對照組：表確實被載進來了，但這副牌不符合 detect 條件 → 不得生效
  mod.setPlaybook(realPb);
  assert.ok(mod.getPlaybook(), '表應已載入');
  // ⚠這裡刻意直接 setPlaybook（模擬「表存在」的最壞情況）；正式路徑由
  //   prepareAIPlaybook 判定不適用時就不會設，是更嚴格的保護。
  const withUnrelatedPb = playAndTrace(20260727);
  mod.clearPlaybook();

  assert.equal(withUnrelatedPb.length, noPb.length, '步數應相同');
  for (let i = 0; i < noPb.length; i++) {
    assert.equal(withUnrelatedPb[i], noPb[i],
      `第 ${i} 步岔開了：無表=${noPb[i]}／有表=${withUnrelatedPb[i]}`
      + ' —— 表列到的卡不在這副牌裡，分數應一律 +0');
  }
  console.log(`   逐步比對 ${noPb.length} 步，完全相同`);
});

T('⭐⭐表適用時，備戰優先序確實改變（否則接了等於沒接）', () => {
  // 直接驗分數函式的效果：表把捷克羅姆拉到最高位（×10000），
  // 舊排序只看 HP／冠名／可進化，捷克羅姆 HP130 贏不過高 HP 基礎。
  const zek = mod.benchScoreOf(realPb, 'N的捷克羅姆');
  const zoroa = mod.benchScoreOf(realPb, 'N的索羅亞');
  assert.ok(zek > 0, '捷克羅姆應在表內有分數');
  assert.ok(zoroa > 0, '索羅亞應在表內有分數');
  // 表分數 ×10000 必須蓋得過舊規則的最大加總（HP<=340 + 1000 + 500 < 2000）
  assert.ok(zek * 10000 > 2000 + 340,
    '表分數的權重必須壓過舊規則的所有加分，否則表形同虛設');
});

T('⭐⭐ai.ts 的接線必須是「加法 +0」而不是「取代」', () => {
  const ai = readFileSync(join(ROOT, 'src/lib/game/ai.ts'), 'utf8');
  assert.ok(/ai-playbook/.test(ai), '批次 4b 起 ai.ts 應已引用打法表');
  const i = ai.indexOf('const pbForBench = getPlaybook()');
  assert.ok(i > 0, '備戰段應取得打法表');
  const body = ai.slice(i, i + 1400);
  assert.ok(/s \+= benchScoreOf\(pbForBench, card\.name\) \* 10000;/.test(body),
    '必須是「在原分數上加」——寫成取代的話，沒有表時行為就會變');
  // 原本的三項加分必須都還在（表只負責拉高它在乎的卡，其餘仍由通用規則排）
  assert.ok(/s = card\.hp \?\? 0;/.test(body), '原本的 HP 項要保留');
  assert.ok(/s \+= 1000;/.test(body), '原本的「可進化」加分要保留');
  assert.ok(/s \+= 500;/.test(body), '原本的冠名加分要保留');
});

await TA('⭐⭐prepareAIPlaybook：牌組不適用時**不可**設表', async () => {
  mod.clearPlaybook();
  const entries = DECK;   // 不含索羅亞克ex
  const r = await mod.prepareAIPlaybook(entries, pool, async () => ({ ok: true, json: async () => realPb }));
  assert.equal(r, null, '不適用應回 null');
  assert.equal(mod.getPlaybook(), null,
    '⚠不適用時絕不可留著表 —— 那會把某套牌的打法套到完全不同的牌組上');
});

await TA('⭐prepareAIPlaybook：牌組適用時才設表', async () => {
  mod.clearPlaybook();
  // 造一副含索羅亞克ex 的最小牌組（只需滿足 detect.requireAll）
  let zekId = null;
  for (const [id, c] of pool) if (c.name === 'N的索羅亞克ex' && ['H', 'I', 'J'].includes(c.regulationMark)) { zekId = id; break; }
  assert.ok(zekId, '應找得到 N的索羅亞克ex');
  const r = await mod.prepareAIPlaybook([{ cardId: zekId }], pool, async () => ({ ok: true, json: async () => realPb }));
  assert.ok(r, '適用應回表');
  assert.equal(mod.getPlaybook()?.archetypeKey, 'n-zoroark-ex');
  mod.clearPlaybook();
});

await TA('⭐fail-open：載表失敗不影響對戰（回 null，不 throw）', async () => {
  mod.clearPlaybook();
  const r = await mod.prepareAIPlaybook(DECK, pool, async () => { throw new Error('offline'); });
  assert.equal(r, null);
  assert.equal(mod.getPlaybook(), null);
});

T('⭐新增原型時要記得把 key 加進 KNOWN_PLAYBOOK_KEYS（忘了不會報錯，表只是沒生效）', () => {
  const keys = mod.KNOWN_PLAYBOOK_KEYS;
  assert.ok(Array.isArray(keys) && keys.length > 0, '應有已知表清單');
  const files = readdirSync(join(ROOT, 'static/ai-playbooks')).filter((f) => f.endsWith('.json'));
  const missing = files.map((f) => f.replace(/\.json$/, '')).filter((k) => !keys.includes(k));
  assert.deepEqual(missing, [],
    '這些表檔存在但沒被列進 KNOWN_PLAYBOOK_KEYS，永遠不會被載入：' + missing.join('、'));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
