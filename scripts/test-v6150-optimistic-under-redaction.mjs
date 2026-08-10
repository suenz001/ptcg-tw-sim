#!/usr/bin/env node
/**
 * v6.150 守衛：**遮蔽後的盤面，樂觀更新仍要能預測**
 *
 * 為什麼需要：v6.137/6.147/6.148 好不容易把錦標賽的樂觀更新做起來（不然「按了沒反應」），
 *   而 v6.150 把對手的 hand/deck/prizes 內容換成佔位 cardId。client 的 `tryPredictAction`
 *   會拿**遮蔽後**的盤面跑一次完整 engine `applyAction` ⇒ 只要引擎有任何一條路徑會去
 *   `pool.get(對手手牌/牌庫的 cardId)`，就會 throw（gate ③）或被 pool gate（②b）擋掉，
 *   **樂觀更新會全滅、而且是靜默的**（fail-closed 只是退回等伺服器，沒有紅字）。
 *
 * 這支用真 pool + 真 engine 實跑：同一個盤面「遮蔽前」「遮蔽後」各跑一次白名單動作，
 *   結果必須一致。遮蔽邏輯直接從 `oracle-admin/server_admin_patch.js` 的 REDACT BLOCK 抽，
 *   不另寫一份（兩份一定漂移）。fixture 沿用 v6.147 那支（四個動作都證明過可預測）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rd-s.js'), E = join(ROOT, '.rd-e.ts'), O = join(ROOT, '.rd-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { tryPredictAction, OPTIMISTIC_ACTION_TYPES } from './src/lib/game/optimistic';\n"
                + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { tryPredictAction, OPTIMISTIC_ACTION_TYPES } = await import(pathToFileURL(O).href);

// ── pool ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) { pool.set(String(c.id), c); all.push(c); }
}

// ── 從 server patch 抽 REDACT BLOCK（同一份邏輯，不重寫）────────────────────
const SRC = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const BEGIN = '── v6.150 REDACT BLOCK BEGIN ──', END = '── v6.150 REDACT BLOCK END ──';
const i0 = SRC.indexOf(BEGIN), i1 = SRC.indexOf(END);
if (i0 < 0 || i1 < i0) { console.log('  FAIL 找不到 REDACT BLOCK（server patch 未套用？）'); process.exit(1); }
const BLOCK = SRC.slice(i0 + BEGIN.length, i1);
// v6.153：遮蔽是預設關閉的旗標；這支要驗的是「開啟時樂觀更新仍能預測」⇒ 注入「已開啟」。
const R = new Function('TPOOL', '_capLog', '_redactOn',
  BLOCK + '\nreturn { _redactStateForSeat, TREDACT_CARD_ID };')(pool, (g) => g, () => true);

let pass = 0, fail = 0;
const chk = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? ' — ' + extra : '')); }
};

// ── fixture（沿用 v6.147）+ 對手三個隱藏區塞滿真卡 ─────────────────────────
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const inst = (id, iid, x = {}) => ({ iid, cardId: String(id), damage: 0, energyAttached: [], toolAttached: null,
  extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, evolvedFromStack: [], ...x });
const stage1 = all.find((c) => c.stage === 'Stage1' && c.evolvesFrom && HIJ(c)
  && all.some((b) => b.name === c.evolvesFrom && b.stage === 'Basic'));
const basicOf = all.find((c) => c.name === stage1.evolvesFrom && c.stage === 'Basic');
const plainBasic = all.find((c) => c.stage === 'Basic' && HIJ(c) && !(c.abilities || []).length
  && c.name !== basicOf.name && (c.attacks || []).length > 0);
const grass = all.find((c) => c.name === '基本【草】能量');
const stadium = all.find((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium' && HIJ(c));
const fossil = all.find((c) => c.name === '陳舊的根狀化石');
// 對手隱藏區故意混入「有特性的寶可夢」與訓練家 —— 引擎若會去查對手手牌/牌庫的卡，這種最容易炸。
const oppAbilityMon = all.find((c) => c.stage === 'Basic' && HIJ(c) && (c.abilities || []).length > 0);
const oppTrainer = all.find((c) => c.supertype === 'Trainer' && c.subtype !== 'Stadium' && HIJ(c));
const oppZone = (tag, k) => Array.from({ length: k }, (_, i) =>
  inst([oppAbilityMon.id, oppTrainer.id, grass.id, plainBasic.id][i % 4], tag + i));
const mk = (over = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
  log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null, pendingPrizes: [],
  players: [
    { name: 'A', active: inst(basicOf.id, 'A1', { energyAttached: [inst(grass.id, 'E1'), inst(grass.id, 'E2'), inst(grass.id, 'E3')] }),
      bench: over.bench ?? [inst(plainBasic.id, 'B1')],
      hand: [inst(plainBasic.id, 'H1'), inst(stage1.id, 'H2'), inst(stadium.id, 'H4'), inst(fossil.id, 'H5'), inst(grass.id, 'H6')],
      deck: [inst(grass.id, 'D1')], discard: [], prizes: [inst(grass.id, 'PZ1')] },
    { name: 'B', active: inst(plainBasic.id, 'X1'), bench: [inst(plainBasic.id, 'XB1')],
      hand: oppZone('XH', 6), deck: oppZone('XD', 40), discard: [], prizes: oppZone('XP', 6) },
  ],
});
const CASES = [
  ['ATTACH_ENERGY', { type: 'ATTACH_ENERGY', energyIid: 'H6', targetIid: 'A1' }],
  ['PLAY_BASIC', { type: 'PLAY_BASIC', iid: 'H1' }],
  ['RETREAT', { type: 'RETREAT', newActiveIid: 'B1' }],
  ['PLAY_FOSSIL', { type: 'PLAY_FOSSIL', iid: 'H5' }],
];

console.log('① fixture 有效性（遮蔽真的有發生）');
{
  const red = R._redactStateForSeat(mk(), 0);
  chk('對手手牌被換成佔位卡', red.players[1].hand.every((c) => c.cardId === R.TREDACT_CARD_ID));
  chk('對手牌庫被換成佔位卡（40 張）', red.players[1].deck.length === 40 && red.players[1].deck.every((c) => c.cardId === R.TREDACT_CARD_ID));
  chk('對手獎賞被換成佔位卡', red.players[1].prizes.every((c) => c.cardId === R.TREDACT_CARD_ID));
  chk('對手場上不受影響（pool gate ②b 只查場上）',
    red.players[1].active.cardId === String(plainBasic.id) && red.players[1].bench[0].cardId === String(plainBasic.id));
}

console.log('② 遮蔽前後，四個白名單動作的可預測性必須一致');
const strip = (s) => JSON.stringify(s, (k, v) => (k === 'timestamp' ? 0 : v));
for (const [name, action] of CASES) {
  const r0 = tryPredictAction(mk(), action, pool);
  const r1 = tryPredictAction(R._redactStateForSeat(mk(), 0), action, pool);
  chk(`${name}：未遮蔽可預測（正對照）`, r0.ok === true, r0.reason);
  chk(`${name}：**遮蔽後仍可預測**`, r1.ok === true, r1.reason);
  if (r0.ok && r1.ok) {
    chk(`${name}：預測結果「自己」那一側與未遮蔽版逐欄相同`,
      strip(r0.predicted.players[0]) === strip(r1.predicted.players[0]));
    chk(`${name}：佔位卡沒有被寫進自己的區域`, !strip(r1.predicted.players[0]).includes(R.TREDACT_CARD_ID));
  }
}

console.log('③ 白名單本身沒有偷偷長大（長大就必須重跑這支實測）');
chk('OPTIMISTIC_ACTION_TYPES 仍是 v6.147 的四個',
  [...OPTIMISTIC_ACTION_TYPES].sort().join(',') === 'ATTACH_ENERGY,PLAY_BASIC,PLAY_FOSSIL,RETREAT',
  [...OPTIMISTIC_ACTION_TYPES].join(','));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
