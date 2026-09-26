// AI 對戰量尺的共用骨架（批次 A；診斷用，不進 CI，不動 src/）。
//
// 三支腳本共用：sim-ai-battle.mjs（卡住偵測＋基線統計）、eval-ai-selfplay.mjs（新舊 AI 鏡像 A/B）、
// eval-ai-pool.mjs（對手池矩陣）。收斂在這裡是為了「量尺只有一把」——
// 三支各自抄一份「該誰行動」「勝負原因分類」「過程指標」，日後一定會漂移（Rule 38）。
//
// ⚠ 本檔只讀引擎、不改引擎；所有統計都是「引擎提供了什麼選項」，不是「AI 選了什麼」，
//   這樣才分得出「AI 選錯」和「AI 根本沒得選」。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// ─────────────────────────────────────────────────────────────────────────────
// 1. 打包引擎＋AI
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 把引擎、目前工作樹的 ai.ts（aiNew）以及選用的基準版 ai.ts（aiOld）打包成一個 ESM。
 * @param {string} root repo 根目錄
 * @param {{ withBaseline?: boolean }} opts
 *   withBaseline：基準版 = git HEAD 的 ai.ts（或環境變數 AI_BASELINE_SRC 指定的檔案）。
 *   extraExports：額外的 export 敘述（字串陣列，路徑相對 repo 根），給診斷腳本用。
 *   ⚠ 單變因：兩版之間只差「工作樹相對 HEAD 的 ai.ts 改動」，勝率差才能歸因到那一批。
 */
export async function buildAiBundle(root, { withBaseline = false, extraExports = [] } = {}) {
  // 暫存檔名帶 pid：多支腳本平行跑時不會互相覆蓋（先前固定檔名會撞）
  const tag = `.x-aish-${process.pid}`;
  const S = join(root, `${tag}-s.js`), E = join(root, `${tag}-e.ts`), O = join(root, `${tag}-o.mjs`);
  const BASE = join(root, `src/lib/game/_ai_baseline_${process.pid}.ts`);
  const tmp = [S, E, O];
  if (withBaseline) tmp.push(BASE);
  process.on('exit', () => { for (const p of tmp) { try { unlinkSync(p); } catch {} } });

  if (withBaseline) {
    const headAI = process.env.AI_BASELINE_SRC && existsSync(process.env.AI_BASELINE_SRC)
      ? readFileSync(process.env.AI_BASELINE_SRC, 'utf8')
      : execFileSync('git', ['-C', root, 'cat-file', '-p', 'HEAD:src/lib/game/ai.ts'],
          { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    writeFileSync(BASE, headAI);
  }
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, [
    "export { createGame, applyAction, getAvailableAttacks, getEffectiveAttacks, getPlayableTrainers,",
    "  getPlayableBasics, getEvolvableTargets, getUsableAbilities, canRetreat } from './src/lib/game/engine';",
    "export { getAIAction as aiNew } from './src/lib/game/ai';",
    withBaseline ? `export { getAIAction as aiOld } from './src/lib/game/_ai_baseline_${process.pid}';` : 'export const aiOld = null;',
    "export { getCardRole } from './src/lib/game/ai-roles';",
    "export { PRESET_DECKS } from './src/lib/decks/presets';",
    // 診斷腳本需要的額外匯出（例如 ai-eval 的 evaluateAttack），逐行附加；不影響其他腳本
    ...extraExports,
    "import './src/lib/game/effects';",
  ].join('\n'));
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
    target: 'node20', alias: { $lib: join(root, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  return import(pathToFileURL(O).href);
}

/** 只載入 index.json 列管（live）的卡包，與 eval-ai-selfplay 既有做法一致。 */
export function loadLivePool(root) {
  const dir = join(root, 'static/cards');
  const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
  const pool = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
    for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
  }
  return pool;
}

/** 依 id 取內建預組（直接讀 PRESET_DECKS，不再用字串解析 presets.ts）。 */
export function presetById(mod, id) {
  const d = mod.PRESET_DECKS.find((x) => x.id === id);
  if (!d) throw new Error('找不到預組 ' + id);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 隨機數與統計工具
// ─────────────────────────────────────────────────────────────────────────────
/** mulberry32：每個 seed 產生固定的亂數序列（同 eval-ai-selfplay 既有實作）。 */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Wilson score 95% 信賴區間 [下界, 上界]。
 * 數學：p̂ = w/n，中心 = (p̂ + z²/2n)/(1 + z²/n)，半寬 = z·√(p̂(1−p̂)/n + z²/4n²)/(1 + z²/n)。
 * 對極端比例（接近 0% 或 100%）比常態近似穩健。
 */
export function wilson(wins, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = wins / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}

/**
 * 兩比例差的 z 值（合併變異數）。用於「新舊矩陣同一格是否顯著下降」：z < −1.96 ⇒ 顯著變差。
 * ⚠ 這只用來「否決」（抓回歸），不能反過來把 z > 1.96 當成出貨理由（紀律二）。
 */
export function twoPropZ(w1, n1, w2, n2) {
  if (!n1 || !n2) return 0;
  const p1 = w1 / n1, p2 = w2 / n2, p = (w1 + w2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (p2 - p1) / se;
}

/** 顯示寬度（中日韓全形字算 2 格），用於終端機對齊。 */
export function dispWidth(str) {
  let w = 0;
  for (const ch of String(str)) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return w;
}
export const padW = (str, n) => String(str) + ' '.repeat(Math.max(0, n - dispWidth(str)));

export const pct = (x, digits = 1) => (Number.isFinite(x) ? (x * 100).toFixed(digits) + '%' : '—');

/** 樣本量門檻：少於這個數字的勝率結論一律加警告（Kaggle 實例：150 局 54.7% → 400 局 50.5%±4.9%）。 */
export const MIN_TRUSTED_GAMES = 400;

// ─────────────────────────────────────────────────────────────────────────────
// 3. 勝負原因分類（A1）
// ─────────────────────────────────────────────────────────────────────────────
// 引擎的 winReason 字串（main 2f4e3801 實查）：
//   有勝負：「X 沒有可上場的寶可夢」／「X 牌組耗盡，無法抽牌」／「X 取得所有獎賞卡」；線上另有棄權類 ⇒ 歸「其他」。
//   平手（winner 這個 key 不存在）：中央終局判定 engine.ts 的 v6.361／v6.420 段落至少有三種字串——
//   「雙方皆沒有可上場的寶可夢」「雙方同時取得所有獎賞卡，且雙方皆可放置戰鬥寶可夢」
//   「X 取得所有獎賞卡，但同時沒有可上場的寶可夢」。
//   ⚠ 後兩種含「取得所有獎賞卡」子字串 ⇒ **必須先用 winner == null 判平手**，不可以只比字串。
export const REASON_CLASSES = [
  ['no-pokemon', '沒有可上場的寶可夢'],
  ['draw', '平手（雙方皆無寶可夢／同時取完獎賞等）'],
  ['deck-out', '牌組耗盡'],
  ['prizes', '取得所有獎賞卡'],
  ['other', '其他（棄權等）'],
  ['unfinished', '未結束（卡住／超過步數／例外）'],
];
export function classifyReason(result) {
  if (result.outcome !== 'ended') return 'unfinished';
  const r = String(result.reason ?? '');
  // ⚠ 平手一律以 winner 判定（見上方註解：有兩種平手字串含「取得所有獎賞卡」）
  if (result.winner == null) return 'draw';
  if (r.includes('沒有可上場的寶可夢')) return 'no-pokemon';
  if (r.includes('牌組耗盡')) return 'deck-out';
  if (r.includes('取得所有獎賞卡')) return 'prizes';
  return 'other';
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 「該誰行動」——三支腳本唯一的一份
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 依盤面決定優先行動者（與既有 sim-ai-battle / eval-ai-selfplay 的順序相同）。
 * ⚠ 既有兩支的 bug：setup 階段雙方 setupDone 都為 true 時固定挑 0，而 0 若已無事可做
 *   （回 null），另一方還卡在 CONFIRM_MULLIGAN_REVEAL ⇒ 被誤判成「AI 卡住」（sim 約 25% 的局）
 *   或「未分出」（selfplay）。修法見 nextAction：setup 階段優先者回 null 時改問另一方。
 */
function preferredActor(st) {
  if (st.phase === 'setup') {
    const mul = st.pendingMulliganDraw ?? [0, 0];
    return mul[0] > 0 ? 0 : (mul[1] > 0 ? 1 : (!st.setupDone[0] ? 0 : (!st.setupDone[1] ? 1 : 0)));
  }
  if (st.pendingSelection) return st.pendingSelection.actorIdx;
  if (st.players[0].active === null && st.players[0].bench.length > 0) return 0;
  if (st.players[1].active === null && st.players[1].bench.length > 0) return 1;
  return st.activePlayerIndex;
}
export function nextAction(st, agents) {
  const a = preferredActor(st);
  let act = agents[a](st, a);
  if (act || st.phase !== 'setup') return { actor: a, act };
  const b = a === 0 ? 1 : 0;
  act = agents[b](st, b);
  return { actor: b, act };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 主打手的「主招」定義（A2）
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 主打手 = ai-roles.ts 的 getCardRole(...) === 'main-attacker'（與 AI 自己用的分類同一份）。
 * 主招 = 該卡印刷傷害數字最大的招式（「120+」「30×」取數字部分；全都沒數字就取最後一招）。
 * ⚠ 這是量尺用的操作型定義，不是卡面規則；寫在輸出裡讓讀者知道口徑。
 * @returns {Set<string>} `${卡名}|${招式名}` 的集合；牌組沒有主打手時為空集合。
 */
export function mainMoveKeys(mod, deck, pool) {
  const keys = new Set();
  const seen = new Set();
  for (const e of deck.entries) {
    if (seen.has(e.cardId)) continue;
    seen.add(e.cardId);
    const c = pool.get(String(e.cardId));
    if (!c || c.supertype !== 'Pokemon') continue;
    let role;
    try { role = mod.getCardRole(String(e.cardId), deck, pool); } catch { role = null; }
    if (role !== 'main-attacker') continue;
    const atks = c.attacks ?? [];
    if (!atks.length) continue;
    let best = atks[atks.length - 1], bestDmg = -1;
    for (const a of atks) {
      const d = parseInt(String(a.damage ?? '').replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(d) && d >= bestDmg) { bestDmg = d; best = a; }
    }
    keys.add(`${c.name}|${best.name}`);
  }
  return keys;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 跑一局並收集過程指標
// ─────────────────────────────────────────────────────────────────────────────
function newSideMetrics() {
  return { ownTurns: [], availTurns: new Set(), attacksSent: 0, mainMoveUsed: false, hasMainMove: false };
}

/**
 * 跑一局。
 * @param {object} p
 * @param {any} p.mod      buildAiBundle 的回傳
 * @param {Map} p.pool
 * @param {[object, object]} p.decks  兩側的 Deck（含 entries，用於主打手判定）
 * @param {[Function, Function]} p.agents  (state, idx) => action | null
 * @param {number} p.seed
 * @param {number} [p.maxSteps=20000]
 * @param {number} [p.maxRejects=30]  同一盤面連續被引擎拒絕幾次視為卡住
 * @returns {{ outcome, winner, reason, reasonClass, turns, steps, sides, error?, lastAction? }}
 */
export function playGame({ mod, pool, decks, agents, seed, maxSteps = 20000, maxRejects = 30 }) {
  const orig = Math.random;
  Math.random = seeded(seed);
  const sides = [newSideMetrics(), newSideMetrics()];
  const mainKeys = decks.map((d) => mainMoveKeys(mod, d, pool));
  sides[0].hasMainMove = mainKeys[0].size > 0;
  sides[1].hasMainMove = mainKeys[1].size > 0;
  let st, steps = 0, rejected = 0, lastAction = null;
  try {
    st = mod.createGame({ name: 'A', entries: decks[0].entries }, { name: 'B', entries: decks[1].entries }, pool);
    for (; steps < maxSteps && st.phase !== 'game-over'; steps++) {
      // ── 過程指標：在「輪到自己的主階段、沒有待選擇」時記錄引擎提供的攻擊選項 ──
      if (st.phase === 'playing' && st.turnPhase === 'main' && !st.pendingSelection) {
        const me = st.activePlayerIndex;
        const sm = sides[me];
        if (sm.ownTurns[sm.ownTurns.length - 1] !== st.turn) sm.ownTurns.push(st.turn);
        if (st.players[me].active && mod.getAvailableAttacks(st, pool).length > 0) sm.availTurns.add(st.turn);
      }
      const { actor, act } = nextAction(st, agents);
      if (!act) return finish('no_action');
      lastAction = act;
      // 送出 ATTACK 前先記下「打的是哪一招」（applyAction 之後戰鬥位可能已換人）
      let atkKey = null;
      if (act.type === 'ATTACK' && st.players[actor].active) {
        const inst = st.players[actor].active;
        const card = pool.get(String(inst.cardId));
        const eff = mod.getEffectiveAttacks(st, inst, pool);
        const atk = eff?.[act.attackIndex]?.atk;
        if (card && atk) atkKey = `${card.name}|${atk.name}`;
      }
      const next = mod.applyAction(st, act, pool);
      if (next === st) {
        if (++rejected > maxRejects) return finish('stuck_loop');
        continue;
      }
      rejected = 0;
      if (act.type === 'ATTACK') {
        sides[actor].attacksSent++;
        if (atkKey && mainKeys[actor].has(atkKey)) sides[actor].mainMoveUsed = true;
      }
      st = next;
    }
    return finish(st.phase === 'game-over' ? 'ended' : 'maxiter');
  } catch (e) {
    return finish('exception', e);
  } finally {
    Math.random = orig;
  }

  function finish(outcome, err) {
    const ended = outcome === 'ended';
    const winner = ended && st && st.winner != null ? st.winner : null;
    const res = { outcome, winner, reason: ended ? st.winReason : null, turns: st ? st.turn : 0,
      steps, sides, lastAction };
    if (err) res.error = String(err && err.message || err);
    res.reasonClass = classifyReason(res);
    return res;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 過程指標彙總（A2：每一項都分勝局／敗局）
// ─────────────────────────────────────────────────────────────────────────────
/** 單側單局的指標；沒有意義時回 null（例如從未出現攻擊選項就沒有「連續性」）。 */
export function sideSummary(sm) {
  const n = sm.ownTurns.length;
  const firstIdx = sm.ownTurns.findIndex((t) => sm.availTurns.has(t));
  const after = firstIdx >= 0 ? sm.ownTurns.slice(firstIdx + 1) : [];
  return {
    firstAvailOrdinal: firstIdx >= 0 ? firstIdx + 1 : null,           // 第幾個自己的回合首次可攻擊
    availRate: n ? sm.availTurns.size / n : null,                      // 可攻擊回合 / 自己的回合
    continuity: after.length ? after.filter((t) => sm.availTurns.has(t)).length / after.length : null,
    mainMoveUsed: sm.hasMainMove ? sm.mainMoveUsed : null,             // 牌組無主打手 ⇒ 不計
  };
}

export function newAggregate() {
  return { games: 0, reason: Object.fromEntries(REASON_CLASSES.map(([k]) => [k, 0])),
    lossReason: Object.fromEntries(REASON_CLASSES.map(([k]) => [k, 0])),
    groups: { win: [], loss: [], draw: [] } };
}

/**
 * 把一局加進彙總。perspective：只統計哪幾側（預設兩側都算）。
 * 勝負原因分兩種看法：reason＝全部對局；lossReason＝「perspective 那側輸掉」的對局（A1 敗因）。
 */
export function addToAggregate(agg, res, perspective = [0, 1]) {
  agg.games++;
  agg.reason[res.reasonClass]++;
  for (const side of perspective) {
    const s = sideSummary(res.sides[side]);
    const g = res.winner == null ? 'draw' : (res.winner === side ? 'win' : 'loss');
    agg.groups[g].push(s);
    if (g === 'loss') agg.lossReason[res.reasonClass]++;
  }
}

function meanOf(arr, key) {
  const v = arr.map((x) => x[key]).filter((x) => x != null && Number.isFinite(Number(x)));
  if (!v.length) return { mean: null, n: 0 };
  return { mean: v.reduce((a, b) => a + Number(b), 0) / v.length, n: v.length };
}

/** 印出 A1 分布＋A2 勝／敗對照。 */
export function printAggregate(agg, title = '') {
  const out = [];
  out.push(`\n══════ A1 勝負原因分布${title ? '（' + title + '）' : ''} ══════`);
  for (const [k, label] of REASON_CLASSES) {
    const c = agg.reason[k];
    out.push(`  ${padW(label, 40)} ${String(c).padStart(5)}  ${pct(agg.games ? c / agg.games : NaN)}`);
  }
  const losses = agg.groups.loss.length;
  out.push(`  ── 以「輸的那一側」統計的敗因（共 ${losses} 筆敗局）──`);
  for (const [k, label] of REASON_CLASSES) {
    if (k === 'draw' || k === 'unfinished') continue;
    const c = agg.lossReason[k];
    out.push(`  ${padW(label, 40)} ${String(c).padStart(5)}  ${pct(losses ? c / losses : NaN)}`);
  }
  out.push(`\n══════ A2 過程指標（引擎提供的選項，不是 AI 的選擇）══════`);
  out.push(`  ${padW('指標', 32)} ${padW('勝局', 18)} ${padW('敗局', 18)} 差（勝−敗）`);
  const rows = [
    ['首次可攻擊（第幾個自己的回合）', 'firstAvailOrdinal', false],
    ['攻擊可用率', 'availRate', true],
    ['ATTACK 連續性', 'continuity', true],
    ['主打手主招有打出來的對局比例', 'mainMoveUsed', true],
  ];
  for (const [label, key, isRate] of rows) {
    const w = meanOf(agg.groups.win, key), l = meanOf(agg.groups.loss, key);
    const f = (m) => (m.mean == null ? '—' : (isRate ? pct(m.mean) : m.mean.toFixed(2))) + `（n=${m.n}）`;
    const diff = w.mean != null && l.mean != null
      ? (isRate ? ((w.mean - l.mean) * 100).toFixed(1) + 'pp' : (w.mean - l.mean).toFixed(2)) : '—';
    out.push(`  ${padW(label, 32)} ${padW(f(w), 18)} ${padW(f(l), 18)} ${diff}`);
  }
  out.push('  ⚙ 口徑：主打手＝ai-roles getCardRole 判為 main-attacker；主招＝該卡印刷傷害數字最大的招式。');
  out.push('  ⚙ 判讀：勝敗局沒有差異的指標就不是敗因，可以直接排除。');
  console.log(out.join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. 隨機合法動作 agent（A4 的地板）
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 只在「輪到自己的主階段、沒有待選擇、戰鬥位有寶可夢」時隨機挑一個合法動作；
 * 其餘情境（setup、選擇視窗、補位）一律交給正式 AI（getAIAction），否則對局會卡住。
 * 合法性以引擎為準：候選逐一丟給 applyAction 試，被拒絕（回傳同一個 state）就換下一個。
 * 每回合最多 25 個動作，之後強制結束回合（避免隨機來回撤退把一局拖到步數上限）。
 */
export function makeRandomAgent(mod, pool) {
  let turnKey = null, count = 0;
  return (st, idx) => {
    if (st.phase !== 'playing' || st.pendingSelection || st.activePlayerIndex !== idx
        || st.turnPhase !== 'main' || !st.players[idx].active) {
      return mod.aiNew(st, pool, idx);
    }
    const k = `${st.turn}:${idx}`;
    if (k !== turnKey) { turnKey = k; count = 0; }
    if (++count > 25) return { type: 'END_TURN' };
    const me = st.players[idx];
    const cands = [{ type: 'END_TURN' }];
    for (const i of mod.getAvailableAttacks(st, pool)) cands.push({ type: 'ATTACK', attackIndex: i });
    for (const iid of mod.getPlayableTrainers(st, pool)) cands.push({ type: 'PLAY_TRAINER', iid });
    for (const iid of mod.getPlayableBasics(st, pool)) cands.push({ type: 'PLAY_BASIC', iid });
    for (const t of mod.getEvolvableTargets(st, pool)) for (const to of t.toIids) cands.push({ type: 'EVOLVE', fromIid: t.fromIid, toIid: to });
    for (const a of mod.getUsableAbilities(st, pool)) cands.push({ type: 'USE_ABILITY', iid: a.iid, abilityIndex: a.abilityIndex });
    const targets = [me.active, ...me.bench].filter(Boolean);
    for (const h of me.hand) {
      if (pool.get(String(h.cardId))?.supertype !== 'Energy') continue;
      for (const t of targets) cands.push({ type: 'ATTACH_ENERGY', energyIid: h.iid, targetIid: t.iid });
    }
    if (mod.canRetreat(st, pool)) for (const b of me.bench) cands.push({ type: 'RETREAT', newActiveIid: b.iid });
    // Fisher–Yates 洗牌後逐一試（用對局的 seeded Math.random ⇒ 同 seed 可重現）
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }
    for (const c of cands) {
      let ok = false;
      try { ok = mod.applyAction(st, c, pool) !== st; } catch { ok = false; }
      if (ok) return c;
    }
    return { type: 'END_TURN' };
  };
}
