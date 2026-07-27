// v6.037：效果昏厥的 log 要寫得出「是哪張卡造成的」，而不是一律「⚠️ 系統擊倒檢查」。
//
// 玩家回報「千面避役｜擊斃 不會昏厥對方的寶可夢」。實測引擎四個情境全部正確
// （對手備戰／對手只有戰鬥位／對手受傷後剩餘最低／並列最低開選擇視窗），但發現一件事：
//
//   卡面是「從**雙方**的場上寶可夢（這隻寶可夢除外）中選擇1隻**剩餘HP最少**的」，
//   所以**自己場上有更低 HP 的寶可夢時，擊斃打的是自己的** —— 這是正確行為。
//   而這條路徑的結算走 sanityKOSweep（每個 action 結束雙邊掃），
//   它原本一律寫「⚠️ 系統擊倒檢查：… 被擊倒」。那是**兜底機制的名字**，
//   玩家看到會以為是系統異常，完全看不出「這是我剛用的招式的正常效果」。
//
// 修法（中央收斂，單點）：CardInstance 加 transient 的 `_faintReason`，
//   sweep 寫 log 時有來源就用來源寫。這一次改動同時涵蓋所有走 sweep 的效果昏厥
//   （擊斃／滲透寒氣／浸蝕污泥…），而且讓「系統擊倒檢查」回歸它真正的意義：
//   **只在沒有任何卡片標記來源時出現**，之後看到它就代表真的有東西沒收斂。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const S = join(ROOT, '.x-fr-s.js'), E = join(ROOT, '.x-fr-e.ts'), O = join(ROOT, '.x-fr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export { markFaintByEffect } from './src/lib/game/effects';\n"
  + "export { toBareCard } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
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
const byName = (n) => { for (const [id, c] of pool) if (c.name === n && ['H', 'I', 'J'].includes(c.regulationMark)) return id; return null; };
const CHI = byName('千面避役'), WATER = byName('基本【水】能量');
const BIG = byName('N的索羅亞克ex'), LOW = byName('米立龍'), SMALL = byName('N的索羅亞');

let seq = 0;
const inst = (cardId, extra = {}) => ({ iid: 'i' + (++seq), cardId: String(cardId), damage: 0, energyAttached: [], ...extra });
function mkState(oppActive, oppBench, myBench) {
  seq = 0;
  return {
    id: 'g', phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingPrizes: [0, 0],
    players: [
      { name: 'A', active: inst(CHI, { energyAttached: [inst(WATER)] }), bench: myBench.map((x) => inst(byName(x))),
        hand: [], deck: [], discard: [], prizes: Array.from({ length: 6 }, () => inst(WATER)),
        energyAttachedThisTurn: false, supporterPlayedThisTurn: false },
      { name: 'B', active: oppActive ? inst(byName(oppActive)) : null, bench: oppBench.map((x) => inst(byName(x))),
        hand: [], deck: [], discard: [], prizes: Array.from({ length: 6 }, () => inst(WATER)),
        energyAttachedThisTurn: false, supporterPlayedThisTurn: false },
    ],
  };
}
// log 裡的卡名被 cardLink 包成 \uE100{iid}\uE101{卡名}\uE102（私用區字元，印出來是空白）。
// 比對前必須剝成純卡名，否則斷言會被那串「看不見的 iid」卡掉（第一版就中招）。
const strip = (s) => String(s || '').replace(/\uE100[^\uE101]*\uE101([^\uE102]*)\uE102/g, '$1');
const logs = (st) => st.log.map((l) => strip(l.message));

T('前提：卡面就是「雙方的場上寶可夢」——自己場上有更低 HP 的就會打到自己', () => {
  const card = pool.get(CHI);
  const atk = card.attacks.find((a) => a.name === '擊斃');
  assert.ok(atk, '千面避役應有「擊斃」');
  assert.ok(atk.effect.includes('雙方的場上寶可夢'), '卡面是雙方場上：' + atk.effect);
  assert.ok(atk.effect.includes('剩餘HP最少'), '條件是剩餘 HP 最少');
});

T('⭐⭐打到自方時，log 要寫「擊斃」而不是「系統擊倒檢查」', () => {
  // 我方備戰米立龍 HP70 < 對手 N的索羅亞克ex HP280 → 依卡面打自己的米立龍
  const st = mod.applyAction(mkState('N的索羅亞克ex', [], ['米立龍']),
    { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  const all = logs(st).join('\n');
  assert.ok(/擊斃：米立龍 被昏厥！/.test(all), '應有「擊斃：米立龍 被昏厥！」，實得：\n' + all);
  assert.ok(!/系統擊倒檢查/.test(all),
    '不可再出現「系統擊倒檢查」——那是兜底機制的名字，玩家會誤以為是系統異常：\n' + all);
});

T('⭐打到自方時，功能本身仍正確（進棄牌、對手獲得獎賞）', () => {
  const st = mod.applyAction(mkState('N的索羅亞克ex', [], ['米立龍']),
    { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  assert.equal(st.players[0].bench.length, 0, '米立龍應離場');
  assert.ok(st.players[0].discard.some((c) => c.cardId === String(LOW)), '應進我方棄牌區');
  assert.equal(st.players[1].prizes.length, 5, '對手應取走 1 張獎賞（任何寶可夢昏厥都由對手取獎）');
});

T('⭐打到對手時維持原路徑（koTargetByAttackEffect，不走 sweep）', () => {
  const st = mod.applyAction(mkState('N的索羅亞克ex', ['N的索羅亞'], []),
    { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  const all = logs(st).join('\n');
  assert.ok(/擊斃：N的索羅亞 被昏厥！\+1 張獎賞卡/.test(all), '對手側措辭應維持原樣：\n' + all);
  assert.equal(st.players[1].bench.length, 0, '對手備戰應被昏厥');
});

T('⭐⭐沒有來源的 zombie KO 仍寫「系統擊倒檢查」（保住兜底的診斷價值）', () => {
  // 手動造一個「damage ≥ HP 但還在場上」且**沒有** _faintReason 的殭屍，
  // 讓 sweep 掃到 —— 這種才是真的「有東西沒收斂」，措辭必須維持警告語氣。
  const st0 = mkState('N的索羅亞克ex', ['N的索羅亞'], []);
  st0.players[1].bench[0].damage = 9999;
  const st = mod.applyAction(st0, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);  // 用水射擊，不觸發擊斃
  const all = logs(st).join('\n');
  assert.ok(/系統擊倒檢查/.test(all), '無來源的殭屍 KO 應維持「系統擊倒檢查」：\n' + all);
});

T('⭐markFaintByEffect 不傳 reason 時行為不變（向後相容）', () => {
  const before = { iid: 'z1', cardId: String(SMALL), damage: 0, energyAttached: [] };
  const a = mod.markFaintByEffect(before, pool);
  assert.equal(a._faintByEffect, true);
  assert.equal(a._faintReason, undefined, '沒傳就不該有這個欄位');
  const b = mod.markFaintByEffect(before, pool, undefined, '擊斃');
  assert.equal(b._faintReason, '擊斃');
});

T('⭐⭐_faintReason 是 transient：離場一定被清（否則會隨卡片再入場外洩）', () => {
  // v5.993 教訓：回合旗標離場沒清 → 再入場外洩，而且「按鈕當回合不出現」這種
  //   症狀完全看不出是旗標問題。toBareCard 已改白名單，新欄位自動被清 —— 這條釘住它。
  const dirty = { iid: 'z2', cardId: String(SMALL), damage: 70, energyAttached: [], _faintByEffect: true, _faintReason: '擊斃' };
  const bare = mod.toBareCard(dirty);
  assert.equal(bare._faintReason, undefined, 'toBareCard 應清掉 _faintReason');
  assert.equal(bare._faintByEffect, undefined, 'toBareCard 應清掉 _faintByEffect');
});

T('⭐同一條中央管線也涵蓋其他效果昏厥（滲透寒氣／浸蝕污泥）', () => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  assert.ok(/_faintReason = '滲透寒氣'/.test(eng), '滲透寒氣致死應帶來源');
  assert.ok(/_faintReason: '浸蝕污泥'/.test(eng), '浸蝕污泥效果昏厥應帶來源');
  assert.ok(/function koSweepLogLine\(/.test(eng), '措辭應收斂在單一 helper');
  // sweep 內不可再各自手刻措辭
  const i = eng.indexOf('function sanityKOSweep(');
  const body = eng.slice(i, eng.indexOf('\n}', i));
  assert.ok(!/系統擊倒檢查/.test(body), 'sweep 內不可再手刻措辭字串，一律走 koSweepLogLine');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
