#!/usr/bin/env node
/**
 * v6.393 守衛：「丟自身能量」整族招式的傷害改走印刷閘（站長裁示 ②）
 *
 * 【為什麼】`ATTACK_PRE` 的 key 是「卡名|招式名」，沒有印刷維度。
 *   `registerSelfDiscardMultiply` 的第 3 欄 baseDamage 原本是**無條件寫死**的傷害，
 *   同名同招一旦出第二種印刷就會有一版被打壞（前科：皮卡丘ex｜打雷 SVM 220 vs M6a 200）。
 *
 * 【0】fixture　【A】靜態契約　【B】⭐⭐⭐ 行為層（含**人造第二種印刷**）
 * 【C】⭐ 現查：這 64 個 key 目前各只有一種卡面　【D】HEAD-FAIL　【E】chain
 */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const SELF = 'scripts/test-v6393-face-damage-batch.mjs';
const EFF_REL = 'src/lib/game/effects.ts';
// ⚠ BASE_SHA 必須留在 main 上（Rule 45）：git branch -a --contains 76a028ba 要印得出 main。
const BASE_SHA = '76a028ba';   // v6.392（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS ' + name); return true; }
  fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
  return false;
};

const STRAY = [];
const TMP = mkdtempSync(join(tmpdir(), 'v6393-'));
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* */ } } try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ } });
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const p = './' + srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const S = join(parent, '.v6393-s-' + tag + '.js');
  const E = join(parent, '.v6393-e-' + tag + '.ts');
  const O = join(parent, '.v6393-o-' + tag + '.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, "export { applyAction } from '" + p + "/lib/game/engine';\nimport '" + p + "/lib/game/effects';\n");
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent' });
  return import(pathToFileURL(O).href);
}

const EFF = readFileSync(join(ROOT, EFF_REL), 'utf8');

// ── 現查表內容 ──────────────────────────────────────────────────────────────
const tblStart = EFF.indexOf('const SELF_DISCARD_UNITS_BATCH');
const tblEnd = EFF.indexOf('];', tblStart);
const ROWS = [...EFF.slice(tblStart, tblEnd).matchAll(/\[\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'\s*\]/g)]
  .map((m) => ({ key: m[1], label: m[2], dmg: Number(m[3]), n: Number(m[4]), tf: m[5] }));
const CALLS = [...EFF.matchAll(/registerSelfDiscardMultiply\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)]
  .map((m) => ({ key: m[1], label: m[2], dmg: Number(m[3]), per: Number(m[4]), max: Number(m[5]) }));

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('【0】fixture');
// ═══════════════════════════════════════════════════════════════════════════
chk('F0 ⭐ 抓得到 SELF_DISCARD_UNITS_BATCH，而且條數是現查的量級', ROWS.length >= 45, String(ROWS.length));
chk('F0b ⭐ 抓得到直接呼叫', CALLS.length >= 19, String(CALLS.length));
chk('F0c ★ 哨兵：卡池是活的', all.length > 4000, String(all.length));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】靜態契約');
// ═══════════════════════════════════════════════════════════════════════════
chk('A1 ⭐⭐ regPre 的傷害用的是 faceBase（讀卡面），不是寫死的 baseDamage',
  EFF.includes('const dmg = faceBase + per * discarded.length;')
  && !EFF.includes('const dmg = baseDamage + per * discarded.length;'));
chk('A2 ⭐ faceBase 真的來自 faceAttackDamage(state, aIdx, pool, label, baseDamage)',
  /const faceBase = faceAttackDamage\(state, aIdx, pool, label, baseDamage\);/.test(EFF));
chk('A3 ⭐ faceAttackDamage 有被 import 進 effects.ts',
  /import \{[^}]*faceAttackDamage[^}]*\} from '\.\/effects\/_shared';/.test(EFF));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐⭐ 行為層：人造第二種印刷');
// ═══════════════════════════════════════════════════════════════════════════
const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');
const eName = (n) => { for (const c of all) if (c.name === n && c.supertype === 'Energy') return String(c.id); return null; };
const FIRE = eName('基本【火】能量');
const en = (cid, iid) => ({ iid, cardId: cid, damage: 0, energyAttached: [] });
const mon = (cid, iid, o = {}) => ({ iid, cardId: cid, damage: 0, energyAttached: [], ...o });
const PL = (name, o = {}) => ({ name, active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...o });
const E6 = (cid) => [1, 2, 3, 4, 5, 6].map((i) => en(cid, 'ae' + i));
// 肉盾現查挑選：HP 夠厚、無抵抗力、弱點不是火
const TANK = all.find((c) => c.supertype === 'Pokemon' && ['H', 'I', 'J'].includes(c.regulationMark)
  && Number(c.hp) >= 330 && !c.resistance && c.weakness?.type !== 'Fire');
chk('B0 ★ fixture：找得到合格的肉盾與火能量', !!TANK && !!FIRE,
  JSON.stringify({ tank: TANK?.name, hp: TANK?.hp, w: TANK?.weakness?.type, FIRE }));

function hit(atkId, atkName, poolOverride) {
  const p = poolOverride ?? pool;
  const c = p.get(String(atkId));
  const i = (c.attacks || []).findIndex((a) => a.name === atkName);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      PL('P0', { active: mon(String(atkId), 'atk', { energyAttached: E6(FIRE) }), deck: [en(FIRE, 'd1')] }),
      PL('P1', { active: mon(String(TANK.id), 'def'), deck: [en(FIRE, 'e1')] }),
    ],
  };
  try {
    const s = HEAD.applyAction(st, { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, p);
    return { dmg: s.players[1].active?.damage ?? null, e: s.players[0].active?.energyAttached?.length ?? null };
  } catch (e) { return { err: String(e && e.message) }; }
}

// B1：表內一張真實的卡，傷害 === 卡面
const SAMPLE = ROWS.find((r) => r.key === '小火龍|火花') ?? ROWS.find((r) => r.dmg > 0);
chk('B1 ★ fixture：挑得到一個 baseDamage > 0 的樣本', !!SAMPLE, JSON.stringify(SAMPLE ?? null));
if (SAMPLE) {
  const [cn, an] = SAMPLE.key.split('|');
  const card = all.find((c) => c.name === cn && (c.attacks || []).some((a) => a.name === an));
  const face = parseInt(String((card.attacks.find((a) => a.name === an) || {}).damage ?? ''), 10);
  const r = hit(card.id, an);
  chk('B2 ⭐ ' + SAMPLE.key + '：實跑傷害 === 卡面 ' + face, r.dmg === face, JSON.stringify({ got: r.dmg, face, err: r.err }));
  chk('B2b ⭐ 而且真的丟了 1 個自身能量（6 → 5）', r.e === 6 - SAMPLE.n, JSON.stringify(r));

  // ⭐⭐⭐ B3：人造第二種印刷 —— 同名同招、damage 不同的假卡。
  //   這是本版的本體：寫死傷害的舊寫法在這裡會回「表裡的數字」，印刷閘會回「這張卡自己的數字」。
  const FAKE_ID = '__v6393_fake__';
  const fake = JSON.parse(JSON.stringify(card));
  fake.id = FAKE_ID;
  fake.attacks.find((a) => a.name === an).damage = String(face + 55);
  const pool2 = new Map(pool);
  pool2.set(FAKE_ID, fake);
  const r2 = hit(FAKE_ID, an, pool2);
  chk('B3 ⭐⭐⭐ 人造第二種印刷（' + (face + 55) + '）：引擎讀的是**這張卡自己的卡面**，不是表裡寫死的 ' + SAMPLE.dmg,
    r2.dmg === face + 55, JSON.stringify({ got: r2.dmg, want: face + 55, err: r2.err }));
  // ★ 反面對照：假卡與真卡只差 damage 一個欄位（證明 B3 測到的就是那一個差異）
  chk('B3b ★ 反面對照：假卡與真卡除了 damage 之外逐字相同',
    JSON.stringify({ ...fake, id: card.id, attacks: fake.attacks.map((a) => ({ ...a, damage: a.name === an ? String(face) : a.damage })) })
      === JSON.stringify(card));
}

// B4：per > 0 的倍率型不受影響（卡面是「×」或「+」⇒ faceAttackDamage 回 fallback）
{
  const mult = CALLS.find((c) => c.per > 0 && c.dmg === 0);
  chk('B4 ★ fixture：挑得到一個 per>0 的倍率型', !!mult, JSON.stringify(mult ?? null));
  if (mult) {
    const [cn, an] = mult.key.split('|');
    const card = all.find((c) => c.name === cn && (c.attacks || []).some((a) => a.name === an));
    const raw = String((card?.attacks?.find((a) => a.name === an) || {}).damage ?? '');
    chk('B4b ⭐ 倍率型的卡面 damage 不是純數字（所以 faceAttackDamage 會回 fallback 0，行為不變）',
      !/^\d+$/.test(raw), JSON.stringify({ key: mult.key, raw }));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐ 現查：這些 key 目前各只有一種卡面');
// ═══════════════════════════════════════════════════════════════════════════
{
  const multi = [];
  for (const r of [...ROWS, ...CALLS]) {
    const [cn, an] = r.key.split('|');
    const faces = new Set();
    for (const c of all) if (c.name === cn) for (const a of (c.attacks || [])) if (a.name === an) faces.add(String(a.damage ?? ''));
    if (faces.size > 1) multi.push(r.key + '→' + JSON.stringify([...faces]));
  }
  // ⚠ 這條**不是**「不准有多印刷」—— 改走印刷閘之後多印刷本來就沒問題了。
  //   它是「現況登記」：出現第二種卡面時亮一次，讓人回來確認印刷閘真的有生效（B3 在守）。
  chk('C1 ★ 現況登記：這 ' + (ROWS.length + CALLS.length) + ' 個 key 目前各只有一種卡面',
    multi.length === 0, JSON.stringify(multi));
  const noCard = [...ROWS, ...CALLS].filter((r) => {
    const [cn, an] = r.key.split('|');
    return !all.some((c) => c.name === cn && (c.attacks || []).some((a) => a.name === an));
  });
  chk('C2 ⭐ 每個 key 在卡池裡都找得到對應的卡（找不到＝表過期了）', noCard.length === 0, JSON.stringify(noCard.map((r) => r.key)));
  const labelBad = [...ROWS, ...CALLS].filter((r) => r.label !== r.key.split('|')[1]);
  chk('C3 ⭐⭐ label 必須等於招式名（faceAttackDamage 是用 label 去卡面找那一招的）',
    labelBad.length === 0, JSON.stringify(labelBad.map((r) => r.key + '≠' + r.label)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐⭐⭐ HEAD-FAIL');
// ═══════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6.393【D】HEAD-FAIL', '需要歷史 commit');
} else {
  const b = readBaseBlob(ROOT, BASE_SHA, EFF_REL);
  if (!b.ok) chk('D0 讀得到 BASE 的 effects.ts', false);
  else {
    chk('D1 ⭐⭐⭐ BASE 的傷害是寫死的 baseDamage（不是 faceBase）',
      b.out.includes('const dmg = baseDamage + per * discarded.length;') && !b.out.includes('faceBase'));
    chk('D1b ★ 哨兵：BASE 的 effects.ts 是活的', b.out.includes('SELF_DISCARD_UNITS_BATCH'), String(b.out.length));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】在 npm test chain 裡');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const chain = String(pkg.scripts?.test || '').split('&&').map((s) => s.trim()).filter(Boolean);
  chk('E1 ⭐ scripts.test 裡**恰好**有本檔一次',
    chain.filter((s) => s === 'node ' + SELF).length === 1,
    String(chain.filter((s) => s === 'node ' + SELF).length));
}

console.log(`\n=== v6.393 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
