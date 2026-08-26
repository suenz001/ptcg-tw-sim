#!/usr/bin/env node
/**
 * v6.238 守衛 —— 兩件事：
 *
 * 【A】「先造成傷害／先開選擇視窗，最後才結算傷害」的招式要看得到預估。
 *   站長回報：超級路卡利歐ex 只有第二招（超級勇氣）顯示預估，第一招（波動突刺）完全沒有。
 *   真因不是 UI：`波動突刺` 走的是站內「regPre 傷害設 0 → 效果／picker → 最後才
 *   `dealAttackDamageToTarget`」的延後範本，而那條路徑**從來不寫 `lastDealtDamage`**，
 *   預估只讀那一欄 ⇒ 讀到 0 ⇒ 判成「純效果、不造成傷害」⇒ 一個字都不顯示。
 *   ⇒ ① 中央傷害 helper 記下 `attackDamageToDefActive`；② 預估把選擇視窗跑到底。
 *
 * 【B】桌機招式鈕旁的「放大鏡」（平板／觸控模擬不出 hover）。
 *   最重要的一條：**點放大鏡絕對不可以使出招式**。
 *
 * 不變量（每一條都附突變測試或正對照，IRON_RULES Rule 25/33）：
 *   A1 超級路卡利歐ex 兩招都有可顯示的預估，且 index 0 的數值 === 真的打下去的實際傷害
 *   A2 同型卡（造成傷害＋開 picker）至少 4 張，值都 === 實際傷害
 *   A3 全卡池行為掃描：對手戰鬥位實際掉血 > 0 的招式，預估一律不得回 'none'
 *   A4 負對照：純效果招式仍然是 'none'；「放置傷害指示物」依官方判準不算傷害
 *   A5 突變測試：把修正回退（只讀 lastDealtDamage / 不跑選擇視窗）⇒ A1 必須紅
 *   B1 放大鏡是招式鈕的**兄弟節點**（結構上不可能冒泡到招式鈕）、type="button"、handler 有 stopPropagation
 *   B2 handler 原始碼**實跑**：只切換自己的開合狀態，不碰任何攻擊路徑
 *   B3 觸控目標 ≥ 44×44（可視 34 + ::after 外擴 5，逐值算出來，不是比字串）
 *   B4 三種桌機版面：svelte 編譯器的 unused CSS 警告集合必須與基準完全相同
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'cc06ae2084754322a04e0811c6cfe7298851f45f';   // v6.237

let n = 0, bad = 0;
const chk = (label, cond, extra = '') => {
  n++; console.log((cond ? '  PASS ' : '  FAIL ') + label + (cond ? '' : ' ' + extra));
  if (!cond) bad++;
};

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// ── 把 damage-estimate + engine + effects 打成一包（可指定「動過手腳」的原始碼）────
const TMP = mkdtempSync(join(tmpdir(), 'v6238-'));
let _seq = 0;
async function bundle(overrides = {}) {
  const id = 'b' + (_seq++);
  const stub = join(ROOT, `.v6238-${id}-s.js`);
  const entry = join(ROOT, `.v6238-${id}-e.ts`);
  const out = join(TMP, `${id}.mjs`);
  writeFileSync(stub, 'export const base="";');
  const alias = { '$lib': join(ROOT, 'src/lib'), '$app/paths': stub };
  const plugins = [];
  if (Object.keys(overrides).length > 0) {
    // 用 esbuild plugin 把指定檔案換成「動過手腳」的內容（不碰工作樹的檔案）
    plugins.push({
      name: 'v6238-override',
      setup(b) {
        b.onLoad({ filter: /\.ts$/ }, (args) => {
          for (const [rel, content] of Object.entries(overrides)) {
            if (args.path.replace(/\\/g, '/').endsWith(rel)) return { contents: content, loader: 'ts' };
          }
          return null;
        });
      },
    });
  }
  writeFileSync(entry,
    "export * from './src/lib/game/damage-estimate';\n" +
    "export { applyAction, getEffectiveAttacks } from './src/lib/game/engine';\n" +
    "import './src/lib/game/effects';");
  await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'node',
    target: 'node20', alias, plugins, logLevel: 'error' });
  const mod = await import(pathToFileURL(out).href + '?t=' + id);
  try { unlinkSync(stub); unlinkSync(entry); } catch { /* 清乾淨即可 */ }
  return mod;
}

// ── fixture ────────────────────────────────────────────────────────────────
const inst = (cardId, iid, ex = {}) =>
  ({ iid, cardId: String(cardId), damage: 0, energyAttached: [], evolvedFromStack: [], ...ex });
const ENERGY = {};
for (const c of pool.values()) {
  if (c.supertype === 'Energy' && c.subtype === 'Basic') {
    const m = /基本【(.)】能量/.exec(c.name || ''); if (m) ENERGY[m[1]] = c;
  }
}
const T2C = { Grass:'草', Fire:'火', Water:'水', Lightning:'雷', Psychic:'超',
              Fighting:'鬥', Darkness:'惡', Metal:'鋼', Colorless:'草', Dragon:'草' };
const findCard = (name) => [...pool.values()].find(x => x.name === name) ?? null;
const findAtk = (name, atkName) => {
  const c = [...pool.values()].find(x => x.name === name && (x.attacks || []).some(a => a.name === atkName));
  if (!c) return null;
  return { card: c, idx: (c.attacks || []).findIndex(a => a.name === atkName) };
};
const NEUTRAL = [...pool.values()].find(x =>
  String(x.supertype || '').startsWith('Pok') && ['H','I','J'].includes(x.regulationMark) &&
  (x.stage ?? x.subtype) === 'Basic' && !x.abilities?.length && !x.weakness && !x.resistance && x.hp >= 200);
const DECK_IDS = [...pool.values()]
  .filter(c => String(c.supertype || '').startsWith('Pok') && ['H','I','J'].includes(c.regulationMark))
  .slice(0, 8).map(c => c.id);

function payFor(cost, pkType) {
  const out = []; let k = 0;
  for (const c of (cost || [])) {
    const t = (c === 'Colorless') ? (T2C[pkType] || '草') : (T2C[c] || c);
    const e = ENERGY[t]; if (e) out.push(inst(e.id, 'e' + (k++)));
  }
  for (let i = 0; i < 4; i++) out.push(inst((ENERGY[T2C[pkType] || '草'] || ENERGY['草']).id, 'ex' + (k++)));
  return out;
}
function mkState(att, def, en) {
  // ⚠ 棄牌區刻意放各屬性基本能量：波動突刺這一族要「棄牌區有基本【鬥】能量」才會開 picker，
  //   沒有的話走的是另一條分支 —— 兩條都要測得到（見 A1 的兩組盤面）。
  const discard = [inst(att.id, 'g1'), inst(ENERGY['鬥'].id, 'gd0'), inst(ENERGY['草'].id, 'gd1'),
                   inst(ENERGY['火'].id, 'gd2'), inst(ENERGY['水'].id, 'gd3')];
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(att.id, 'a1', { energyAttached: en }),
        bench: [inst(att.id, 'b1'), inst(NEUTRAL.id, 'b2')],
        hand: [inst(att.id, 'h1'), inst(ENERGY['草'].id, 'h2')],
        deck: DECK_IDS.map((id, i) => inst(id, 'd' + i)), discard,
        prizes: [inst(att.id, 'pz1'), inst(att.id, 'pz2')], energyAttachedThisTurn: false },
      { name: 'P2', active: inst(def.id, 'oa1'), bench: [inst(def.id, 'ob1')],
        hand: [inst(def.id, 'oh1'), inst(def.id, 'oh2')],
        deck: DECK_IDS.map((id, i) => inst(id, 'od' + i)), discard: [inst(def.id, 'og1')],
        prizes: [inst(def.id, 'opz1'), inst(def.id, 'opz2')], energyAttachedThisTurn: false },
    ],
  };
}
function setup(attName, atkName, defName) {
  const f = findAtk(attName, atkName); const d = defName ? findCard(defName) : NEUTRAL;
  if (!f || !d) return null;
  return { ...f, def: d, state: mkState(f.card, d, payFor(f.card.attacks[f.idx].cost, f.card.pokemonType)) };
}

/**
 * ⭐ 「真的打下去」：跑真實 ATTACK，並用**玩家做得到的合法答覆**把選擇視窗一路回答完，
 *    再從對手戰鬥寶可夢的傷害指示物量出實際傷害。
 *    ⚠ 刻意不讀 `attackDamageToDefActive`（那正是被測物）—— 量的是盤面上真的掉了多少血。
 */
function realDamage(mod, st, i, mode /* 'min' | 'max' */) {
  const before = st.players[1].active?.damage ?? 0;
  let s = structuredClone(st);
  let out = mod.applyAction(s, { type: 'ATTACK', attackIndex: i }, pool);
  for (let step = 0; step < 6 && out.pendingSelection; step++) {
    const p = out.pendingSelection;
    const src = out.players[p.sourcePlayerIdx ?? p.actorIdx];
    const vi = Array.isArray(p.params?.validIids) ? p.params.validIids : null;
    const zone = p.type === 'deck-search' ? src.deck
      : p.type === 'discard-search' ? src.discard
      : (p.type === 'hand-discard' || p.type === 'hand-choose') ? src.hand
      : (p.type === 'energy-distribute' || p.type === 'damage-distribute' || p.type === 'bench-choose') ? src.bench
      : [];
    let cands = vi ?? zone.map(c => c.iid);
    const min = Math.max(0, p.minCount ?? 0);
    const max = Math.max(min, p.maxCount ?? min);
    const want = mode === 'max' ? Math.min(max, Math.max(min, cands.length)) : min;
    const ans = cands.slice(0, want);
    while (ans.length < want && cands.length > 0) ans.push(cands[ans.length % cands.length]);
    const nx = mod.applyAction(out,
      { type: 'RESOLVE_SELECTION', selectedIids: ans, senderIdx: p.actorIdx, pendingToken: p.token }, pool);
    if (nx.pendingSelection && nx.pendingSelection.token === p.token) break;
    out = nx;
  }
  const a = out.players[1].active;
  return { koed: !a, dmg: a ? a.damage - before : null, pending: !!out.pendingSelection };
}

// ══════════════════════════════════════════════════════════════════════════
const mod = await bundle();

console.log('⓪ 前提：fixture 素材齊備（Rule 25：樣本自身先驗）');
chk('卡池載入（> 4000 張）', pool.size > 4000, String(pool.size));
chk('八種基本能量都找得到', Object.keys(ENERGY).length === 8);
chk('中性防守方存在：' + (NEUTRAL?.name ?? '—'), !!NEUTRAL);
chk('超級路卡利歐ex / 超級袋獸ex 都在卡池裡', !!findCard('超級路卡利歐ex') && !!findCard('超級袋獸ex'));

// ══════════════════════════════════════════════════════════════════════════
console.log('\n① ⭐⭐⭐ 站長回報的那一組：超級路卡利歐ex vs 超級袋獸ex，**兩招都要有預估**');
const LU = setup('超級路卡利歐ex', '波動突刺', '超級袋獸ex');
chk('找得到 超級路卡利歐ex｜波動突刺', !!LU);
if (LU) {
  const eff = mod.getEffectiveAttacks(LU.state, LU.state.players[0].active, pool);
  chk('這隻有兩招', eff.length === 2, String(eff.length));
  const e0 = mod.estimateAttackDamage(LU.state, 0, pool, 0);
  const e1 = mod.estimateAttackDamage(LU.state, 1, pool, 0);
  chk('index 0（波動突刺）有可顯示的預估：' + JSON.stringify(e0), mod.hasEstimateToShow(e0));
  chk('index 1（超級勇氣）有可顯示的預估：' + JSON.stringify(e1), mod.hasEstimateToShow(e1));
  chk('index 0 的文案不是空字串：「' + mod.estimateShortText(e0) + '」', mod.estimateShortText(e0).length > 0);
  chk('index 0 給的是**數字**（exact），不是「依選擇而定」', e0.kind === 'exact', e0.kind);
  const rMin = realDamage(mod, LU.state, 0, 'min');
  const rMax = realDamage(mod, LU.state, 0, 'max');
  chk('⭐ index 0 的預估值 === 真的打下去的實際傷害（不選任何能量）：'
      + `預估 ${e0.value} / 實際 ${rMin.dmg}`, e0.kind === 'exact' && e0.value === rMin.dmg);
  chk('⭐ index 0 的預估值 === 真的打下去的實際傷害（能選的都選）：'
      + `預估 ${e0.value} / 實際 ${rMax.dmg}`, e0.kind === 'exact' && e0.value === rMax.dmg);
  chk('  └ 那個數字就是「130 基礎 ×2 弱點」= 260', rMin.dmg === 260, String(rMin.dmg));
  // 另一組盤面：棄牌區沒有基本【鬥】能量 ⇒ 不開 picker，直接由中央 helper 造傷害
  const st2 = structuredClone(LU.state);
  st2.players[0].discard = st2.players[0].discard.filter(c => (pool.get(c.cardId)?.name ?? '') !== '基本【鬥】能量');
  const e0b = mod.estimateAttackDamage(st2, 0, pool, 0);
  const r2 = realDamage(mod, st2, 0, 'min');
  chk('棄牌區沒有【鬥】能量（不開 picker）也要顯示：' + JSON.stringify(e0b),
      e0b.kind === 'exact' && e0b.value === r2.dmg);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n② ⭐⭐ 同型卡：造成傷害＋開選擇視窗（傷害延到 resolver 才結算）');
//   這一族全部走「regPre damage:0 → picker → dealAttackDamageToTarget」
const DEFERRED = [
  ['甲賀忍蛙ex', '忍之利刃'],
  ['烈箭鷹ex',   '鉤爪搜尋'],
  ['貓頭夜鷹',   '鉤爪搜尋'],
  ['詛咒娃娃',   '玩偶捕捉'],
];
let deferredOk = 0;
for (const [cn, an] of DEFERRED) {
  const s = setup(cn, an, null);
  if (!s) { chk(`找得到 ${cn}｜${an}`, false); continue; }
  const e = mod.estimateAttackDamage(s.state, s.idx, pool, 0);
  const r = realDamage(mod, s.state, s.idx, 'min');
  const good = mod.hasEstimateToShow(e) && e.kind === 'exact' && e.value === r.dmg;
  chk(`${cn}｜${an}：預估 ${e.kind === 'exact' ? e.value : e.kind} === 實際 ${r.dmg}`, good);
  if (good) deferredOk++;
}
chk('⭐ 同型卡至少 4 張都通過（站長要求 ≥3）', deferredOk >= 4, String(deferredOk));

console.log('\n③ ⭐⭐ 同型卡：延後造成傷害但**不開**選擇視窗');
const DEFERRED_NOPICK = [
  ['克雷色利亞',   '弦月光芒'],
  ['櫻花魚',       '漸強波'],
  ['火箭隊的阿柏怪', '旋轉之尾'],
];
for (const [cn, an] of DEFERRED_NOPICK) {
  const s = setup(cn, an, null);
  if (!s) { chk(`找得到 ${cn}｜${an}`, false); continue; }
  const e = mod.estimateAttackDamage(s.state, s.idx, pool, 0);
  const r = realDamage(mod, s.state, s.idx, 'min');
  chk(`${cn}｜${an}：預估 ${e.kind === 'exact' ? e.value : e.kind} === 實際 ${r.dmg}`,
      e.kind === 'exact' && e.value === r.dmg);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ ⭐⭐⭐ 全卡池行為掃描：對手戰鬥位真的掉血 ⇒ 預估不得回 none');
{
  const seen = new Set();
  const cards = [...pool.values()].filter(c =>
    String(c.supertype || '').startsWith('Pok') && ['H','I','J'].includes(c.regulationMark) && (c.attacks || []).length);
  let scanned = 0; const misses = [];
  for (const c of cards) {
    for (let i = 0; i < c.attacks.length; i++) {
      const a = c.attacks[i]; const key = c.name + '|' + a.name;
      if (seen.has(key)) continue; seen.add(key);
      let st; try { st = mkState(c, NEUTRAL, payFor(a.cost, c.pokemonType)); } catch { continue; }
      let r; try { r = realDamage(mod, st, i, 'min'); } catch { continue; }
      scanned++;
      if (r.koed || !(r.dmg > 0)) continue;
      // ⚠ 官方判準：「放置傷害指示物」是招式**效果**、不是傷害 ⇒ 預估本來就不該報它。
      //   靠 log 逐字認（引擎自己寫的字），不靠卡面 regex。
      const e = mod.estimateAttackDamage(st, i, pool, 0);
      if (e.kind === 'none' || e.kind === 'unknown') misses.push(`${key}(實際${r.dmg}/${e.kind})`);
    }
  }
  chk('掃描器有掃到東西（下限斷言，Rule 25）', scanned > 1500, String(scanned));
  // 只有「放置傷害指示物」型允許落在 none —— 逐張列舉（新卡進來會紅，要回來看是不是又漏了一族）
  const ALLOW_COUNTER_PLACEMENT = new Set([
    '胡地|手之力量', '鬼斯通|纏擾', '斯魔茶|無聲加害', '由克希|痛楚記憶',
    '恰雷姆ex|氣功指壓', '蜈蚣王|偏道一回',
  ]);
  const real = misses.filter(m => !ALLOW_COUNTER_PLACEMENT.has(m.split('(')[0]));
  chk('⭐ 沒有「實際掉血卻不顯示預估」的招式（放置指示物型除外）', real.length === 0, JSON.stringify(real));
  chk('  └ 放置傷害指示物型仍然不報數字（官方：那是效果不是傷害）',
      misses.length === ALLOW_COUNTER_PLACEMENT.size, JSON.stringify(misses));
}

console.log('\n⑤ 負對照：純效果招式不可以憑空冒出數字');
{
  const s = setup('洗翠 卡蒂狗', '全部燒光', null);   // 卡面無傷害，只丟競技場
  if (s) {
    const e = mod.estimateAttackDamage(s.state, s.idx, pool, 0);
    chk('洗翠 卡蒂狗｜全部燒光（純效果）仍然不顯示', !mod.hasEstimateToShow(e), JSON.stringify(e));
  } else chk('找得到 洗翠 卡蒂狗｜全部燒光', false);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ ⭐⭐ 突變測試：把 v6.238 的兩個修正各自回退 ⇒ ① 必須紅');
{
  const estSrc = readFileSync(join(ROOT, 'src/lib/game/damage-estimate.ts'), 'utf8');
  const s = LU;
  // 突變 1：只讀 lastDealtDamage（＝回到 v6.237 的讀法）
  const m1 = estSrc.replace(
    /function readDealt\(s: GameState\): number \{[\s\S]*?\n\}/,
    'function readDealt(s: GameState): number {\n  return s.lastDealtDamage ?? 0;\n}');
  chk('突變 1 真的改到東西', m1 !== estSrc);
  const mod1 = await bundle({ 'lib/game/damage-estimate.ts': m1 });
  const e1 = s ? mod1.estimateAttackDamage(s.state, 0, pool, 0) : null;
  chk('⭐ 突變 1（只讀 lastDealtDamage）⇒ 波動突刺 顯示不出數字', !(e1 && e1.kind === 'exact'), JSON.stringify(e1));

  // 突變 2：不把選擇視窗跑到底
  const m2 = estSrc.replace(/if \(cNone && cAll && cAlt[\s\S]*?out = cNone;/, '/* 突變：不採用 */');
  chk('突變 2 真的改到東西', m2 !== estSrc);
  const mod2 = await bundle({ 'lib/game/damage-estimate.ts': m2 });
  const e2 = s ? mod2.estimateAttackDamage(s.state, 0, pool, 0) : null;
  chk('⭐ 突變 2（不跑選擇視窗）⇒ 波動突刺 只剩「依選擇而定」',
      !!e2 && e2.kind === 'depends', JSON.stringify(e2));
  // 突變 2 之下，「不開 picker」那一組仍應顯示（證明兩個修正各自獨立、不是同一件事）
  if (s) {
    const st2 = structuredClone(s.state);
    st2.players[0].discard = st2.players[0].discard.filter(c => (pool.get(c.cardId)?.name ?? '') !== '基本【鬥】能量');
    const e2b = mod2.estimateAttackDamage(st2, 0, pool, 0);
    chk('  └ 正對照：突變 2 之下「不開 picker」那一組仍然顯示得出來', e2b.kind === 'exact', JSON.stringify(e2b));
  }
}

console.log('\n⑦ HEAD-FAIL：同一組斷言在 BASE（v6.237）上必須是紅的');
{
  let baseEst = null;
  try {
    baseEst = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE_SHA + ':src/lib/game/damage-estimate.ts'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { baseEst = null; }
  if (!baseEst) {
    // ⚠ CI 的 checkout 是 fetch-depth:1 淺複製，取不到歷史 blob ⇒ SKIP（突變測試 ⑥ 已涵蓋同一件事）
    console.log('  SKIP  取不到 BASE blob（淺複製）—— 由 ⑥ 的突變測試涵蓋');
  } else {
    const modB = await bundle({ 'lib/game/damage-estimate.ts': baseEst });
    const eB = LU ? modB.estimateAttackDamage(LU.state, 0, pool, 0) : null;
    chk('⭐ BASE 的 damage-estimate.ts ⇒ 波動突刺 顯示不出數字（HEAD-FAIL）',
        !(eB && eB.kind === 'exact'), JSON.stringify(eB));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑧ 【B】放大鏡：點它絕對不可以使出招式');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
{
  // ── 抓出 .atk-slot 這一整塊（從 <span class="atk-slot" 到對應的 </span>）──
  const start = PAGE.indexOf('<span class="atk-slot"');
  chk('找得到 .atk-slot 區塊', start >= 0);
  // ⚠ 不可以用「下一個 {/each}」定界 —— 招式鈕裡面的 cost-row 自己就有一個 each
  //   （Rule 25：不要用「往後找第一個 X」定位）。改用外層 each 的縮排當錨點。
  const end = PAGE.indexOf('\n            {/each}', start);
  const slot = (start >= 0 && end > start) ? PAGE.slice(start, end) : '';
  chk('.atk-slot 區塊抓得完整（有抓到收尾的 </span>）', slot.trim().endsWith('</span>'), slot.slice(-60));

  const atkBtnStart = slot.indexOf('<button class="btn-act atk"');
  const atkBtnEnd = slot.indexOf('</button>', atkBtnStart);
  const magStart = slot.indexOf('<button type="button" class="dmg-est-toggle"');
  chk('B1 招式鈕與放大鏡都在 .atk-slot 裡', atkBtnStart >= 0 && magStart >= 0);
  chk('⭐⭐ B1 放大鏡是招式鈕的**兄弟**、不是子節點（結構上不可能冒泡到招式鈕）',
      magStart > atkBtnEnd, `atkEnd=${atkBtnEnd} mag=${magStart}`);
  chk('B1 放大鏡是 type="button"（不會被當成 submit）', magStart >= 0);
  const magTag = magStart >= 0 ? slot.slice(magStart, slot.indexOf('</button>', magStart) + '</button>'.length) : '';
  chk('B1 放大鏡的 handler 有 stopPropagation()', magTag.includes('stopPropagation()'));
  chk('B1 放大鏡的 handler 有 preventDefault()', magTag.includes('preventDefault()'));
  chk('⭐⭐ B1 放大鏡的 handler **完全沒有**攻擊相關呼叫',
      !/initiateAttack|GameActions\.|dispatch\(/.test(magTag), magTag.slice(0, 160));
  chk('B1 招式鈕的 onclick 仍然是 initiateAttack(i)',
      slot.slice(atkBtnStart, atkBtnEnd).includes('onclick={()=>initiateAttack(i)}'));

  // ── B2 把 handler 原始碼挖出來**實跑** ─────────────────────────────────
  const m = /onclick=\{\(e\)=>\{([\s\S]*?)\}\}>🔍<\/button>/.exec(magTag);
  chk('B2 抓得到放大鏡的 handler 本體', !!m);
  if (m) {
    let body = m[1];
    let stopped = 0, prevented = 0, attacked = 0;
    const fn = new Function('e', 'ctx', `
      const initiateAttack = () => { ctx.attacked++; };
      const dispatch = () => { ctx.attacked++; };
      let estOpen = ctx.estOpen; const game = ctx.game; const i = ctx.i;
      ${body}
      return estOpen;`);
    const ctx = { attacked: 0, estOpen: null, game: { turn: 5 }, i: 0 };
    const ev = { stopPropagation: () => { stopped++; }, preventDefault: () => { prevented++; } };
    const after1 = fn(ev, ctx);
    chk('⭐⭐⭐ B2 實跑 handler：一次攻擊都沒有被觸發', ctx.attacked === 0, String(ctx.attacked));
    chk('B2 實跑 handler：有呼叫 stopPropagation / preventDefault', stopped === 1 && prevented === 1);
    chk('B2 實跑 handler：第一次點 → 打開（記下 turn 與 index）',
        !!after1 && after1.turn === 5 && after1.i === 0, JSON.stringify(after1));
    ctx.estOpen = after1;
    const after2 = fn(ev, ctx);
    chk('B2 實跑 handler：再點一次 → 收起', after2 === null, JSON.stringify(after2));
    ctx.estOpen = after1; ctx.i = 1;
    const after3 = fn(ev, ctx);
    chk('B2 實跑 handler：點另一招 → 換過去（不是收起）',
        !!after3 && after3.i === 1, JSON.stringify(after3));
    ctx.estOpen = after1; ctx.i = 0; ctx.game = { turn: 6 };
    const after4 = fn(ev, ctx);
    chk('B2 換回合後舊的開啟狀態自動失效（點一下是「打開」而不是「收起」）',
        !!after4 && after4.turn === 6, JSON.stringify(after4));
  }

  // ── B3 觸控目標大小（逐值算，不是比字串）────────────────────────────
  const css = PAGE.slice(PAGE.indexOf('.dmg-est-toggle{'));
  const w = /\.dmg-est-toggle\{[^}]*width:(\d+)px/.exec(css);
  const h = /\.dmg-est-toggle\{[^}]*height:(\d+)px/.exec(css);
  const af = /\.dmg-est-toggle::after\{[^}]*\}/.exec(css)?.[0] ?? '';
  const g = (k) => { const r = new RegExp(k + ':(-?\\d+)px').exec(af); return r ? -Number(r[1]) : 0; };
  const tw = w ? Number(w[1]) + g('left') + g('right') : 0;
  const th = h ? Number(h[1]) + g('top') + g('bottom') : 0;
  chk(`⭐ B3 觸控目標 ${tw}×${th} ≥ 44×44`, tw >= 44 && th >= 44, af);
  chk('B3 外擴用的是 ::after（絕對定位，不佔版面 ⇒ 三種桌機版面的排版不會被推開）',
      af.includes('position:absolute'), af);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑨ 【B】三種桌機版面：unused CSS 警告集合必須與基準完全相同');
{
  // ⚠⚠ v6.237 的教訓：多包一層 .atk-slot 讓 Fable 版面（桌機**預設**版）的
  //   `.action-btns > .btn-act.atk:nth-of-type(N)` 整組失聯 —— svelte 編譯器的
  //   unused-CSS 警告就是當時抓到它的儀器。這裡把它變成常設守衛。
  const BASELINE = [
    '.battle-root textarea', '.mini-poke-btn img', '.online-form h2', '.online-form select',
    '.preset-toggle-row input', '.settings-section h4', '.setup-screen h2',
  ];
  const r = compile(PAGE, { filename: 'game/+page.svelte', generate: 'client' });
  const got = r.warnings.filter(w => w.code === 'css_unused_selector')
    .map(w => (/Unused CSS selector "(.*)"/.exec(w.message) ?? [])[1])
    .filter(Boolean).sort();
  chk('⭐ 沒有新的 unused CSS 選擇器（＝沒有任何選擇器因為換 DOM 結構而失聯）',
      JSON.stringify(got) === JSON.stringify(BASELINE), JSON.stringify(got));
  // 正對照：三種版面各自釘一條「這一條現在是有用的」
  for (const sel of [
    '.playmat.layout-fable .action-bar > .action-btns > .atk-slot:nth-of-type(1)',   // Fable（桌機預設）
    '.atk-slot > .btn-act.atk',                                                      // 經典／桌墊共用
    '.atk-slot.est-open .dmg-est',                                                   // v6.238 新增
  ]) {
    chk('  └ 選擇器仍在且沒有被判成 unused：' + sel,
        PAGE.includes(sel) && !got.some(u => u === sel));
  }
  // ⭐⭐ 正對照（Rule 33）：把 Fable 的槽位選擇器**改回 v6.237 事故當時的寫法**
  //   （選 .btn-act.atk 而不是外層的 .atk-slot）⇒ 這條守衛必須抓得到。
  //   ⚠ 這個正對照必須用「真的發生過的失效形態」——實測 svelte 5 對**純 class**選擇器
  //     很保守（本檔有動態 class ⇒ 隨便塞一條 .foo{} 它不會報 unused），
  //     拿那種當自我驗證會得到一個永遠綠的安慰劑。
  const ANCHOR = '.action-btns > .atk-slot:nth-of-type(1){ grid-row:1; }';
  chk('  └ 正對照的錨點還在', PAGE.split(ANCHOR).length - 1 === 1);
  const probe = PAGE.replace(ANCHOR, '.action-btns > .btn-act.atk:nth-of-type(1){ grid-row:1; }');
  const rp = compile(probe, { filename: 'probe.svelte', generate: 'client' });
  const gp = rp.warnings.filter(w => w.code === 'css_unused_selector')
    .map(w => (/Unused CSS selector "(.*)"/.exec(w.message) ?? [])[1]);
  chk('  └ ⭐ 掃描器自我驗證：Fable 槽位選擇器一失聯就抓得到',
      gp.length === got.length + 1 && gp.some(x => x.includes('.btn-act.atk:nth-of-type(1)')),
      JSON.stringify(gp));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑩ 效能：多出來的乾跑不可以把預估變慢一個數量級（Rule 31/32：附量測）');
{
  const bench = [
    setup('超級路卡利歐ex', '波動突刺', '超級袋獸ex'),
    setup('甲賀忍蛙ex', '忍之利刃', null),
    setup('菊草葉', '飛葉快刀', null),
  ].filter(Boolean);
  for (const b of bench) mod.estimateAttackDamage(b.state, b.idx, pool, 0);   // 暖機
  const REP = 20; const t0 = Date.now();
  for (let r = 0; r < REP; r++) for (const b of bench) mod.estimateAttackDamage(b.state, b.idx, pool, 0);
  const per = (Date.now() - t0) / (REP * bench.length);
  console.log(`  量測：每一次預估平均 ${per.toFixed(2)} ms（${REP * bench.length} 次）`);
  chk('單次預估 < 40ms（含把選擇視窗跑到底）', per < 40, per.toFixed(2) + 'ms');
}

console.log(`\n[v6238-estimate-deferred-damage-and-magnifier] PASS ${n - bad} / FAIL ${bad}`);
process.exit(bad > 0 ? 1 : 0);
