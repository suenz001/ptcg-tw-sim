#!/usr/bin/env node
/**
 * v6.536 守衛（多目標招式打對手的寶可夢一律走中央 dealAttackDamageToTarget）：
 *   ICE     雪絨蛾｜冰凍羽擊 打到備戰的拖拖蚓ex（附【鋼】×2）⇒ 快掃拳返 +40（原本備戰 raw +20、不觸發）
 *   ICE_KO  同上，備戰另一隻剩 20 HP ⇒ 照常昏厥、P1 取 1 張（零回歸正對照）
 *   VOLT    雷丘｜捲入伏特：對手戰鬥場怕雷的超級大力鱷ex（身上 10）⇒ 受到 100（原本 raw +50，不算弱點）
 *   VOLT_OWN 同上：自己身上有指示物的備戰 +50、沒有的不變、雷丘自己不變；對手沒有指示物的備戰不變（正對照）
 *   SAND    河馬獸｜大沙風暴：對手有指示物的備戰拖拖蚓ex ⇒ 快掃拳返 +40；自己有指示物的備戰 +40
 *   SPIT    臭臭花｜灑口水：對手備戰拖拖蚓ex ⇒ 快掃拳返 +40；自己的備戰 +20
 *   HAIL    急凍鳥｜冰雹（hitBenchAll）：對手備戰拖拖蚓ex ⇒ 快掃拳返 +40
 *   JET     超級寶石海星ex｜噴射打擊（bench-hit-N）選備戰拖拖蚓ex ⇒ 50、快掃拳返 +40
 *   EXPL    隨風球｜一同爆炸：卡面兩句都只限「自己的場上」⇒ 傷害 2×50=100（原本把對手的飄飄球也算進去 150）、
 *           對手的飄飄球不受 30（原本 +30）、自己的隨風球與飄飄球各 +30
 *   DIVE    巨翅飛魚｜水俯衝 的對戰紀錄寫招式名（原本寫「攻擊」）
 *   HAIL_END 獎賞剩 1：冰雹打昏第一隻取完，其餘備戰照樣受 30（各受到＝同時）
 *   DRAW_*  雙方各剩 1、同一招同時打昏自己與對手各一隻 ⇒ 平手（天空波／灑口水／大沙風暴／捲入伏特；審查 P1-1 的回歸守衛）
 *   DRAW_BOMB 堅果啞鈴｜轟爆尖刺 取完後自傷 130 照樣結算 ⇒ 平手（審查 P2-1）
 * 【H】BASE（v6.535）：ICE、VOLT、SAND、SPIT、HAIL、JET、EXPL、DIVE、DRAW_BOMB 逐條紅；其餘兩版綠（DRAW_* 在 BASE 本來就對，守的是本版回歸）。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.535。
const BASE_SHA = '632f1e89';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const HIJ = (c) => 'HIJ'.includes(c.regulationMark || '?');
const byName = (n) => { for (const c of pool.values()) if (c.name === n && HIJ(c)) return String(c.id); return null; };
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const EN = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Colorless: '水' };
const ID = {
  filler: '19178', M: byName('基本【鋼】能量'),
  frosmoth: withAttack('雪絨蛾', '冰凍羽擊'), raichu: withAttack('雷丘', '捲入伏特'), hippo: withAttack('河馬獸', '大沙風暴'),
  gloom: withAttack('臭臭花', '灑口水'), articuno: withAttack('急凍鳥', '冰雹'), starmie: withAttack('超級寶石海星ex', '噴射打擊'),
  drifblim: withAttack('隨風球', '一同爆炸'), drifloon: byName('飄飄球'), mantine: withAttack('巨翅飛魚', '水俯衝'),
  orth: withAbility('拖拖蚓ex', '快掃拳返'), feraligatr: '19544', landorus: withAttack('土地雲', '巨岩墜落'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
if (!missing.length && !((pool.get(ID.feraligatr)?.weakness?.type === 'Lightning') && pool.get(ID.feraligatr)?.name === '超級大力鱷ex')) missing.push('feraligatr(怕雷)');
const atkIdx = (id, n) => pool.get(id).attacks.findIndex((a) => a.name === n);
const costIds = (id, n) => pool.get(id).attacks.find((a) => a.name === n).cost.map((t) => byName(`基本【${EN[t] ?? '水'}】能量`));

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6536-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const atker = (id, atk, e = {}) => inst(id, { energyAttached: costIds(id, atk).map((c) => inst(c)), ...e });
  const mk = ({ a0, b0 = [], a1, b1 = [] }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const W = byName('基本【水】能量');
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(W, 10), discard: [], prizes: many(W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(W, 10), discard: [], prizes: many(W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const drive = (s, pick) => { let g = 0; while (s.pendingSelection && s.phase === 'playing' && g++ < 8) { const ps = s.pendingSelection;
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: pick(ps), actorIdx: ps.actorIdx ?? 0, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); } return s; };
  const attack = (st, id, atk, pick = (ps) => (ps.params?.validIids ?? []).slice(0, ps.minCount ?? 1)) =>
    drive(act(st, { type: 'ATTACK', attackIndex: atkIdx(id, atk), actorIdx: 0 }), pick);
  const find = (s, iid) => { for (const p of s.players) for (const c of [p.active, ...p.bench]) if (c?.iid === iid) return c; return null; };
  const dmg = (s, iid) => find(s, iid)?.damage ?? 'gone';
  const orthB = (e = {}) => inst(ID.orth, { energyAttached: many(ID.M, 2), ...e });
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };

  T('ICE', () => { const a = atker(ID.frosmoth, '冰凍羽擊'); const o = orthB();
    const s = attack(mk({ a0: a, a1: inst(ID.landorus), b1: [o] }), ID.frosmoth, '冰凍羽擊');
    return { atk: dmg(s, a.iid), orth: dmg(s, o.iid) }; });
  T('ICE_KO', () => { const a = atker(ID.frosmoth, '冰凍羽擊'); const f = inst(ID.filler, { damage: Number(pool.get(ID.filler).hp) - 20 });
    const s = attack(mk({ a0: a, a1: inst(ID.landorus), b1: [f, inst(ID.filler)] }), ID.frosmoth, '冰凍羽擊');
    return { gone: dmg(s, f.iid) === 'gone' }; });
  T('VOLT', () => { const a = atker(ID.raichu, '捲入伏特'); const d = inst(ID.feraligatr, { damage: 10 });
    const s = attack(mk({ a0: a, a1: d, b1: [inst(ID.filler)] }), ID.raichu, '捲入伏特');
    return { def: dmg(s, d.iid) }; });
  T('VOLT_OWN', () => { const a = atker(ID.raichu, '捲入伏特', { damage: 10 }); const mine = inst(ID.landorus, { damage: 10 }); const clean = inst(ID.landorus);
    const oppClean = inst(ID.landorus); const oppHit = inst(ID.landorus, { damage: 10 }); const d = inst(ID.feraligatr);
    const s = attack(mk({ a0: a, b0: [mine, clean], a1: d, b1: [oppClean, oppHit] }), ID.raichu, '捲入伏特');
    return { self: dmg(s, a.iid), mine: dmg(s, mine.iid), clean: dmg(s, clean.iid), oppClean: dmg(s, oppClean.iid), oppHit: dmg(s, oppHit.iid), def: dmg(s, d.iid) }; });
  // HAIL_END：P1 只剩 1 張獎賞，冰雹先打昏第一隻備戰 ⇒ 遊戲結束，第二隻不再結算（中央迴圈遇到遊戲結束即停）
  T('HAIL_END', () => { const a = atker(ID.articuno, '冰雹'); const hp = Number(pool.get(ID.filler).hp);
    const f1 = inst(ID.filler, { damage: hp - 30 }); const f2 = inst(ID.filler, { damage: hp - 40 });
    const st = mk({ a0: a, a1: inst(ID.feraligatr), b1: [f1, f2] }); st.players[0].prizes = st.players[0].prizes.slice(0, 1);
    const s = attack(st, ID.articuno, '冰雹');
    return { phase: s.phase, winner: s.winner ?? null, f2: dmg(s, f2.iid), hp }; });
  // DRAW_*（Fable 審查 P1-1）：雙方獎賞各剩 1，這一招同時打昏自己一隻與對手一隻 ⇒ 雙方同時取完、都能放置 ⇒ 平手
  //   （PTCG_RULES §17.26 咒詛炸彈判例同型；v6.536 第一稿「遇到終局就停」會判成單方勝）
  const draw = (id, atk, { ownDmgLeft, oppDmgLeft, extraOwn = [] } = {}) => {
    const a = atker(id, atk); const hpL = Number(pool.get(ID.landorus).hp);
    const own = inst(ID.landorus, { damage: hpL - ownDmgLeft }); const opp = inst(ID.landorus, { damage: hpL - oppDmgLeft });
    const st = mk({ a0: a, b0: [own, inst(ID.filler), ...extraOwn], a1: inst(ID.feraligatr), b1: [opp, inst(ID.filler)] });
    st.players[0].prizes = st.players[0].prizes.slice(0, 1); st.players[1].prizes = st.players[1].prizes.slice(0, 1);
    const s = attack(st, id, atk);
    return { phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw, pz: s.players[0].prizes.length + '/' + s.players[1].prizes.length,
      ownGone: dmg(s, own.iid) === 'gone', oppGone: dmg(s, opp.iid) === 'gone' };
  };
  T('DRAW_SKY', () => draw(withAttack('電飛鼠', '天空波'), '天空波', { ownDmgLeft: 10, oppDmgLeft: 10 }));
  T('DRAW_SPIT', () => draw(ID.gloom, '灑口水', { ownDmgLeft: 20, oppDmgLeft: 20 }));
  T('DRAW_SAND', () => draw(ID.hippo, '大沙風暴', { ownDmgLeft: 40, oppDmgLeft: 40 }));
  T('DRAW_VOLT', () => draw(ID.raichu, '捲入伏特', { ownDmgLeft: 50, oppDmgLeft: 50 }));
  // DRAW_BOMB（Fable 審查 P2-1，BASE 就有）：堅果啞鈴｜轟爆尖刺 打昏對手備戰取完、自己受到 130 必定昏厥、對手也取完 ⇒ 平手
  T('DRAW_BOMB', () => { const bomb = withAttack('堅果啞鈴', '轟爆尖刺'); const a = atker(bomb, '轟爆尖刺'); const hpL = Number(pool.get(ID.landorus).hp);
    const opp = inst(ID.landorus, { damage: hpL - 50 });
    const st = mk({ a0: a, b0: [inst(ID.filler)], a1: inst(ID.feraligatr), b1: [opp, inst(ID.filler)] });
    st.players[0].prizes = st.players[0].prizes.slice(0, 1); st.players[1].prizes = st.players[1].prizes.slice(0, 1);
    const s = attack(st, bomb, '轟爆尖刺');
    return { phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw, pz: s.players[0].prizes.length + '/' + s.players[1].prizes.length, selfGone: dmg(s, a.iid) === 'gone' }; });
  T('SAND', () => { const a = atker(ID.hippo, '大沙風暴'); const o = orthB({ damage: 10 }); const mine = inst(ID.landorus, { damage: 10 }); const clean = inst(ID.landorus);
    const s = attack(mk({ a0: a, b0: [mine, clean], a1: inst(ID.feraligatr), b1: [o] }), ID.hippo, '大沙風暴');
    return { atk: dmg(s, a.iid), orth: dmg(s, o.iid), mine: dmg(s, mine.iid), clean: dmg(s, clean.iid) }; });
  T('SPIT', () => { const a = atker(ID.gloom, '灑口水'); const o = orthB(); const mine = inst(ID.landorus);
    const s = attack(mk({ a0: a, b0: [mine], a1: inst(ID.feraligatr), b1: [o] }), ID.gloom, '灑口水');
    return { atk: dmg(s, a.iid), orth: dmg(s, o.iid), mine: dmg(s, mine.iid) }; });
  T('HAIL', () => { const a = atker(ID.articuno, '冰雹'); const o = orthB();
    const s = attack(mk({ a0: a, a1: inst(ID.feraligatr), b1: [o] }), ID.articuno, '冰雹');
    return { atk: dmg(s, a.iid), orth: dmg(s, o.iid) }; });
  T('JET', () => { const a = atker(ID.starmie, '噴射打擊'); const o = orthB();
    const s = attack(mk({ a0: a, a1: inst(ID.feraligatr), b1: [inst(ID.landorus), o] }), ID.starmie, '噴射打擊',
      (ps) => (ps.params?.validIids ?? [o.iid]).includes(o.iid) ? [o.iid] : (ps.params?.validIids ?? []).slice(0, 1));
    return { atk: dmg(s, a.iid), orth: dmg(s, o.iid) }; });
  T('EXPL', () => { const a = atker(ID.drifblim, '一同爆炸'); const myLoon = inst(ID.drifloon); const oppLoon = inst(ID.drifloon); const d = inst(ID.feraligatr);
    const s = attack(mk({ a0: a, b0: [myLoon], a1: d, b1: [oppLoon] }), ID.drifblim, '一同爆炸');
    return { def: dmg(s, d.iid), oppLoon: dmg(s, oppLoon.iid), self: dmg(s, a.iid), myLoon: dmg(s, myLoon.iid) }; });
  T('DIVE', () => { const a = atker(ID.mantine, '水俯衝'); const d = inst(ID.landorus); const b = inst(ID.landorus);
    const s = attack(mk({ a0: a, a1: d, b1: [b] }), ID.mantine, '水俯衝', () => [b.iid]);
    const L = (s.log || []).map((l) => String(l.message));
    return { bench: dmg(s, b.iid), named: L.some((x) => x.startsWith('水俯衝：') && x.includes('造成')), generic: L.some((x) => x.startsWith('攻擊：')) }; });
  return out;
}

const judge = (r) => ({
  ICE: !!r.ICE && r.ICE.orth === 20 && r.ICE.atk === 40,
  ICE_KO: !!r.ICE_KO && r.ICE_KO.gone === true,
  VOLT: !!r.VOLT && r.VOLT.def === 110,
  VOLT_OWN: !!r.VOLT_OWN && r.VOLT_OWN.self === 10 && r.VOLT_OWN.mine === 60 && r.VOLT_OWN.clean === 0 && r.VOLT_OWN.oppClean === 0 && r.VOLT_OWN.oppHit === 60 && r.VOLT_OWN.def === 0,
  HAIL_END: !!r.HAIL_END && r.HAIL_END.phase === 'game-over' && r.HAIL_END.winner === 0 && r.HAIL_END.f2 === r.HAIL_END.hp - 10,
  DRAW_SKY: !!r.DRAW_SKY && r.DRAW_SKY.phase === 'game-over' && r.DRAW_SKY.isDraw && r.DRAW_SKY.pz === '0/0' && r.DRAW_SKY.ownGone && r.DRAW_SKY.oppGone,
  DRAW_SPIT: !!r.DRAW_SPIT && r.DRAW_SPIT.phase === 'game-over' && r.DRAW_SPIT.isDraw && r.DRAW_SPIT.pz === '0/0' && r.DRAW_SPIT.ownGone && r.DRAW_SPIT.oppGone,
  DRAW_SAND: !!r.DRAW_SAND && r.DRAW_SAND.phase === 'game-over' && r.DRAW_SAND.isDraw && r.DRAW_SAND.pz === '0/0' && r.DRAW_SAND.ownGone && r.DRAW_SAND.oppGone,
  DRAW_VOLT: !!r.DRAW_VOLT && r.DRAW_VOLT.phase === 'game-over' && r.DRAW_VOLT.isDraw && r.DRAW_VOLT.pz === '0/0' && r.DRAW_VOLT.ownGone && r.DRAW_VOLT.oppGone,
  DRAW_BOMB: !!r.DRAW_BOMB && r.DRAW_BOMB.phase === 'game-over' && r.DRAW_BOMB.isDraw && r.DRAW_BOMB.pz === '0/0' && r.DRAW_BOMB.selfGone,
  SAND: !!r.SAND && r.SAND.orth === 50 && r.SAND.atk === 40 && r.SAND.mine === 50 && r.SAND.clean === 0,
  SPIT: !!r.SPIT && r.SPIT.orth === 20 && r.SPIT.atk === 40 && r.SPIT.mine === 20,
  HAIL: !!r.HAIL && r.HAIL.orth === 30 && r.HAIL.atk === 40,
  JET: !!r.JET && r.JET.orth === 50 && r.JET.atk === 40,
  EXPL: !!r.EXPL && r.EXPL.def === 100 && r.EXPL.oppLoon === 0 && r.EXPL.self === 30 && r.EXPL.myLoon === 30,
  DIVE: !!r.DIVE && r.DIVE.bench === 50 && r.DIVE.named && !r.DIVE.generic,
});
const LABEL = {
  ICE: '★★★ 冰凍羽擊打到備戰拖拖蚓ex ⇒ 快掃拳返 +40（備戰走中央）',
  ICE_KO: '★ 正對照：冰凍羽擊把剩 20 HP 的備戰打昏',
  VOLT: '★★★ 捲入伏特打怕雷的戰鬥場 ⇒ 50×2（戰鬥場算弱點）',
  VOLT_OWN: '★ 正對照：捲入伏特只打「身上有傷害指示物」的（雙方，含對手備戰）、雷丘自己除外',
  HAIL_END: '★★ 冰雹打昏備戰取完最後一張 ⇒ P1 勝，其餘備戰照樣受到 30（同時受傷，不中途停）',
  DRAW_SKY: '★★ 天空波同時打昏自己與對手各一隻、雙方各剩 1 張 ⇒ 平手（審查 P1-1）',
  DRAW_SPIT: '★★ 灑口水同上 ⇒ 平手（審查 P1-1）',
  DRAW_SAND: '★★ 大沙風暴同上 ⇒ 平手（審查 P1-1）',
  DRAW_VOLT: '★★ 捲入伏特同上 ⇒ 平手（審查 P1-1）',
  DRAW_BOMB: '★★★ 轟爆尖刺取完後自傷 130 照樣結算 ⇒ 平手（審查 P2-1，BASE 就錯）',
  SAND: '★★★ 大沙風暴打到備戰拖拖蚓ex ⇒ 快掃拳返 +40；自己有指示物的備戰 +40',
  SPIT: '★★★ 灑口水打到備戰拖拖蚓ex ⇒ 快掃拳返 +40；自己的備戰 +20',
  HAIL: '★★★ 冰雹（hitBenchAll）打到備戰拖拖蚓ex ⇒ 快掃拳返 +40',
  JET: '★★★ 噴射打擊（bench-hit-N）選備戰拖拖蚓ex ⇒ 快掃拳返 +40',
  EXPL: '★★★ 一同爆炸只看自己的場上：100、對手的飄飄球不受傷、自己的各 +30',
  DIVE: '★★ 水俯衝的對戰紀錄寫招式名（不是「攻擊」）',
};
const NEW = ['ICE', 'VOLT', 'SAND', 'SPIT', 'HAIL', 'JET', 'EXPL', 'DIVE', 'DRAW_BOMB'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6536b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.535：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.535：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6536 H', '需要 v6.535 commit');

console.log(`\n=== v6.536 多目標招式收斂中央：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
