/**
 * 三個玩家回報 bug（v5.678）
 * 1) 來悲粗茶|詛咒水滴：4 指示物放對手「寶可夢」含戰鬥位 → pending params.includeActive 應 true（原漏 → picker 只列備戰）。
 * 2) 拉達|逆襲門牙：自備戰「小拉達」家族指示物 ×40，應含「火箭隊的小拉達」（NameContains；原 === 漏）。
 * 3) 銀伴戰獸|空氣斬：自身丟能量 picker 丟到回力鏢能量 → 招式後應重附回戰鬥位（原 picker 收尾 revive 抓不到）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.pb-s.mjs'), E = join(ROOT, '.pb-e.ts'), O = join(ROOT, '.pb-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { ATTACK_PRE, ATTACK_POST } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, ATTACK_PRE, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const CURSE = '來悲粗茶', RATTATA = '18037' /*拉達*/, RKO = '17026' /*火箭隊的小拉達*/, KO = '18036' /*小拉達*/,
      SILVALLY = '19212' /*銀伴戰獸 空氣斬 cost CCC*/, BOOM = '17209' /*回力鏢能量*/, PSY = '11177' /*基本超*/, DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const en = (cid) => inst(cid);
function findCurseId() { for (const [id, c] of pool) if (c.name === CURSE && (c.attacks || []).some(a => a.name === '詛咒水滴')) return id; return null; }
function atkIndex(cardId, name) { return (pool.get(String(cardId))?.attacks || []).findIndex(a => a.name === name); }

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

// ---- Bug 1: 詛咒水滴 includeActive ----
T('★詛咒水滴：pending params.includeActive === true（HEAD 缺 → undefined FAIL）', () => {
  const curseId = findCurseId();
  const s = createGame({ name: 'P1', entries: [{ cardId: curseId, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(curseId) }, { ...s.players[1], active: inst(DEF), bench: [inst(DEF)] }] };
  const out = ATTACK_POST.get('來悲粗茶|詛咒水滴')(st, 0, pool);
  assert.equal(out.pendingSelection?.params?.includeActive, true, 'includeActive 應為 true（可放對手戰鬥位）');
});

// ---- Bug 2: 逆襲門牙 NameContains ----
T('★逆襲門牙：備戰火箭隊的小拉達(20傷=2指示物) → 80（HEAD === 排除 → 0 FAIL）', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: RATTATA, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const st = { ...s, activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(RATTATA), bench: [inst(RKO, { damage: 20 })] }, s.players[1]] };
  assert.equal(ATTACK_PRE.get('拉達|逆襲門牙')(st, 0, pool).damage, 80);
});
T('逆襲門牙 baseline：一般小拉達(20傷) → 80', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: RATTATA, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const st = { ...s, activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(RATTATA), bench: [inst(KO, { damage: 20 })] }, s.players[1]] };
  assert.equal(ATTACK_PRE.get('拉達|逆襲門牙')(st, 0, pool).damage, 80);
});

// ---- Bug 3: 空氣斬 + 回力鏢能量 ----
T('★空氣斬：丟回力鏢能量 → 招式後重附回銀伴戰獸（HEAD picker 收尾沒 revive → 留棄牌 FAIL）', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: SILVALLY, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const boom = en(BOOM);
  const active = inst(SILVALLY, { energyAttached: [boom, en(PSY), en(PSY)] });
  let st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 1, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], active, bench: [], deck: [inst(SILVALLY)], discard: [], prizes: Array.from({ length: 6 }, () => inst(SILVALLY)) },
      { ...s.players[1], active: inst('18071', { damage: 0 }), bench: [inst(DEF)], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)) }] };
  const ai = atkIndex(SILVALLY, '空氣斬');
  st = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
  assert.equal(st.pendingSelection?.effectKey, 'm5-silvally-air-slash', '空氣斬應開自身丟能量 picker');
  st = applyAction(st, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [boom.iid] }, pool);
  const act = st.players[0].active;
  assert.ok(act.energyAttached.some(e => e.iid === boom.iid), '回力鏢能量應重附回戰鬥位');
  assert.ok(!st.players[0].discard.some(e => e.iid === boom.iid), '回力鏢能量不應留在棄牌區');
});

console.log('\n玩家回報三bug:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
