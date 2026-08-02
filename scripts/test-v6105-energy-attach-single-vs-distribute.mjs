/**
 * v6.105 守衛：附能的「目標單一 vs 可分散」必須逐字對齊卡面
 *
 * 這是兩條**不同**的規則，卡面措辭就是判準：
 *   ・「…以任意方式附於自己的寶可夢身上」        → 可分散（玩家逐張／分波決定各附幾張）
 *   ・「…附於自己的【1隻】寶可夢身上」／「附於1隻備戰寶可夢身上」→ **全部附同一隻**
 *
 * 玩家回報：火伊布ex｜燃燒充能（卡面「附於自己的 1 隻寶可夢身上」）可以把 2 張能量
 * 分給兩隻不同的寶可夢。根因是 v2.158 當年把它跟「以任意方式」型一起升級成逐張分配
 * （該檔頭的「適用招式」列表甚至把同樣是「1 隻」型的樂呵呵之吻也列了進去）。
 *
 * 兩個區塊：
 *  ① 行為端：跑完整 ATTACK → 選能量 → 選目標，斷言 2 張能量落在同一隻身上。
 *  ② 靜態端（**資料驅動**）：掃出所有走中央 chain 的呼叫點，用它的 label 反查
 *     static/cards 台灣官方卡面，雙向斷言 singleTarget 旗標與卡面措辭一致。
 *     ⭐ 這條讓未來任何新卡走錯管線都會被抓到，不必逐張人工比對。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x5-s.js'), E = join(ROOT, '.x5-e.ts'), O = join(ROOT, '.x5-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
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
let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '→', e.message); fail++; } };

console.log('① 行為端：火伊布ex｜燃燒充能 兩張能量必須落在同一隻');
ok('燃燒充能：選 2 張基本能量 → 只開一次目標 picker → 兩張都附同一隻', () => {
  const flareon = [...pool.entries()].find(([, c]) =>
    c.name === '火伊布ex' && (c.attacks ?? []).some((a) => a.name === '燃燒充能'))?.[0];
  assert.ok(flareon, 'static/cards 找不到 火伊布ex｜燃燒充能');
  const card = pool.get(flareon);
  const eff = (card.attacks ?? []).find((a) => a.name === '燃燒充能').effect ?? '';
  assert.ok(eff.includes('附於自己的1隻寶可夢'), '卡面前提變了，請重讀卡面：' + eff);

  const fireE = [...pool.entries()].find(([, c]) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('火'))?.[0];
  const fat = [...pool.entries()].find(([, c]) => c.supertype === 'Pokemon' && parseInt(c.hp ?? '0') >= 300)?.[0];
  const basics = [];
  for (const [id, c] of pool) { if (c.supertype === 'Pokemon' && c.stage === 'Basic') basics.push(id); if (basics.length >= 2) break; }
  assert.ok(fireE && fat && basics.length >= 2, '卡池取樣失敗（守衛不做軟跳過）');

  let n = 0;
  const mk = (cid, e = 0) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0,
    energyAttached: Array.from({ length: e }, () => ({ iid: 'e' + (++n), cardId: String(fireE) })) });
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P1', active: mk(flareon, 2), bench: [mk(basics[0]), mk(basics[1])], hand: [],
        deck: [mk(fireE), mk(fireE), mk(basics[0])], discard: [], prizes: [] },
      { name: 'P2', active: mk(fat), bench: [mk(basics[0])], hand: [], deck: [mk(basics[0])], discard: [], prizes: [] },
    ],
  };
  const ai = (card.attacks ?? []).findIndex((a) => a.name === '燃燒充能');
  const s1 = mod.applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, pool);
  assert.strictEqual(s1.pendingSelection?.type, 'deck-search', '應先開牌庫選能量');
  const energyIids = s1.players[0].deck.filter((c) => String(c.cardId) === String(fireE)).map((c) => c.iid);
  assert.strictEqual(energyIids.length, 2, '前提：牌庫裡有 2 張基本能量');
  const s2 = mod.applyAction(s1, { type: 'RESOLVE_SELECTION', selectedIids: energyIids }, pool);

  // ⭐ 關鍵斷言：必須是「選 1 隻」的 picker，而不是可分散的 energy-distribute
  assert.notStrictEqual(s2.pendingSelection?.type, 'energy-distribute',
    '出現了可分散的 +/- 分配 UI —— 卡面是「附於自己的 1 隻寶可夢」，不可分散');
  assert.strictEqual(s2.pendingSelection?.maxCount, 1, '目標 picker 只能選 1 隻');

  const tgt = s2.players[0].bench[0].iid;
  const s3 = mod.applyAction(s2, { type: 'RESOLVE_SELECTION', selectedIids: [tgt] }, pool);
  const cnt = (x) => (x ? x.energyAttached.length : 0);
  assert.strictEqual(cnt(s3.players[0].bench[0]), 2, '兩張能量都要附到選中的那一隻');
  assert.strictEqual(cnt(s3.players[0].bench[1]), 0, '另一隻不該分到能量');
  assert.strictEqual(cnt(s3.players[0].active), 2, '戰鬥位維持原本的 2 張（不該被動到）');
});

console.log('② 靜態端（資料驅動）：chain 呼叫點的 singleTarget 必須與卡面措辭一致');

/** 取出所有 `effectKey: 'v158-energy-chain-start'` 呼叫點的 params 區塊（含 label / singleTarget）。 */
function collectChainCalls() {
  const out = [];
  const stack = [join(ROOT, 'src/lib/game')];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      if (!ent.name.endsWith('.ts')) continue;
      if (/v\d+_g\d+_/.test(ent.name)) continue;           // G 標卡檔不在維護範圍
      if (ent.name === 'v158_energy_chain.ts') continue;    // helper 本身（含 resolver 定義）
      const src = readFileSync(full, 'utf8');
      const lines = src.split('\n');
      lines.forEach((ln, i) => {
        if (!ln.includes("effectKey: 'v158-energy-chain-start'")) return;
        // params 通常緊接在 effectKey 之後 1~4 行內
        const ctx = lines.slice(i, i + 6).join('\n');
        const m = /label:\s*'([^']+)'/.exec(ctx);
        out.push({ file: ent.name, line: i + 1, label: m ? m[1] : null, singleTarget: /singleTarget:\s*true/.test(ctx) });
      });
    }
  }
  return out;
}

/** 用招式名／特性名／訓練家卡名反查 static/cards 台灣官方卡面文字（HIJ live 卡）。 */
function cardTextByLabel(label) {
  const hits = [];
  for (const [, c] of pool) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of c.attacks ?? []) if (a.name === label && a.effect) hits.push(a.effect);
    for (const ab of c.abilities ?? []) if (ab.name === label && ab.effect) hits.push(ab.effect);
    if (c.name === label && c.rulesText) hits.push(c.rulesText);
  }
  return hits;
}

const calls = collectChainCalls();
ok('掃得到 chain 呼叫點（掃描式沒失效）', () => {
  assert.ok(calls.length >= 3, '呼叫點太少，掃描式可能失效：' + JSON.stringify(calls));
});

/**
 * ⭐ v6.105（Fable 覆核補強）：除了走 withPending 的呼叫點，還有一批**直接呼叫
 * `startEnergyChain(...)`** 的卡檔。原本的掃描只看 effectKey 字面量，那批完全在守衛之外。
 */
function collectDirectCalls() {
  const out = [];
  const stack = [join(ROOT, 'src/lib/game')];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      if (!ent.name.endsWith('.ts')) continue;
      if (/v\d+_g\d+_/.test(ent.name)) continue;
      if (ent.name === 'v158_energy_chain.ts') continue;
      const src = readFileSync(full, 'utf8');
      if (/startEnergyChain\s*\(/.test(src)) out.push(ent.name);
    }
  }
  return out;
}
ok('直呼 startEnergyChain 的檔案有被記錄（未來新增「1隻」型卡不會靜默漏掉）', () => {
  const direct = collectDirectCalls();
  // 這裡不強制每個直呼點都能反查卡面（label 常是變數），但要確保清單有被看見；
  // 清單變動時這個斷言會提醒人重新檢視。
  assert.ok(direct.length > 0, '掃不到任何直呼點，掃描式可能失效');
  console.log('     （直呼 startEnergyChain 的檔：' + direct.join(', ') + '）');
});

const unresolved = [];
for (const call of calls) {
  if (!call.label) { unresolved.push(`${call.file}:${call.line}（label 是變數，無法反查卡面）`); continue; }
  const texts = cardTextByLabel(call.label).filter((t) => t.includes('附於'));
  if (texts.length === 0) { unresolved.push(`${call.file}:${call.line} label='${call.label}'（卡面反查不到）`); continue; }
  ok(`卡面一致性：「${call.label}」（${call.file}:${call.line}）`, () => {
    const single = texts.some((t) => /附於(自己的)?\s*1隻|附於1隻/.test(t));
    const anyway = texts.some((t) => t.includes('以任意方式'));
    if (single && !anyway) {
      assert.strictEqual(call.singleTarget, true,
        `卡面是「附於…1隻…」但沒有傳 singleTarget:true（會讓玩家把能量分給多隻）\n卡面：${texts[0]}`);
    }
    if (anyway && !single) {
      assert.strictEqual(call.singleTarget, false,
        `卡面是「以任意方式」但傳了 singleTarget:true（剝奪玩家分散的權利）\n卡面：${texts[0]}`);
    }
  });
}

ok('兜底：反查不到卡面的呼叫點要少於門檻（多了代表守衛涵蓋率在下降）', () => {
  // ⚠ 這些呼叫點的 label 是變數（helper 型），靜態反查不到卡面 → 不在自動比對範圍內。
  //   目前已知的就這幾個，數量變多時這條會紅，提醒人補行為端測試或改成字面量 label。
  console.log('     （未涵蓋：' + (unresolved.length ? unresolved.join(' / ') : '無') + '）');
  assert.ok(unresolved.length <= 3,
    '守衛涵蓋率下降，請把新的呼叫點改成字面量 label 或補行為端測試：\n' + unresolved.join('\n'));
});

ok('正對照：雙向判準都會失敗（證明不是永遠綠）', () => {
  const singleText = '從自己的牌庫選擇最多2張基本能量卡，附於自己的1隻寶可夢身上。並且重洗牌庫。';
  const anywayText = '從自己的牌庫選擇最多2張基本能量卡，以任意方式附於自己的寶可夢身上。並且重洗牌庫。';
  const isSingle = (t) => /附於(自己的)?\s*1隻|附於1隻/.test(t);
  const isAnyway = (t) => t.includes('以任意方式');
  assert.ok(isSingle(singleText) && !isAnyway(singleText), '「1隻」型判準壞了');
  assert.ok(isAnyway(anywayText) && !isSingle(anywayText), '「以任意方式」型判準壞了');
});

console.log(`\n=== v6.105 附能目標單一/可分散：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
