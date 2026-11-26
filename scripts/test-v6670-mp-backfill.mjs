#!/usr/bin/env node
/**
 * v6.670 守衛：M-P 特典卡補漏收錄 15 張（玩家回報「超級席多藍恩ex 沒有收錄」）。
 *
 * 【A】資料：15 張都在現役卡池、標記與卡圖實印一致（I×4、J×11，看卡圖核對過）、檔案／card-set-map 對得上
 * 【B】效果實跑
 *   B1 超級席多藍恩ex｜高密度盔甲：HP 全滿時受招式傷害少 60；正對照 大鋼蛇｜高密度盔甲 同樣 60
 *   B2 超級席多藍恩ex｜巨重壓：下個自己的回合「巨重壓」＝140＋140＝280（HEAD-FAIL）
 *   B3 超級席多藍恩ex 是超級進化寶可夢ex（被擊倒給 3 張獎賞）
 *   B4 春紫：戰鬥寶可夢沒有傷害 ⇒ 不能使用；正面恢復 150、反面恢復 30（HEAD-FAIL）
 *   B5 其餘 12 張與既有卡同卡面：主動特性已以卡名註冊、訓練家有效果（不會 fail-closed 打不出來）
 *   B6 謝米｜花之帷幔 新印刷實跑（審查 P2-2）；B7 有效果的招式都已以「卡名|招式名」註冊
 * 【H】HEAD-FAIL：BASE（v6.669）的引擎在同一份卡池上 B2／B4 紅，B1／B3／B5／B6／B7 綠（正對照）
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip, readBaseBlob } from './lib/base-blob.mjs';
import { V6670_MP_IDS, revertV6670Index, revertV6670Map } from './lib/revert-v6670-mp-backfill.mjs';
import { revertV6672Cards, revertV6672Index } from './lib/revert-v6672-m7.mjs';   // ⭐v6.672（Rule 40）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ BASE_SHA 必須是留在 main 上的那一顆（IRON_RULES Rule 45）：v6.669。
const BASE_SHA = '4e42533e';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const fileOf = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) { pool.set(String(c.id), c); fileOf.set(String(c.id), f.slice(0, -5)); all.push(c); }
}
const setMap = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));

// 官網 detail 頁＋卡圖實印（2026-11-22 逐張核對）
const NEW = [
  ['20105', '謝米', 'I'], ['20106', '謝米', 'I'], ['20107', '勝利之證', 'J'], ['20108', '勝利之證', 'J'], ['20109', '勝利之證', 'J'],
  ['20110', '火焰鳥', 'J'], ['20111', '急凍鳥', 'J'], ['20112', '閃電鳥', 'J'], ['20121', '泥偶小人', 'J'], ['20122', '鐵掌力士', 'I'],
  ['20123', '鬼斯', 'J'], ['20124', '超級席多藍恩ex', 'J'], ['20125', '能量回收器', 'I'], ['20126', '春紫', 'J'], ['20127', '沐淨', 'J'],
];

console.log('【A】資料');
for (const [id, name, mark] of NEW) {
  const c = pool.get(id);
  ok(`A1 ${id} ${name}（${mark}）在現役卡池、檔案 M-P-${mark}、card-set-map 一致`,
    !!c && c.name === name && c.regulationMark === mark && fileOf.get(id) === `M-P-${mark}` && setMap[id] === `M-P-${mark}` && c.setCode === `M-P-${mark}`,
    c ? `${c.name}/${c.regulationMark}/${fileOf.get(id)}/${setMap[id]}/${c.setCode}` : '缺');
}

const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const KANJI = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {}; for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(KANJI)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;
const PLAIN = all.filter((c) => HIJ(c) && c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && !/ex$/.test(c.name)).sort((a, b) => b.hp - a.hp)[0];
// 靶：無弱點／無抵抗、無特性、非太晶、非超級（傷害量起來就是招式本身）
const TARGET = all.find((c) => HIJ(c) && c.supertype === 'Pokemon' && Number(c.hp) >= 300 && !(c.abilities || []).length && !c.name.includes('超級')
  && !c.weakness && !c.resistance && !(c.tags || []).some((t) => /太晶/.test(String(t))));
const ATK = all.find((c) => HIJ(c) && c.supertype === 'Pokemon' && (c.attacks || []).some((a) => Number(a.damage) >= 100 && !a.effect && (a.cost || []).length <= 2)
  && c.pokemonType !== 'Fire');
const STEELIX = all.find((c) => HIJ(c) && c.name === '大鋼蛇' && (c.abilities || []).some((a) => a.name === '高密度盔甲'));

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6670-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\n`
    + `export { TRAINER_EFFECTS, hasAbilityFn, ATTACK_PRE, ATTACK_POST } from '${p('src/lib/game/effects/_shared')}';\n`
    + `export { dealAttackDamageToTarget } from '${p('src/lib/game/effects')}';\n`
    + `export { isMegaExCard } from '${p('src/lib/game/selection-filter')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const en = (t) => inst(EID[t] ?? EID.Water);
  const mk = (p0 = {}, p1 = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: String(PLAIN.id), count: 1 }] }, { name: 'P2', entries: [{ cardId: String(PLAIN.id), count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, activeStadium: null, log: [],
      players: [
        { ...s.players[0], hand: [], deck: Array.from({ length: 6 }, () => inst(PLAIN.id)), discard: [], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)], active: inst(PLAIN.id), ...p0 },
        { ...s.players[1], hand: [], deck: Array.from({ length: 6 }, () => inst(PLAIN.id)), discard: [], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)], active: inst(PLAIN.id), ...p1 },
      ] };
  };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + String(e?.message ?? e).split('\n')[0]; } };
  const act = (st, a) => { const o = M.applyAction(st, a, pool); return o?.state ?? o; };

  // B1 高密度盔甲：全滿 vs 已受傷 10 的受傷差
  const armor = (holderId) => {
    const ai = ATK.attacks.findIndex((a) => Number(a.damage) >= 100 && !a.effect && (a.cost || []).length <= 2);
    const run = (dmg) => {
      const A = inst(ATK.id, { energyAttached: (ATK.attacks[ai].cost || []).map(en) });
      const st = mk({ active: A }, { active: inst(holderId, { damage: dmg }) });
      const r = act(st, { type: 'ATTACK', attackIndex: ai });
      return (r?.players?.[1]?.active?.damage ?? -1) - dmg;
    };
    const full = run(0), hurt = run(10);
    return { full, hurt, diff: hurt - full };
  };
  T('B1', () => armor('20124'));
  T('B1c', () => armor(String(STEELIX.id)));

  // B2 巨重壓：第一回合 140，下個自己的回合 280（每次量之前把靶的傷害歸零，避免被打倒換人）
  T('B2', () => {
    const card = pool.get('20124');
    const ai = card.attacks.findIndex((a) => a.name === '巨重壓');
    const es = [...card.attacks[ai].cost.map(en), ...card.attacks[ai].cost.map(en)];
    let st = mk({ active: inst('20124', { energyAttached: es }) }, { active: inst(TARGET.id), bench: [inst(TARGET.id)] });
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    const first = st.players[1].active?.damage ?? -1;
    st = act(st, { type: 'END_TURN' });
    st = act(st, { type: 'END_TURN' });
    const ps = [...st.players]; ps[1] = { ...ps[1], active: { ...ps[1].active, damage: 0 } }; st = { ...st, players: ps };
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    return { first, second: st.players[1].active?.damage ?? -1 };
  });
  T('B3', () => M.isMegaExCard(pool.get('20124')));

  // B4 春紫
  const spring = (dmg, heads) => {
    const tr = inst('20126');
    const st = mk({ hand: [tr], active: inst(TARGET.id, { damage: dmg }) });
    const orig = Math.random;
    Math.random = () => (heads ? 0.1 : 0.9);
    try {
      const r = act(st, { type: 'PLAY_TRAINER', iid: tr.iid });
      return { played: !r.players[0].hand.some((c) => c.iid === tr.iid), dmg: r.players[0].active?.damage };
    } finally { Math.random = orig; }
  };
  T('B4', () => ({ none: spring(0, true), heads: spring(200, true), tails: spring(200, false), small: spring(20, true) }));

  // B5 其餘同卡面卡：主動特性以卡名註冊、訓練家有效果
  T('B5', () => {
    const miss = [];
    for (const [id, name] of NEW) {
      if (name === '春紫') continue;   // 本版新寫的效果，B4 另外驗
      const c = pool.get(id);
      if (c.supertype === 'Trainer' && !M.TRAINER_EFFECTS.has(name)) miss.push(name);
      for (const [abIdx, ab] of (c.abilities || []).entries()) {
        if (/在自己的回合|可使用1次/.test(ab.effect || '') && typeof M.hasAbilityFn === 'function' && !M.hasAbilityFn(name, ab.name, abIdx)) miss.push(`${name}｜${ab.name}`);
      }
    }
    return miss.join(',');
  });
  // B6 謝米｜花之帷幔（新印刷 20105）：備戰的非規則寶可夢受到對手招式的傷害 ⇒ 0；正對照：舊印刷謝米同樣 0、沒有謝米 ⇒ 照常 30
  T('B6', () => {
    const oldShaymin = all.find((c) => HIJ(c) && c.name === '謝米' && !['20105', '20106'].includes(String(c.id)) && (c.abilities || []).some((a) => a.name === '花之帷幔'));
    const hit = (holderId) => {
      const victim = inst(PLAIN.id);
      const bench = holderId ? [victim, inst(holderId)] : [victim];
      const st = mk({}, { bench });
      const r = M.dealAttackDamageToTarget(st, 0, victim.iid, 30, pool);
      const s2 = r?.state ?? r;
      return s2.players[1].bench.find((c) => c.iid === victim.iid)?.damage ?? -1;
    };
    return { neu: hit('20105'), neu2: hit('20106'), old: oldShaymin ? hit(String(oldShaymin.id)) : 'no-old', none: hit(null) };
  });
  // B7 同卡面的招式：有效果文字的招式都已以「卡名|招式名」註冊（卡面逐字相同已由 audit-new-set 比對）
  T('B7', () => {
    const miss = []; let n7 = 0;
    for (const [id, name] of NEW) {
      if (id === '20124') continue;   // 巨重壓是本版新寫的，B2 另外實跑
      for (const a of pool.get(id).attacks || []) {
        if (!a.effect) continue;
        n7++;
        const k = `${name}|${a.name}`;
        if (!M.ATTACK_PRE.has(k) && !M.ATTACK_POST.has(k)) miss.push(k);
      }
    }
    return { n7, miss: miss.join(',') };
  });
  return out;
}

const LABEL = {
  B1: '★★ B1 超級席多藍恩ex｜高密度盔甲：HP 全滿時受到的招式傷害少 60',
  B1c: '★ B1c 正對照：大鋼蛇｜高密度盔甲 同樣少 60',
  B2: '★★★ B2 超級席多藍恩ex｜巨重壓：140 → 下個自己的回合 280',
  B3: '★ B3 超級席多藍恩ex 是超級進化寶可夢ex（中央 isMegaExCard）',
  B4: '★★★ B4 春紫：沒傷害不能用；正面恢復 150、反面恢復 30、傷害 20 時恢復到 0',
  B6: '★ B6 謝米｜花之帷幔（新印刷 2 張）：備戰非規則寶可夢受招式傷害 0；舊印刷正對照 0、沒謝米照常 30',
  B7: '★ B7 同卡面的招式：有效果的招式都已以「卡名|招式名」註冊（同卡面的 5 招以上）',
  B5: '★ B5 其餘同卡面卡：主動特性已以卡名註冊、訓練家有效果',
};
const judge = (r) => ({
  B1: r.B1?.diff === 60 && r.B1.hurt > 0,
  B1c: r.B1c?.diff === 60 && r.B1c.hurt > 0,
  B2: r.B2?.first === 140 && r.B2.second === 280,
  B3: r.B3 === true,
  B4: r.B4?.none?.played === false && r.B4.heads?.played && r.B4.heads.dmg === 50 && r.B4.tails?.played && r.B4.tails.dmg === 170 && r.B4.small?.dmg === 0,
  B5: r.B5 === '',
  B6: r.B6?.neu === 0 && r.B6.neu2 === 0 && r.B6.old === 0 && r.B6.none === 30,
  B7: r.B7?.n7 >= 5 && r.B7.miss === '',
});
const NEWK = ['B2', 'B4'];

console.log('\n【B】效果實跑');
ok('B0 harness 前置：靶／攻擊方／大鋼蛇 都找得到', !!TARGET && !!ATK && !!STEELIX && !!PLAIN, `${!!TARGET} ${!!ATK} ${!!STEELIX}`);
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【D】既有資料逐字未動（BASE blob）');
ok('D0 還原表的 id 清單＝本守衛的 15 張', JSON.stringify(V6670_MP_IDS) === JSON.stringify(NEW.map(([id]) => id)));
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const rb = (p) => { const b = readBaseBlob(ROOT, BASE_SHA, p); if (!b.ok) throw new Error('BASE 缺 ' + p); return JSON.parse(b.out); };
  for (const code of ['M-P-I', 'M-P-J']) {
    const b = rb(`static/cards/${code}.json`), c = revertV6672Cards(code, JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8')));   // ⭐v6.672（Rule 40）先拿掉同版追加的 15 張
    const tail = c.slice(b.length).map((x) => String(x.id));
    ok(`D1 ${code}：BASE 的 ${b.length} 張逐字保留在最前面，後面追加的正好是本版 ${code} 的卡`,
      JSON.stringify(c.slice(0, b.length)) === JSON.stringify(b)
      && JSON.stringify(tail) === JSON.stringify(NEW.filter(([, , m]) => `M-P-${m}` === code).map(([id]) => id)), JSON.stringify(tail));
  }
  const curIdx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  ok('D2 index.json：還原 M-P 兩筆張數後逐字等於 BASE', JSON.stringify(revertV6670Index(curIdx)) === JSON.stringify(rb('static/cards/index.json')));
  let d3 = false, d3x = '';
  try { d3 = JSON.stringify(revertV6670Map(setMap)) === JSON.stringify(rb('static/card-set-map.json')); } catch (e) { d3x = String(e?.message ?? e).split('\n')[0]; }   // Rule 41：不整支 throw
  ok('D3 card-set-map.json：拿掉本版 15 筆後逐字等於 BASE（鍵順序也一樣）', d3, d3x);
  for (const code of ['M-P-I', 'M-P-J']) {
    const e = curIdx.find((x) => x.code === code), c = JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8'));
    const cnt = {}; for (const x of c) cnt[x.supertype] = (cnt[x.supertype] ?? 0) + 1;
    ok(`D4 index.json ${code} 張數三欄＝實際檔案`, e.cardCount === c.length && e.count === c.length && JSON.stringify(Object.entries(e.supertypeCounts).sort()) === JSON.stringify(Object.entries(cnt).sort()));
  }
} else shallowSkip('v6670 D', '需要 v6.669 commit');

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6670b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEWK.includes(k)) ok(`★★★[H] v6.669：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.669：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, String(e?.message ?? e).split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6670 H', '需要 v6.669 commit');

console.log(`\n=== v6.670 M-P 補漏收錄 15 張：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
