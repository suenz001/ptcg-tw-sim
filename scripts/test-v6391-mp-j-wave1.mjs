#!/usr/bin/env node
/**
 * v6.391 守衛：M-P 特典卡（J 標）32 張進卡庫 ＋ 招式實裝 批次 1
 *
 * 【這一版做了什麼】
 *   官方「M-P 特典卡」現查 195 張，站上只有 165 張（H 11 ＋ I 51 ＋ J 103）
 *   ⇒ 差集 32 張（id 19668~19670、19720~19748）全部補上，現查全部是 **J 標**。
 *   32 張裡 21 張零程式碼（純傷害無效果，或與站上既有同名卡逐字相同的再版），
 *   11 招要登記 —— 全部指既有中央 helper，沒有新造任何判準（Rule 38）。
 *
 * 【0】資料層 fixture（卡面逐字取自 static/cards/M-P-J.json）
 * 【A】卡表對帳（張數／標別／index.json／重複 id）
 * 【B】⭐⭐ 行為層：11 招逐一實跑引擎
 * 【C】⭐ Rule 38：每個 key 只註冊一次；新檔不得自己造判準
 * 【D】在 npm test chain 裡
 * 【E】⭐⭐⭐ HEAD-FAIL：BASE(v6.390) 上這些全部不成立
 *
 * ⚠ 誠實聲明：本檔驗的是「引擎算出來對不對」，不驗 UI。
 */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46：禁 pathname.slice
const SELF = 'scripts/test-v6391-mp-j-wave1.mjs';
// ⚠ BASE_SHA 必須是留在 main 上的那一顆（Rule 45）：git branch -a --contains e1c756f9 要印得出 main。
const BASE_SHA = 'e1c756f9ca5b8064fa3f5d27ba11b485f6189b25';   // v6.390（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS ' + name); return true; }
  fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
  return false;
};

const STRAY = [];
const TMP = mkdtempSync(join(tmpdir(), 'v6391-'));
process.on('exit', () => {
  for (const p of STRAY) { try { unlinkSync(p); } catch { /* */ } }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
});
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const p = './' + srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const S = join(parent, '.v6391-s-' + tag + '.js');
  const E = join(parent, '.v6391-e-' + tag + '.ts');
  const O = join(parent, '.v6391-o-' + tag + '.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E,
    "export { applyAction } from '" + p + "/lib/game/engine';\n"
    + "export { ATTACK_PRE, ATTACK_POST } from '" + p + "/lib/game/effects';\n"
    + "import '" + p + "/lib/game/effects';\n");
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const IDX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const live = new Set(IDX.map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => pool.get(String(id));
const atkOf = (c, n) => (c?.attacks || []).find((a) => a.name === n);
const idxOf = (c, n) => (c?.attacks || []).findIndex((a) => a.name === n);

// ── 本版新增的 32 張（現查差集；寫死在守衛裡＝這一版的宣告）─────────────────
const NEW_IDS = ['19668', '19669', '19670',
  '19720', '19721', '19722', '19723', '19724', '19725', '19726', '19727', '19728', '19729',
  '19730', '19731', '19732', '19733', '19734', '19735', '19736', '19737', '19738', '19739',
  '19740', '19741', '19742', '19743', '19744', '19745', '19746', '19747', '19748'];

// ── 11 招的卡面文字（逐字，含它類推的既有來源）────────────────────────────
const IMPL = [
  ['19720', '妙蛙種子', '寄生種子', '將這隻寶可夢恢復「10」HP。'],
  ['19721', '小火龍', '火花', '選擇1個這隻寶可夢身上附加的能量，將其丟棄。'],
  ['19722', '傑尼龜', '泡沫', '擲1次硬幣若為正面，則將對手的戰鬥寶可夢【麻痺】。'],
  ['19730', '小火焰猴', '亂抓', '擲3次硬幣，造成正面出現的次數×20點傷害。'],
  ['19733', '暖暖豬', '火花', '選擇1個這隻寶可夢身上附加的能量，將其丟棄。'],
  ['19734', '水水獺', '貝殼刃', '擲1次硬幣若為正面，則增加30點傷害。'],
  ['19735', '哈力栗', '飛彈針', '擲4次硬幣，造成正面出現的次數×10點傷害。'],
  ['19739', '火斑喵', '火焰牙', '將對手的戰鬥寶可夢【灼傷】。'],
  ['19740', '球球海獅', '魅惑之聲', '將對手的戰鬥寶可夢【混亂】。'],
  ['19742', '炎兔兒', '二連踢', '擲2次硬幣，造成正面出現的次數×20點傷害。'],
  ['19745', '呆火鱷', '噴射火焰', '選擇1個這隻寶可夢身上附加的能量，將其丟棄。'],
];

// ═══════════════════════════════════════════════════════════════════════════
console.log('【0】資料層 fixture');
// ═══════════════════════════════════════════════════════════════════════════
chk('0a 32 張全部進了卡池', NEW_IDS.every((id) => !!byId(id)),
  JSON.stringify(NEW_IDS.filter((id) => !byId(id))));
chk('0b ⭐ 全部是 J 標（站長：只處理 H／I／J，G 標不在標準賽範圍）',
  NEW_IDS.every((id) => byId(id)?.regulationMark === 'J'),
  JSON.stringify(NEW_IDS.map((id) => byId(id)?.regulationMark).filter((m) => m !== 'J')));
chk('0c ⭐ setCode 全部是 M-P-J（官方 detail 頁給的是 M-P，站上卡表按標拆檔）',
  NEW_IDS.every((id) => byId(id)?.setCode === 'M-P-J'),
  JSON.stringify([...new Set(NEW_IDS.map((id) => byId(id)?.setCode))]));
chk('0d ⭐⭐ 這 11 招的卡面文字逐字相符（改了卡面就必須回來重看實作）',
  IMPL.every(([id, nm, atk, eff]) => byId(id)?.name === nm && atkOf(byId(id), atk)?.effect === eff),
  JSON.stringify(IMPL.filter(([id, nm, atk, eff]) => !(byId(id)?.name === nm && atkOf(byId(id), atk)?.effect === eff)).map((x) => x[1] + '|' + x[2])));
// ★ Rule 38 的前提：每一招都在站上找得到**逐字相同**的既有卡（不是自己發明措辭）
{
  const norm = (s) => String(s ?? '').replace(/\s+/g, '');
  const bad = [];
  for (const [id, , atk, eff] of IMPL) {
    const others = all.filter((c) => String(c.id) !== id && (c.attacks || []).some((a) => norm(a.effect) === norm(eff)));
    if (!others.length) bad.push(atk);
  }
  chk('0e ⭐⭐ 每一招在站上都找得到**逐字相同**的既有卡（＝可以指既有判準的前提）',
    bad.length === 0, JSON.stringify(bad));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】卡表對帳');
// ═══════════════════════════════════════════════════════════════════════════
{
  const mpj = JSON.parse(readFileSync(join(dir, 'M-P-J.json'), 'utf8'));
  const row = IDX.find((e) => e.code === 'M-P-J');
  chk('A1 ⭐ index.json 的 M-P-J count／cardCount ＝ 檔案實際張數',
    row?.count === mpj.length && row?.cardCount === mpj.length,
    JSON.stringify({ count: row?.count, cardCount: row?.cardCount, real: mpj.length }));
  const counts = {};
  for (const c of mpj) counts[c.supertype] = (counts[c.supertype] ?? 0) + 1;
  chk('A2 ⭐ index.json 的 supertypeCounts ＝ 現查重算的結果',
    JSON.stringify(row?.supertypeCounts) === JSON.stringify(
      Object.fromEntries(['Pokemon', 'Trainer', 'Energy'].filter((k) => counts[k]).map((k) => [k, counts[k]]))),
    JSON.stringify({ row: row?.supertypeCounts, real: counts }));
  chk('A3 ⭐ M-P-J.json 內沒有重複 id', new Set(mpj.map((c) => String(c.id))).size === mpj.length);
  const dup = [];
  const seen = new Set();
  for (const c of all) { const k = String(c.id); if (seen.has(k)) dup.push(k); seen.add(k); }
  chk('A4 ⭐⭐ 全卡池（44 個卡包）沒有重複 id', dup.length === 0, JSON.stringify([...new Set(dup)]));
  chk('A5 ★ 哨兵：M-P-J 真的變多了（不是空跑）', mpj.length >= 135, String(mpj.length));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐ 行為層：11 招逐一實跑引擎');
// ═══════════════════════════════════════════════════════════════════════════
const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');
const eName = (n) => { for (const c of all) if (c.name === n && c.supertype === 'Energy') return String(c.id); return null; };
const GRASS = eName('基本【草】能量'), FIRE = eName('基本【火】能量'), WATER = eName('基本【水】能量'), LIGHT = eName('基本【雷】能量');
chk('B0 ★ fixture：抓得到草／火／水／雷四種基本能量', !!GRASS && !!FIRE && !!WATER && !!LIGHT, JSON.stringify({ GRASS, FIRE, WATER, LIGHT }));

const en = (cid, iid) => ({ iid, cardId: cid, damage: 0, energyAttached: [] });
const mon = (cid, iid, o = {}) => ({ iid, cardId: cid, damage: 0, energyAttached: [], ...o });
const PL = (name, o = {}) => ({ name, active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...o });
const E6 = (cid) => [1, 2, 3, 4, 5, 6].map((i) => en(cid, 'ae' + i));
const DECK = (cid) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => en(cid, 'dk' + n));
// ⚠⚠ 肉盾**不可以寫死 id**（v6.391 審查者 🟡-8）：原本寫 19680 並在註解裡「保證」它的弱點是【惡】，
//   但那只是註解、沒有斷言，而且完全沒提抵抗力，HP 也沒釘住
//   ⇒ 卡表一改，B1b／B3／B4／B5／B8／B9 的傷害數字會一起歪，而且會以「看不出原因」的方式紅。
//   ⇒ 改成**現查挑一隻**：HP 夠厚（不會被 200 打死）、弱點不在本檔用到的四種屬性裡、沒有抵抗力。
const DEF_C = all.find((c) => c.supertype === 'Pokemon' && ['H', 'I', 'J'].includes(c.regulationMark)
  && Number(c.hp) >= 330 && !c.resistance
  && !['Grass', 'Fire', 'Water', 'Lightning'].includes(c.weakness?.type));
const DEF = String(DEF_C?.id ?? '');
chk('B0b ★ fixture：找得到合格的肉盾（HP≥330、無抵抗力、弱點不是草／火／水／雷）', !!DEF_C,
  JSON.stringify({ id: DEF_C?.id, n: DEF_C?.name, hp: DEF_C?.hp, w: DEF_C?.weakness?.type, r: DEF_C?.resistance ?? null }));

function hit(atkId, atkIdx, { energyCid = GRASS, selfDamage = 0 } = {}) {
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      PL('P0', { active: mon(atkId, 'atk', { damage: selfDamage, energyAttached: E6(energyCid) }), deck: DECK(energyCid) }),
      PL('P1', { active: mon(DEF, 'def'), deck: DECK(energyCid) }),
    ],
  };
  try {
    const s = HEAD.applyAction(st, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
    return {
      defDamage: s.players[1].active?.damage ?? null,
      defStatus: s.players[1].active?.status ?? null,
      atkDamage: s.players[0].active?.damage ?? null,
      atkEnergy: s.players[0].active?.energyAttached?.length ?? null,
      pend: s.pendingSelection?.effectKey ?? null,
      pendType: s.pendingSelection?.type ?? null,
    };
  } catch (e) { return { err: String(e && e.message) }; }
}
const ORND = Math.random;
const withCoin = (v, fn) => { Math.random = () => v; try { return fn(); } finally { Math.random = ORND; } };
const HEADS = 0.1, TAILS = 0.9;

// B1 妙蛙種子｜寄生種子 —— 自身回 10
{
  const c = byId('19720'), i = idxOf(c, '寄生種子');
  const r = hit('19720', i, { energyCid: GRASS, selfDamage: 30 });
  chk('B1 ⭐ 寄生種子：自身 30 傷 ⇒ 回 10 變 20', r.atkDamage === 20, JSON.stringify(r));
  chk('B1b ⭐ 且卡面傷害 10 有打出去', r.defDamage === 10, JSON.stringify(r.defDamage ?? r.err));
}
// B2 傑尼龜｜泡沫 —— 擲幣麻痺
{
  const i = idxOf(byId('19722'), '泡沫');
  const h = withCoin(HEADS, () => hit('19722', i, { energyCid: WATER }));
  const t = withCoin(TAILS, () => hit('19722', i, { energyCid: WATER }));
  chk('B2 ⭐ 泡沫：正面 ⇒ 對手【麻痺】', h.defStatus === 'paralyzed', JSON.stringify(h));
  chk('B2b ⭐ 泡沫：反面 ⇒ 沒有狀態（不是恆真）', !t.defStatus, JSON.stringify(t));
}
// B3 火斑喵｜火焰牙 —— 無條件灼傷
{
  const i = idxOf(byId('19739'), '火焰牙');
  const r = hit('19739', i, { energyCid: FIRE });
  chk('B3 ⭐ 火焰牙：對手【灼傷】＋20 傷', r.defStatus === 'burned' && r.defDamage === 20, JSON.stringify(r));
}
// B4 球球海獅｜魅惑之聲 —— 無條件混亂
{
  const i = idxOf(byId('19740'), '魅惑之聲');
  const r = hit('19740', i, { energyCid: WATER });
  chk('B4 ⭐ 魅惑之聲：對手【混亂】＋20 傷', r.defStatus === 'confused' && r.defDamage === 20, JSON.stringify(r));
}
// B5~B7 擲 N 次 ×M
for (const [id, atk, flips, per] of [['19730', '亂抓', 3, 20], ['19735', '飛彈針', 4, 10], ['19742', '二連踢', 2, 20]]) {
  const i = idxOf(byId(id), atk);
  const cid = id === '19735' ? GRASS : FIRE;
  const h = withCoin(HEADS, () => hit(id, i, { energyCid: cid }));
  const t = withCoin(TAILS, () => hit(id, i, { energyCid: cid }));
  chk('B5 ⭐ ' + atk + '：' + flips + ' 幣全正 ⇒ ' + (flips * per), h.defDamage === flips * per, JSON.stringify(h));
  chk('B5b ⭐ ' + atk + '：全反 ⇒ 0（不是恆真）', t.defDamage === 0, JSON.stringify(t));
}
// B8 水水獺｜貝殼刃 10+30
{
  const i = idxOf(byId('19734'), '貝殼刃');
  const h = withCoin(HEADS, () => hit('19734', i, { energyCid: WATER }));
  const t = withCoin(TAILS, () => hit('19734', i, { energyCid: WATER }));
  chk('B8 ⭐ 貝殼刃：正面 ⇒ 10+30 = 40', h.defDamage === 40, JSON.stringify(h));
  chk('B8b ⭐ 貝殼刃：反面 ⇒ 10', t.defDamage === 10, JSON.stringify(t));
}
// B9~B11 自身丟 1 個能量（走 SELF_DISCARD_UNITS_BATCH 的 picker）
for (const [id, atk, dmg, cid] of [['19721', '火花', 30, FIRE], ['19733', '火花', 40, FIRE], ['19745', '噴射火焰', 70, FIRE]]) {
  const i = idxOf(byId(id), atk);
  const r = hit(id, i, { energyCid: cid });
  chk('B9 ⭐ ' + byId(id).name + '｜' + atk + '：卡面傷害 ' + dmg + ' 打得出來', r.defDamage === dmg, JSON.stringify(r));
  // ⚠ 原本寫 `r.pend !== null || r.atkEnergy === 5`（v6.391 審查者 🟡-7）：同一次 applyAction
  //   不可能同時「開了 picker（能量還是 6）」又「能量少 1」⇒ 兩個分支必有一個是死的，
  //   而且分不出「丟了剛好 1 個」與「開了不相干的 pending、一個都沒丟」。
  //   現查：沒有帶 chosenIids 時走的是自動丟 1 個的 fallback ⇒ 期望值是確定的。
  chk('B9b ⭐⭐ ' + byId(id).name + '｜' + atk + '：自身能量 6 → 5，且沒有留下 pendingSelection',
    r.atkEnergy === 5 && r.pend === null, JSON.stringify({ pend: r.pend, pendType: r.pendType, e: r.atkEnergy }));
}

// ── ⭐⭐⭐ B16／B17（v6.391 審查者 🔴-4）：不要只守「本版登記的 11 招」───────────
//   IMPL 只列 11 招，其餘 21 張是靠註解宣稱「純傷害無效果，或與既有同名卡逐字相同」。
//   那句話沒有任何斷言撐著，兩個洞：
//     (a) 官方重抓卡表時某張多出一句效果 ⇒ 沒有東西會紅，那張卡靜默少做事；
//     (b) 有 5 張完全依賴**別的檔案**裡的 key（慶祝開場樂／樂園度假地／皮卡丘｜激戰電光／
//         皮卡丘ex 的四招），那些 key 被重構掉，M-P 這幾張跟著壞而本守衛不知道。
{
  const noReg = [], mism = [];
  for (const id of NEW_IDS) {
    const c = byId(id);
    for (const a of (c.attacks || [])) {
      const key = c.name + '|' + a.name;
      const reg = !!(HEAD.ATTACK_PRE?.has?.(key) || HEAD.ATTACK_POST?.has?.(key));
      if (String(a.effect ?? '').trim() && !reg) noReg.push(id + ' ' + key);
      if (!reg) continue;
      // 已註冊，但站上同名同招的**其他印刷**卡面不同 ⇒ ATTACK_PRE 的 key 沒有印刷維度，
      //   必須實跑證明引擎讀的是「出招這張卡」的卡面（印刷閘）。
      const diff = all.some((o) => String(o.id) !== id && o.name === c.name
        && (o.attacks || []).some((x) => x.name === a.name
          && (String(x.damage) !== String(a.damage) || String(x.effect ?? '') !== String(a.effect ?? ''))));
      if (diff) mism.push([id, a.name, a.damage]);
    }
  }
  chk('B16 ⭐⭐⭐ 32 張裡「有效果文字」的招式，key 全部已註冊（沒有一張靜默少做事）',
    noReg.length === 0, JSON.stringify(noReg));
  chk('B16b ★ 哨兵：ATTACK_PRE／ATTACK_POST 真的載入了（不是空 Map 讓上面恆真）',
    (HEAD.ATTACK_PRE?.size ?? 0) > 500 && (HEAD.ATTACK_POST?.size ?? 0) > 500,
    JSON.stringify({ pre: HEAD.ATTACK_PRE?.size, post: HEAD.ATTACK_POST?.size }));
  // 現查（Rule 46）：這 32 張裡有 2 招踩到「同名同招、不同印刷」——
  //   皮卡丘ex｜十萬伏特（M-P 200＋丟光能量／MC 版 120 無效果）與 皮卡丘ex｜打雷（M-P 200／SVM 版 220）。
  chk('B17 ★ 現查：踩到多印刷的就是那 2 招（多了一招就代表卡表變了，要回來重看印刷閘）',
    mism.length === 2 && mism.every(([, n]) => n === '十萬伏特' || n === '打雷'), JSON.stringify(mism));
  for (const [id, atkName, faceDmg] of mism) {
    const i = idxOf(byId(id), atkName);
    const r = hit(id, i, { energyCid: LIGHT });
    chk('B17b ⭐⭐⭐ ' + id + ' ' + byId(id).name + '｜' + atkName + '：引擎讀的是**自己卡面**的 ' + faceDmg + ' 點',
      r.defDamage === parseInt(String(faceDmg), 10), JSON.stringify({ face: faceDmg, got: r.defDamage, err: r.err }));
  }
  // 十萬伏特的 M-P 版多了「丟棄全部能量」⇒ 印刷閘要連**效果**一起讀
  {
    const i = idxOf(byId('19747'), '十萬伏特');
    const r = hit('19747', i, { energyCid: LIGHT });
    chk('B17c ⭐⭐ 19747 十萬伏特（M-P 版）：卡面多的「丟棄全部能量」有生效（自身能量 6 → 0）',
      r.atkEnergy === 0, JSON.stringify(r));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐ Rule 38：每個 key 只註冊一次，新檔不得自己造判準');
// ═══════════════════════════════════════════════════════════════════════════
{
  const srcFiles = [];
  (function walk(d) {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) walk(p); else if (/\.ts$/.test(n.name)) srcFiles.push(p);
    }
  })(join(ROOT, 'src/lib/game'));
  const SRC = srcFiles.map((p) => [p.slice(ROOT.length + 1).replace(/\\/g, '/'), readFileSync(p, 'utf8')]);
  const bad = [];
  for (const [id, nm, atk] of IMPL) {
    void id;
    const key = nm + '|' + atk;
    let n = 0;
    for (const [, s] of SRC) n += s.split("'" + key + "'").length - 1;
    if (n !== 1) bad.push(key + '×' + n);
  }
  // ⚠ 這是**文字**計數，不是 registry 計數（v6.391 審查者 🟡-9）：Map 裡後者會覆蓋前者，
  //   數不出「註冊了兩次」。文字計數抓得到「複製一行 regPost」這種最常見的 Rule 38 違規，
  //   registry 存在性則由 B16 那一段守著 —— 兩者互補，都不可少。
  chk('C1 ⭐⭐ 這 11 個 key 在 src/lib/game 底下各**恰好出現一次**（Rule 38，文字層）', bad.length === 0, JSON.stringify(bad));
  chk('C1b ⭐ 這 11 個 key 在 registry 裡都查得到（行為層存在性）',
    IMPL.every(([, nm, atk]) => HEAD.ATTACK_PRE?.has?.(nm + '|' + atk) || HEAD.ATTACK_POST?.has?.(nm + '|' + atk)),
    JSON.stringify(IMPL.filter(([, nm, atk]) => !(HEAD.ATTACK_PRE?.has?.(nm + '|' + atk) || HEAD.ATTACK_POST?.has?.(nm + '|' + atk))).map((x) => x[1] + '|' + x[2])));

  const wave = readFileSync(join(ROOT, 'src/lib/game/effects/cards/mp_j_wave1.ts'), 'utf8');
  chk('C2 ⭐ 新檔只 import 既有 helper，不自己定義判準函式',
    !/\b(function|=>\s*\{)/.test(wave.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
    JSON.stringify((wave.match(/\bfunction\b/g) || []).length));
  chk('C3 ⭐ 新檔有掛進 effects.ts 的 import 鏈',
    readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8').includes("effects/cards/mp_j_wave1"));
  // ⚠ 判準是「**那三個 key** 出現在 effects.ts 的表裡、而且**沒有**出現在新檔」——
  //   不可以寫成「新檔裡不准出現『火花』兩個字」：檔頭註解正好在解釋這三招為什麼不放這裡 ⇒ 誤紅。
  const EFF = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const KEYS3 = ["'小火龍|火花'", "'暖暖豬|火花'", "'呆火鱷|噴射火焰'"];
  chk('C4 ⭐ 三個「丟 1 個自身能量」的招式走的是 SELF_DISCARD_UNITS_BATCH 那張表（新檔裡不可以再 reg 一次）',
    KEYS3.every((k) => EFF.includes(k) && !wave.includes(k)),
    JSON.stringify(KEYS3.filter((k) => !(EFF.includes(k) && !wave.includes(k)))));
  // ⭐⭐ C5（v6.391 審查者 🔴-3 的收斂）：SELF_DISCARD_UNITS_BATCH 的第 3 欄是**寫死的傷害**，
  //   而 ATTACK_PRE 的 key 沒有印刷維度 ⇒ 同名同招一旦有第二種卡面，就會有一版被打壞。
  //   現查（Rule 46）：本版加的這 3 個 key 在全卡池各只有一種卡面。
  //   ⚠ 這條只守本版加的 3 個；整張表（27 個 key）都有同型風險，列為待辦，不在本版範圍。
  {
    const multi = [];
    for (const [cn, an] of [['小火龍', '火花'], ['暖暖豬', '火花'], ['呆火鱷', '噴射火焰']]) {
      const faces = new Set();
      for (const c of all) if (c.name === cn) for (const a of (c.attacks || [])) if (a.name === an) faces.add(String(a.damage) + '|' + String(a.effect));
      if (faces.size !== 1) multi.push(cn + '|' + an + '×' + faces.size);
    }
    chk('C5 ⭐⭐ 這 3 個走「寫死傷害」的 key，在全卡池各只有一種卡面（有第二種就必須改走印刷閘）',
      multi.length === 0, JSON.stringify(multi));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】⭐⭐⭐ HEAD-FAIL：BASE(v6.390) 上這些全部不成立');
// ═══════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6.391【E】HEAD-FAIL', '需要歷史 commit');
} else {
  const b = readBaseBlob(ROOT, BASE_SHA, 'static/cards/M-P-J.json');
  if (!b.ok) chk('E0 讀得到 BASE 的 M-P-J.json', false);
  else {
    const baseIds = new Set(JSON.parse(b.out).map((c) => String(c.id)));
    chk('E1 ⭐⭐⭐ BASE 的 M-P-J.json **一張都沒有**這 32 張',
      NEW_IDS.every((id) => !baseIds.has(id)), JSON.stringify(NEW_IDS.filter((id) => baseIds.has(id))));
    chk('E1b ★ 哨兵：BASE 的 M-P-J.json 是活的（有 103 張）', baseIds.size === 103, String(baseIds.size));
  }
  const be = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/effects.ts');
  chk('E2 ⭐⭐ BASE 的 effects.ts 沒有那 3 個 batch 條目、也沒有 import 新檔',
    be.ok && !be.out.includes("'小火龍|火花'") && !be.out.includes('effects/cards/mp_j_wave1'));
  chk('E2b ★ 哨兵：BASE 的 effects.ts 是活的（有 SELF_DISCARD_UNITS_BATCH）',
    be.ok && be.out.includes('SELF_DISCARD_UNITS_BATCH'), String(be.ok && be.out.length));
  const bw = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/effects/cards/mp_j_wave1.ts');
  chk('E3 ⭐ BASE 根本沒有 mp_j_wave1.ts 這個檔', !bw.ok || !bw.out);
  // ⭐⭐⭐ E4（v6.391）：這才是「只 append、既有資料一筆都沒搬動」的真判準。
  //   test-v6241 ⑨ 的快照表被本版從 103 改成 135（Rule 40 收斂成下限），
  //   那條就守不到「既有 103 筆有沒有被偷改」了 —— 由這一條接手。
  if (b.ok) {
    const baseArr = JSON.parse(b.out);
    const headArr = JSON.parse(readFileSync(join(dir, 'M-P-J.json'), 'utf8'));
    chk('E4 ⭐⭐⭐ BASE 的 ' + baseArr.length + ' 筆在 HEAD 裡**逐字未動**（本版只 append）',
      JSON.stringify(headArr.slice(0, baseArr.length)) === JSON.stringify(baseArr),
      JSON.stringify({ base: baseArr.length, head: headArr.length }));
    chk('E4b ⭐ 而且新增的就是那 32 張（順序＝抓回來的 id 由小到大）',
      JSON.stringify(headArr.slice(baseArr.length).map((c) => String(c.id))) === JSON.stringify(NEW_IDS),
      JSON.stringify(headArr.slice(baseArr.length).map((c) => String(c.id))));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】在 npm test chain 裡');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const chain = String(pkg.scripts?.test || '').split('&&').map((s) => s.trim()).filter(Boolean);
  chk('D1 ⭐ scripts.test 裡**恰好**有本檔一次',
    chain.filter((s) => s === 'node ' + SELF).length === 1,
    String(chain.filter((s) => s === 'node ' + SELF).length));
}

console.log(`\n=== v6.391 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
