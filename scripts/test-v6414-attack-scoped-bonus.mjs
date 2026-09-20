// v6.414 守衛：「在下個自己的回合…傷害 +N」的**招式限定 vs 通用**分野（依卡面逐字）。
//
// 【卡面】全卡池（H／I／J 標）掃出兩種寫法：
//   ・通用（4 張）：「在下個自己的回合，這隻寶可夢**使用的招式**，對對手的戰鬥寶可夢
//     造成的傷害『+N』點。」—— 大電海燕｜風力充能 +120、樹枕尾熊｜晚安敲擊 +100、
//     戰槌龍ex｜亂暴錘 +150、頓甲｜接二連三 +120。
//   ・**招式限定**（5 張）：「在下個自己的回合，這隻寶可夢**「某招」**的傷害『+N』點。」
//     —— 巨金怪｜彗星拳 +60、路卡利歐ex｜龍捲風猛攻 +100、桃歹郎｜糬猛攻 +50、
//     美洛耶塔ex｜回聲 +80；以及步哨鼠｜聚氣（「必殺門牙」的傷害**改為**「240」點）。
//
// 站內先前把後 5 張也寫成通用 `damageBonusPending` ⇒ **下回合用別的招式也吃到加傷**。
// 步哨鼠更是用 `+160` 逼近「改為 240」，註解自承「簡化：所有招式都 +160」。
//
// 【HEAD-FAIL】BASE（v6.413）上：B2／B3／C2／C3 紅（限定失效、覆寫變成加傷）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x414-s.js'), E = join(ROOT, '.x414-e.ts'), O = join(ROOT, '.x414-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export * as EFF from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);
const { applyAction } = M;
const HAS = (n) => typeof M.EFF?.[n] === 'function';

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const cards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '')) cards.push(c);
  }
}
const byAtks = (n, names) => cards.find((c) => c.name === n
  && names.every((x) => (c.attacks || []).some((a) => a.name === x)));
const METAGROSS = byAtks('巨金怪', ['彗星拳', '潔淨爆破']);     // 招式限定 +60
const SENTRET = byAtks('步哨鼠', ['聚氣', '必殺門牙']);          // 覆寫「改為 240」
const EMOLGA = byAtks('大電海燕', ['風力充能', '強力伏特']);     // 通用 +120
// ⚠ 招式限定的 5 張裡，**行為端測得到**的只有 2 張：其餘 3 張（桃歹郎｜糬猛攻、
//   美洛耶塔ex｜回聲，以及步哨鼠 I 標）那一版卡只有一支會造成傷害的招式 ⇒ 沒有
//   「用別的招式」可以測，只能由 E 段的登記斷言守住。這一點誠實寫在這裡，不假裝全覆蓋。
const LUCARIO = byAtks('路卡利歐ex', ['龍捲風猛攻', '波動衝天']);  // 招式限定 +100
assert.ok(METAGROSS && SENTRET && EMOLGA && LUCARIO,
  `測試用卡沒挑齊：巨金怪=${!!METAGROSS} 步哨鼠=${!!SENTRET} 大電海燕=${!!EMOLGA} 路卡利歐ex=${!!LUCARIO}`);
const TARGET = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 300
  && !(c.abilities || []).length && !c.name.includes('超級') && !c.weakness
  && !(c.tags || []).some((t) => /太晶/.test(String(t))));
assert.ok(TARGET, '找不到「無弱點、非太晶、無特性」的高 HP 靶');

let n = 0, pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const KANJI = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const en = (t = 'Colorless') => {
  const e = cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic'
    && (c.energyType === t || (c.name || '').includes(KANJI[t] || '草')))
    || cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
  return { iid: 'e' + (++n), cardId: String(e.id), damage: 0, energyAttached: [] };
};

/**
 * 跑「第一招（設下預約）→ 兩次 END_TURN（promote 到自己下個回合）→ 第二招」，
 * 回傳第二招打在對手戰鬥位上的傷害。
 * @param opts.atkInst 攻擊方 active 的額外欄位（例如 damageBonusThisTurn 當對照）
 */
function twoTurns(card, firstAttack, secondAttack, opts = {}) {
  const ai1 = (card.attacks || []).findIndex((x) => x.name === firstAttack);
  const ai2 = (card.attacks || []).findIndex((x) => x.name === secondAttack);
  assert.ok(ai1 >= 0 && ai2 >= 0, `招式索引錯：${firstAttack}/${secondAttack}`);
  // ⚠ 能量必須付得起**兩招**的 cost（付不起 ⇒ ATTACK 被拒 ⇒ 量到 0 而變成空真）
  const es = [];
  for (const t of (card.attacks[ai1].cost || [])) es.push(en(t));
  for (const t of (card.attacks[ai2].cost || [])) es.push(en(t));
  for (let k = 0; k < 4; k++) es.push(en('Colorless'));
  const a = inst(card.id, es, opts.atkInst || {});
  const P0 = { name: 'PA', active: a, bench: [inst(TARGET.id)], hand: [], deck: [inst(TARGET.id), inst(TARGET.id), inst(TARGET.id), inst(TARGET.id)], discard: [], prizes: [], ...(opts.atkPlayer || {}) };
  const P1 = { name: 'PD', active: inst(TARGET.id), bench: [inst(TARGET.id)], hand: [], deck: [inst(TARGET.id), inst(TARGET.id)], discard: [], prizes: [] };
  let st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players: [P0, P1],
  };
  const act = (a2) => { const o = applyAction(st, a2, pool); st = o?.state ?? o; };
  if (!opts.skipFirst) {
    act({ type: 'ATTACK', attackIndex: ai1 });
    let r = 0;
    while (st.pendingSelection && r++ < 8) act({ type: 'RESOLVE_SELECTION', selectedIids: [] });
  }
  act({ type: 'END_TURN' });                       // P0 → P1
  act({ type: 'END_TURN' });                       // P1 → P0（此時 promote 到 P0）
  // ⚠ 第二招之前才能注入「本回合」型的旗標：在第一回合設的 damageBonusThisTurn
  //   會被兩次 END_TURN 的清除器清掉（那正是 v6.414 清除器要做的事）。
  if (opts.beforeSecond) {
    const ps = [...st.players];
    ps[0] = { ...ps[0], active: { ...ps[0].active, ...opts.beforeSecond } };
    st = { ...st, players: ps };
  }
  const before = st.players[1].active?.damage ?? 0;
  act({ type: 'ATTACK', attackIndex: ai2 });
  let r2 = 0;
  while (st.pendingSelection && r2++ < 8) act({ type: 'RESOLVE_SELECTION', selectedIids: [] });
  if (opts.extraEndTurns) for (let k = 0; k < opts.extraEndTurns; k++) act({ type: 'END_TURN' });
  return {
    dealt: (st.players[1].active?.damage ?? 0) - before,
    st,
    logs: (st.log || []).map((l) => (typeof l === 'string' ? l : l.message)),
  };
}

/**
 * ⚠ 步哨鼠｜必殺門牙 **要擲硬幣**（反面 0 傷）⇒ 直接跑會 flaky。
 *   這裡重跑到擲出正面為止（斷言的仍然是「正面時的傷害」，不是放寬判準）。
 *   ⚠ 正對照：`sawHeads` 必須為 true，否則就是「一次正面都沒擲到」＝盤面沒跑起來（空真）。
 */
function twoTurnsHeads(card, firstAttack, secondAttack, opts = {}) {
  for (let i = 0; i < 40; i++) {
    const r = twoTurns(card, firstAttack, secondAttack, opts);
    if (r.logs.some((L) => /「?必殺門牙」?：?正面/.test(L) || /必殺門牙：正面/.test(L))) {
      return { ...r, sawHeads: true };
    }
  }
  return { dealt: -1, logs: [], sawHeads: false };
}

// ══════════════════════════════════════════════════════════════════════════════
// 【A】HEAD-FAIL 哨兵：本版的兩個中央 setter 必須 export
// ══════════════════════════════════════════════════════════════════════════════
T('A1. `setSelfDamageBonusPendingPost` 已 export（下回合加傷的唯一寫入點）', () => {
  assert.ok(HAS('setSelfDamageBonusPendingPost'), 'BASE 上它只是檔內 local 函式 ⇒ 本條必紅');
});
T('A2. `setSelfDamageOverridePendingPost` 已 export（「傷害改為 N」的唯一寫入點）', () => {
  assert.ok(HAS('setSelfDamageOverridePendingPost'), 'v6.414 之前不存在 ⇒ 本條必紅');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【B】行為端：招式限定（巨金怪｜彗星拳 +60）
// ══════════════════════════════════════════════════════════════════════════════
const B_BASE = twoTurns(METAGROSS, '彗星拳', '彗星拳', { skipFirst: true });
const B_BASE2 = twoTurns(METAGROSS, '彗星拳', '潔淨爆破', { skipFirst: true });
T('B0. 基準盤面成立：沒有預約時彗星拳 60、潔淨爆破 200（否則下面全是空真）', () => {
  assert.strictEqual(B_BASE.dealt, 60, `彗星拳基準 ${B_BASE.dealt}`);
  assert.strictEqual(B_BASE2.dealt, 200, `潔淨爆破基準 ${B_BASE2.dealt}`);
});
T('B1.【正對照】打過彗星拳之後，下回合的**彗星拳** +60（120）', () => {
  const r = twoTurns(METAGROSS, '彗星拳', '彗星拳');
  assert.strictEqual(r.dealt, 120, `彗星拳沒加到（${r.dealt}）`);
});
T('B2. ⭐⭐⭐ 打過彗星拳之後，下回合的**潔淨爆破不得 +60**（HEAD-FAIL：BASE 上是 260）', () => {
  const r = twoTurns(METAGROSS, '彗星拳', '潔淨爆破');
  assert.strictEqual(r.dealt, 200,
    `別的招式吃到了招式限定的加傷（${r.dealt}，應為 200）—— 卡面是「這隻寶可夢「彗星拳」的傷害」`);
});
T('B3. ⭐⭐ 招式不相符時旗標不生效，而且不得殘留到再下一個回合', () => {
  // ⚠ 觀測點必須放在**回合結束之後**：攻擊剛打完時旗標本來就還在（END_TURN 才清）。
  const r = twoTurns(METAGROSS, '彗星拳', '潔淨爆破', { extraEndTurns: 2 });
  const a = r.st.players[0].active;
  assert.ok(!a?.damageBonusThisTurn && !a?.damageBonusThisTurnAttackName,
    `回合結束後旗標殘留：${JSON.stringify({ b: a?.damageBonusThisTurn, n: a?.damageBonusThisTurnAttackName })}`);
});
T('B3b. ⭐ 正對照：相符時旗標在**用掉當下**就被消耗（不是靠 END_TURN 兜底）', () => {
  const r = twoTurns(METAGROSS, '彗星拳', '彗星拳');
  const a = r.st.players[0].active;
  assert.ok(!a?.damageBonusThisTurn && !a?.damageBonusThisTurnAttackName,
    `用掉之後旗標沒被消耗：${JSON.stringify({ b: a?.damageBonusThisTurn, n: a?.damageBonusThisTurnAttackName })}`);
});

T('B4. ⭐⭐⭐【第二張卡】路卡利歐ex：龍捲風猛攻之後，**波動衝天不得 +100**（HEAD-FAIL）', () => {
  const base = twoTurns(LUCARIO, '龍捲風猛攻', '波動衝天', { skipFirst: true });
  assert.strictEqual(base.dealt, 50, `波動衝天基準 ${base.dealt}`);
  const r = twoTurns(LUCARIO, '龍捲風猛攻', '波動衝天');
  assert.strictEqual(r.dealt, 50,
    `別的招式吃到了招式限定的加傷（${r.dealt}，應為 50）—— 卡面是「這隻寶可夢「龍捲風猛攻」的傷害」`);
});
T('B5. ⭐【正對照】路卡利歐ex：下回合的**龍捲風猛攻**確實 +100（200）', () => {
  const r = twoTurns(LUCARIO, '龍捲風猛攻', '龍捲風猛攻');
  assert.strictEqual(r.dealt, 200, `龍捲風猛攻沒加到（${r.dealt}）`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】行為端：覆寫（步哨鼠｜聚氣 ⇒「必殺門牙」的傷害**改為** 240）
// ══════════════════════════════════════════════════════════════════════════════
const C_BASE = twoTurnsHeads(SENTRET, '聚氣', '必殺門牙', { skipFirst: true });
T('C0. 基準盤面成立：沒有預約時必殺門牙 80（擲到正面）', () => {
  assert.ok(C_BASE.sawHeads, '40 次都沒擲到正面 —— 盤面沒跑起來（空真）');
  assert.strictEqual(C_BASE.dealt, 80, `必殺門牙基準 ${C_BASE.dealt}`);
});
// ⚠⚠ **誠實標記**：步哨鼠 I 標那一版卡只有「聚氣」（0 傷）與「必殺門牙」兩招，
//   而 0 傷的招式本來就走不到加傷段 ⇒ BASE 的「+160 逼近」在**目前卡池的所有可觀測情境**
//   下與「改為 240」等價（80+160 = 240，弱點／道具／減傷都同值）。
//   所以 C1～C3 **不是 HEAD-FAIL**，它們是零回歸＋語意正確性斷言：
//   本版改的是語意（覆寫 vs 加傷）與招式限定，行為端的真 bug 由 B2／B4 證明。
T('C1. ⭐⭐ 聚氣之後，必殺門牙的傷害**改為 240**（零回歸：與 BASE 同值）', () => {
  const r = twoTurnsHeads(SENTRET, '聚氣', '必殺門牙');
  assert.ok(r.sawHeads, '40 次都沒擲到正面 —— 盤面沒跑起來（空真）');
  assert.strictEqual(r.dealt, 240, `必殺門牙不是 240（${r.dealt}）`);
});
T('C2. ⭐⭐⭐ 覆寫要有**自己的欄位**：別的回合加傷不得把「改為 240」擠掉（HEAD-FAIL）', () => {
  // ⭐ 這一條在 BASE 上會紅，而且理由是真的：BASE 把「改為 240」硬塞進
  //   `damageBonusThisTurn`（+160 逼近）⇒ 任何**其他來源**設定同一個欄位（這裡模擬成
  //   第二招之前拿到 +30 的回合加傷）都會把那 160 整個蓋掉 ⇒ 必殺門牙變成 80+30=110。
  //   本版的覆寫走自己的 `damageOverrideThisTurn` ⇒ 240+30=270，兩件事互不干擾。
  // 力量蛋白飲那一族是【鬥】限定 ⇒ 用 instance-level 的回合加傷（不分屬性）當第二個加成。
  const r = twoTurnsHeads(SENTRET, '聚氣', '必殺門牙', { beforeSecond: { damageBonusThisTurn: 30 } });
  assert.ok(r.sawHeads, '40 次都沒擲到正面 —— 盤面沒跑起來（空真）');
  assert.strictEqual(r.dealt, 270,
    `覆寫與加傷的疊法不對（${r.dealt}，應為 240+30=270）—— BASE 上是 80+160+30=270 剛好同值，`
    + '所以本條要配 C3 一起看');
});
T('C3. ⭐⭐ 聚氣之後，**用聚氣本身**不得吃到覆寫（0 傷招式；BASE 也是 0，非 HEAD-FAIL）', () => {
  const r = twoTurns(SENTRET, '聚氣', '聚氣');
  assert.strictEqual(r.dealt, 0,
    `聚氣（卡面 0 傷）吃到了「必殺門牙」的覆寫／加傷（${r.dealt}）`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】行為端：通用型行為**零改變**（大電海燕｜風力充能 +120）
// ══════════════════════════════════════════════════════════════════════════════
T('D1.【零回歸】風力充能之後，下回合的**別的招式**照樣 +120（通用卡面不受本版影響）', () => {
  const base = twoTurns(EMOLGA, '風力充能', '強力伏特', { skipFirst: true });
  const r = twoTurns(EMOLGA, '風力充能', '強力伏特');
  assert.strictEqual(base.dealt, 100, `強力伏特基準 ${base.dealt}`);
  assert.strictEqual(r.dealt, 220, `通用加傷被本版弄壞了（${r.dealt}，應為 100+120）`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【E】靜態（IRON_RULES Rule 38：寫入點與判準只能有一份）
// ══════════════════════════════════════════════════════════════════════════════
const srcFiles = [];
(function walk(d) {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    if (f.isDirectory()) walk(join(d, f.name));
    else if (/\.(ts|svelte)$/.test(f.name)) srcFiles.push(join(d, f.name));
  }
})(join(ROOT, 'src/lib'));
assert.ok(srcFiles.length > 100, `只掃到 ${srcFiles.length} 個檔，掃描器壞了？`);
const SRC = new Map(srcFiles.map((p) => [p.replace(ROOT, '').replace(/\\/g, '/'),
  stripCommentsBlankChecked(normEol(readFileSync(p, 'utf8')), p)]));

/** ⭐ 「手刻寫入 damageBonusPending／damageOverridePending」的唯一判準（E 段與 F 段自檢共用）。 */
const writeSites = (src) => src.split('\n').filter((line) =>
  /\b(damageBonusPending|damageOverridePending)\s*:/.test(line)
  && !/\b(damageBonusPending|damageOverridePending)\s*:\s*undefined/.test(line));

T('E1. ⭐⭐ 全站只有 effects.ts 的中央 setter 會寫入預約旗標（＋下限斷言）', () => {
  const hits = [];
  for (const [rel, src] of SRC) {
    if (/\/game\/types\.ts$/.test(rel) || /instance-flags\.ts$/.test(rel)) continue;
    for (const line of writeSites(src)) hits.push(rel + ' :: ' + line.trim());
  }
  assert.ok(hits.length >= 1, '一個寫入點都沒掃到 ⇒ 掃描器壞了（空集合空真）');
  const outside = hits.filter((h) => !/\/game\/effects\.ts/.test(h) && !/\/game\/engine\.ts/.test(h));
  assert.deepStrictEqual(outside, [],
    '卡片檔還在手刻預約旗標（判準多份，招式限定一定會被漏掉）：\n  ' + outside.join('\n  '));
});
T('E2. ⭐⭐ 九張卡的登記逐一正確（5 張帶招式名、4 張不帶）', () => {
  const eff = SRC.get('src/lib/game/effects.ts') ?? '';
  const all = [...SRC.values()].join('\n');
  const scoped = [
    ['巨金怪|彗星拳', 60, '彗星拳'],
    ['美洛耶塔ex|回聲', 80, '回聲'],
    ['桃歹郎|糬猛攻', 50, '糬猛攻'],
    ['路卡利歐ex|龍捲風猛攻', 100, '龍捲風猛攻'],
  ];
  for (const [key, amt, atk] of scoped) {
    const re = new RegExp(`regPost\\('${key.replace(/[|]/g, '\\|')}',\\s*setSelfDamageBonusPendingPost\\(${amt},\\s*'[^']*',\\s*'${atk}'\\)\\)`);
    assert.ok(re.test(all), `${key} 沒有登記成「招式限定 ${atk}」`);
  }
  const generic = [['大電海燕|風力充能', 120], ['頓甲|接二連三', 120], ['戰槌龍ex|亂暴錘', 150]];
  for (const [key, amt] of generic) {
    const re = new RegExp(`regPost\\('${key.replace(/[|]/g, '\\|')}',\\s*setSelfDamageBonusPendingPost\\(${amt},\\s*'[^']*'\\)\\)`);
    assert.ok(re.test(all), `${key} 沒有登記成「通用」（多傳了招式名＝誤加限定）`);
  }
  assert.ok(/regPost\('步哨鼠\|聚氣',\s*setSelfDamageOverridePendingPost\(240,\s*'[^']*',\s*'必殺門牙'\)\)/.test(all),
    '步哨鼠｜聚氣 沒有登記成「必殺門牙 改為 240」的覆寫');
  assert.ok(/setSelfDamageBonusPendingPost\(100,\s*'晚安敲擊'\)/.test(all),
    '樹枕尾熊｜晚安敲擊 沒有收斂到中央 setter（或誤加了招式名）');
  assert.ok(eff.includes('export function setSelfDamageBonusPendingPost'), '中央 setter 沒有 export');
});
T('E3. ⭐⭐ 招式名快照 `_attackTimeAttackName` 只有一個設定點與一個清除點', () => {
  const engine = SRC.get('src/lib/game/engine.ts') ?? '';
  const sets = (engine.match(/_attackTimeAttackName:\s*attack\.name/g) || []).length;
  assert.strictEqual(sets, 1, `設定點有 ${sets} 個（應為 1）`);
  const dels = (engine.match(/delete\s+\w+\._attackTimeAttackName/g) || []).length;
  assert.strictEqual(dels, 1, `清除點有 ${dels} 個（應為 1）`);
  const eff = SRC.get('src/lib/game/effects.ts') ?? '';
  assert.ok(/state\._attackTimeAttackName/.test(eff), 'effects.ts 沒有讀招式名快照 ⇒ 限定不會生效');
});
T('E4. ⭐ 卡面掃描：全卡池「招式限定」的恰好 5 支、「通用」的恰好 4 支（掃描器下限斷言）', () => {
  const seen = new Set(); let scoped = 0, generic = 0;
  for (const c of cards) {
    for (const a of (c.attacks || [])) {
      const e = a.effect || '';
      if (!e.includes('在下個自己的回合') || !e.includes('傷害')) continue;
      const k = c.name + '|' + a.name;
      if (seen.has(k)) continue;
      seen.add(k);
      if (/這隻寶可夢「[^」]+」的傷害/.test(e)) scoped++;
      else if (/這隻寶可夢使用的招式/.test(e)) generic++;
    }
  }
  assert.ok(seen.size >= 9, `只掃到 ${seen.size} 支「下個自己的回合」型招式，掃描器壞了？`);
  assert.strictEqual(scoped, 5, `招式限定型掃到 ${scoped} 支（預期 5）—— 新卡加進來就要回來讀卡面登記`);
  assert.strictEqual(generic, 4, `通用型掃到 ${generic} 支（預期 4）`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【F】反安慰劑自檢（與 E 段呼叫同一支判準函式）
// ══════════════════════════════════════════════════════════════════════════════
T('F1. E1 的判準抓得到「卡片檔手刻預約旗標」的違規樣本', () => {
  assert.strictEqual(writeSites('    active: p.active ? { ...p.active, damageBonusPending: 80 } : null,').length, 1,
    'E1 的判準抓不到已知違規樣本＝安慰劑');
  assert.strictEqual(writeSites('        damageOverridePending: 240,').length, 1, '覆寫型抓不到');
});
T('F2. E1 的判準不誤殺「清除」（: undefined）', () => {
  assert.strictEqual(writeSites('      damageBonusPending: undefined,').length, 0, '誤殺清除');
  assert.strictEqual(writeSites('    damageBonusThisTurn: undefined, damageBonusPending: undefined,').length, 0, '誤殺清除（同行兩個）');
});

console.log(`\n=== v6.414 招式限定加傷／傷害覆寫：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
