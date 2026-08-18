// ⭐⭐⭐ v6.200 守衛：手牌卡「拖曳」與「點擊」必須共用**同一份**可用性述詞。
//
// 玩家回報（桌機 Windows）：烈箭鷹ex 的特性「激動俯衝」條件成立時，
//   **能點擊發動、但完全拖不動**（連拖曳動畫都不會出現）。
// 真因：+page.svelte 手牌卡有兩份互不相干的判定 ——
//   拖曳看 `dragKind = canEnergy ? … : canTrainer ? … : null`（沒有手牌特性），
//   點擊看 `canHandActivate = handActivateAbilities.has(iid)`。
//   v6.080 新增手牌特性時只補了點擊那一份。
// ⇒ v6.200 收斂成 `src/lib/game/hand-card-ops.ts` 的 `getHandCardOps()`。
//
// 本守衛四個區塊：
//   ① 卡面逐字查證（static/cards 台灣官方卡面；特性讀 abilities[].effect）
//   ② 行為端：ON_HAND_ACTIVATE_ABILITIES **每一張**卡，可用時拖曳與點擊兩條路徑
//      都要能把卡放到備戰（且最終盤面一致）；不可用時兩條路徑都不能（正對照）
//   ③ 結構：桌機（classic + fable 共用 markup）的拖曳/點擊只准讀同一支述詞；
//      手機直式沒有拖曳、入口讀中央 gate
//   ④ 否定型判準的**自我驗證**（餵違規樣本必須抓得到）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6200-s.js'), E = join(ROOT, '.v6200-e.ts'), O = join(ROOT, '.v6200-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; } else { fail++; console.log('  ❌', t, extra); } };

writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, createGame, getHandActivatableAbilities } from './src/lib/game/engine';\n"
+ "export { ON_HAND_ACTIVATE_ABILITIES } from './src/lib/game/effects';\n"
+ "export { getHandCardOps, handCardDraggable, handCardDragKind, handOpForDropTarget,\n"
+ "         HAND_CARD_OPS, HAND_OP_DROP_TARGET } from './src/lib/game/hand-card-ops';\n"
+ "import './src/lib/game/effects';");

let M = null;
try {
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
    target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  M = await import(pathToFileURL(O).href);
} catch (e) {
  chk('bundle：$lib/game/hand-card-ops 必須存在且可 bundle（手牌可用性的唯一述詞）', false, String(e).slice(0, 300));
}

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const card = (id) => pool.get(String(id));

// ══════════════════════════════════════════════════════════════════════════
// ① 卡面逐字（台灣官方卡面；特性一律讀 abilities[].effect，不是 .text）
// ══════════════════════════════════════════════════════════════════════════
const TALON = 19612;   // 烈箭鷹ex（M6 / J / Stage2 / Colorless）
const RAYQ  = 19608;   // 超級烈空坐ex（M6 / J / Basic / Colorless / 超級進化ex）
const GOLURK = 19583;  // 超級泥偶巨人ex（M6 / 超級進化ex 但屬性是【超】→ 正對照用）
const KLINGER = 10964; // 齒輪怪（SV7 / H / Stage2 / 緊急迴轉）
const TALON_PLAIN = 10980; // 烈箭鷹（SV7 / Stage2 / 給對手當【2階進化】用）
const PIKA_BASIC = null;   // 由下方 pickBasic() 挑

{
  const c = card(TALON);
  const ab = (c?.abilities ?? []).find(a => a.name === '激動俯衝');
  chk('①卡面：烈箭鷹ex 存在且帶特性「激動俯衝」', !!ab, JSON.stringify(c?.abilities ?? null));
  const eff = ab?.effect ?? '';
  chk('①卡面：激動俯衝 effect 逐字含「若手牌有這張卡」', eff.includes('若手牌有這張卡'), eff);
  chk('①卡面：激動俯衝 effect 逐字含「自己的場上有【無】屬性的」', eff.includes('自己的場上有【無】屬性的'), eff);
  chk('①卡面：激動俯衝 effect 逐字含「超級進化寶可夢【ex】」', eff.includes('超級進化寶可夢【ex】'), eff);
  chk('①卡面：激動俯衝 effect 逐字含「將這張卡放置於備戰區」', eff.includes('將這張卡放置於備戰區'), eff);
  chk('①卡面：激動俯衝 是「可使用1次」的主動特性', eff.includes('則可使用1次'), eff);
  chk('①卡面：烈箭鷹ex 是維護中的 H/I/J 標', ['H', 'I', 'J'].includes(String(c?.regulationMark)), String(c?.regulationMark));
}

// ══════════════════════════════════════════════════════════════════════════
// ② 行為端 parity — 枚舉 ON_HAND_ACTIVATE_ABILITIES 每一張卡
// ══════════════════════════════════════════════════════════════════════════
let iidN = 0;
const inst = (cid, e = {}) => ({ iid: `q${++iidN}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });

// ⭐ 從 +page.svelte 抽出「拖曳釋放的 hand-ability 分支」與「點擊用的 triggerHandActivateAbility」
//   兩段**不同的原始碼**，各自真的執行一次，比對送出的 action。
//   ⚠ 這兩段在 v6.199 是不同的世界（拖曳端根本沒有這個分支）→ HEAD 抽不到 → 紅。
const DESK_SRC = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
function braceBody(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let j = src.indexOf('{', i + header.length - 1), depth = 0, start = j;
  if (j < 0) return null;
  while (j < src.length) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start + 1, j); }
    j++;
  }
  return null;
}
// ⭐⭐⭐v6.208 站長裁定：手牌特性**只能拖曳**，點擊比照其他手牌卡「什麼都不做」。
//   ⇒ 這裡從「兩條路徑送出相同動作」改成「拖曳送出動作、點擊一個動作都不送」。
//   點擊那一側直接執行 template 真正的 onclick body（不是自己重寫一份判斷）。
function handOnClickBody(src) {
  const key = 'onclick={()=>{if(actionBusy){tActSay(TACT_BLOCKED_MSG,5000);return;}';
  const i = src.indexOf(key);
  if (i < 0) return null;
  const j = src.indexOf('{', i + 'onclick='.length - 1);
  let depth = 0, k = j;
  while (k < src.length) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
    k++;
  }
  const expr = src.slice(j + 1, k);
  const b = expr.indexOf('{');
  return b < 0 ? null : expr.slice(b + 1, expr.lastIndexOf('}'));
}
function runBothUiPaths(handIid, metaList) {
  const dragBody = braceBody(DESK_SRC, "} else if (op === 'hand-ability' && benchEmpty) {");
  const clickBody = handOnClickBody(DESK_SRC);
  if (!dragBody || !clickBody) return null;
  const map = new Map(metaList.map(a => [a.iid, { abilityName: a.abilityName, abilityIndex: a.abilityIndex }]));
  const GA = { useHandAbility: (iid, idx) => ({ type: 'USE_HAND_ABILITY', cardIid: iid, abilityIndex: idx }) };
  let dragAct = null, clickAct = null;
  // eslint-disable-next-line no-new-func
  const dragFn = new Function('d', 'handActivateAbilities', 'dispatch', 'GameActions',
    '(async () => {' + dragBody + '})();');
  dragFn({ iid: handIid }, map, (a) => { dragAct = a; }, GA);
  // eslint-disable-next-line no-new-func
  //  ⚠ `triggerHandActivateAbility` 一定要當參數傳進去，而且要**忠實鏡射**舊版的行為
  //    （它會 dispatch useHandAbility）。不傳＝BASE 跑到那行直接 ReferenceError 讓測試「當掉」；
  //    傳一個什麼都不做的空函式＝BASE 也拿到 clickAct===null ⇒ **假綠**。
  const clickFn = new Function('actionBusy', 'tActSay', 'TACT_BLOCKED_MSG', 'canHandActivate', 'canEnergy',
    'dragging', 'selectedEnergyIid', 'inst', 'dispatch', 'GameActions', 'triggerHandActivateAbility', clickBody);
  clickFn(false, () => {}, 'blocked', true, false, null, null, { iid: handIid }, (a) => { clickAct = a; }, GA,
    (iid) => { clickAct = GA.useHandAbility(iid, map.get(iid)?.abilityIndex ?? 0); });
  return { drag: dragAct, click: clickAct };
}

function pickBasic() {
  for (const [id, c] of pool) {
    if (c.supertype === 'Pokemon' && !c.evolvesFrom && c.subtype !== 'Stage1' && c.subtype !== 'Stage2'
        && !String(c.name).endsWith('ex') && !String(c.name).startsWith('超級')) return id;
  }
  return null;
}

function mkState(myActiveId, oppActiveId, handIds) {
  if (!M) return null;
  const s0 = M.createGame(
    { name: 'P1', entries: [{ cardId: String(myActiveId), count: 1 }] },
    { name: 'P2', entries: [{ cardId: String(oppActiveId), count: 1 }] }, pool);
  const hand = handIds.map(id => inst(id));
  return {
    ...s0, phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, activeStadium: null, log: [],
    players: [
      { ...s0.players[0], active: inst(myActiveId), bench: [], hand, deck: [], discard: [] },
      { ...s0.players[1], active: inst(oppActiveId), bench: [], hand: [], deck: [], discard: [] },
    ],
  };
}

// fixture：每一張登錄卡都必須在這裡有「可用」與「不可用」兩個盤面。
//   ⚠ 新增同型卡而沒補 fixture → 下方完備性斷言會亮紅（掃描器不會靜默漏掉）。
const BASIC = pickBasic();
const FIXTURES = {
  // 烈箭鷹ex｜激動俯衝：自己場上有【無】超級進化ex
  '烈箭鷹ex': {
    handId: TALON,
    ok:  () => mkState(RAYQ, BASIC, [TALON]),      // 自己 active = 超級烈空坐ex（Colorless Mega ex）
    bad: () => mkState(GOLURK, BASIC, [TALON]),    // 超級泥偶巨人ex 是【超】屬性 → 條件不成立
  },
  // 齒輪怪｜緊急迴轉：對手場上有【2階進化】寶可夢
  '齒輪怪': {
    handId: KLINGER,
    ok:  () => mkState(BASIC, TALON_PLAIN, [KLINGER]),  // 對手 active = 烈箭鷹（Stage2）
    bad: () => mkState(BASIC, BASIC, [KLINGER]),        // 對手只有基礎 → 條件不成立
  },
};

if (M) {
  const registered = [...M.ON_HAND_ACTIVATE_ABILITIES.keys()];
  chk('②掃描器下限：ON_HAND_ACTIVATE_ABILITIES 至少 2 張（掃描器壞了會是 0）',
      registered.length >= 2, String(registered.length));
  chk('②完備性：每張登錄的手牌特性卡都要有 fixture（新增卡忘了補 → 這裡亮紅）',
      registered.every(n => !!FIXTURES[n]), JSON.stringify(registered));
  chk('②fixture 沒有多餘條目', Object.keys(FIXTURES).every(n => registered.includes(n)),
      JSON.stringify(Object.keys(FIXTURES)));
  chk('②基礎寶可夢 fixture 找得到', !!BASIC, String(BASIC));

  for (const name of registered) {
    const fx = FIXTURES[name];
    if (!fx) continue;

    // ── 可用時：拖曳與點擊兩條路徑都要成立 ──────────────────────────
    const st = fx.ok();
    const handIid = st.players[0].hand[0].iid;
    const ops = M.getHandCardOps(st, 0, pool, { isMyTurn: true });
    const set = ops.get(handIid);
    chk(`②[${name}] 中央述詞列出 hand-ability`, !!set && set.has('hand-ability'),
        JSON.stringify(set ? [...set] : null));
    // 拖曳端①：卡片可拖（v6.199 這裡是 false → 玩家「拖不動」）
    chk(`②[${name}] 拖曳路徑：handCardDraggable === true`, M.handCardDraggable(set) === true);
    // 拖曳端②：拖到空備戰格會結算成 hand-ability
    chk(`②[${name}] 拖曳路徑：釋放在空備戰格 → op = hand-ability`,
        M.handOpForDropTarget(set, 'bench-empty') === 'hand-ability',
        String(M.handOpForDropTarget(set, 'bench-empty')));
    // 拖曳端③：真的執行（UI pointerup 就是這兩步）
    const metaList = M.getHandActivatableAbilities(st, 0, pool);
    const meta = metaList.find(a => a.iid === handIid);
    chk(`②[${name}] 中央 gate 提供 abilityIndex`, !!meta, JSON.stringify(metaList));
    const rDrag = M.applyAction(st, { type: 'USE_HAND_ABILITY', cardIid: handIid, abilityIndex: meta?.abilityIndex ?? 0, actorIdx: 0 }, pool);
    chk(`②[${name}] 拖曳結算：卡片真的上備戰`,
        rDrag.players[0].bench.some(b => b.cardId === String(fx.handId)),
        JSON.stringify(rDrag.players[0].bench.map(b => b.cardId)));
    chk(`②[${name}] 拖曳結算：手牌少一張`, rDrag.players[0].hand.length === 0, String(rDrag.players[0].hand.length));

    // 點擊端：同一份述詞 → 同一個 action → 盤面必須一致
    const st2 = fx.ok();
    const handIid2 = st2.players[0].hand[0].iid;
    const ops2 = M.getHandCardOps(st2, 0, pool, { isMyTurn: true });
    chk(`②[${name}] 點擊路徑：canHandActivate（= ops.has('hand-ability')）`,
        !!ops2.get(handIid2)?.has('hand-ability'));
    const meta2 = M.getHandActivatableAbilities(st2, 0, pool).find(a => a.iid === handIid2);
    const rClick = M.applyAction(st2, { type: 'USE_HAND_ABILITY', cardIid: handIid2, abilityIndex: meta2?.abilityIndex ?? 0, actorIdx: 0 }, pool);
    chk(`②[${name}] 兩條路徑結算後盤面相同（備戰內容 + 手牌張數）`,
        JSON.stringify(rClick.players[0].bench.map(b => b.cardId)) === JSON.stringify(rDrag.players[0].bench.map(b => b.cardId))
        && rClick.players[0].hand.length === rDrag.players[0].hand.length);
    // ⭐ 真正的 parity：把 UI **兩段不同的原始碼**各執行一次，比對送出的 action。
    //   （上一條只是同一支 applyAction 跑兩次，證明不了「兩條路徑」——子代理審查抓到的 placebo。）
    const uiActions = runBothUiPaths(handIid, metaList);
    chk(`②[${name}] UI 拖曳分支送出 useHandAbility；⭐v6.208 點擊 onclick **一個動作都不送**`,
        !!uiActions && !!uiActions.drag && uiActions.click === null,
        JSON.stringify(uiActions));
    chk(`②[${name}] 送出的 abilityIndex 來自中央 gate（不是硬編 0）`,
        uiActions?.drag?.abilityIndex === (meta?.abilityIndex ?? -1),
        JSON.stringify(uiActions?.drag));

    // ── 正對照：條件不成立時，兩條路徑都不可以 ────────────────────
    const stBad = fx.bad();
    const badIid = stBad.players[0].hand[0].iid;
    const opsBad = M.getHandCardOps(stBad, 0, pool, { isMyTurn: true });
    const setBad = opsBad.get(badIid);
    chk(`②[${name}] 正對照：條件不成立 → 沒有 hand-ability`,
        !setBad || !setBad.has('hand-ability'), JSON.stringify(setBad ? [...setBad] : null));
    chk(`②[${name}] 正對照：拖到備戰格不會結算成 hand-ability`,
        M.handOpForDropTarget(setBad, 'bench-empty') !== 'hand-ability',
        String(M.handOpForDropTarget(setBad, 'bench-empty')));
    chk(`②[${name}] 正對照：點擊路徑也列不出來`,
        !M.getHandActivatableAbilities(stBad, 0, pool).some(a => a.iid === badIid));
    const rBad = M.applyAction(stBad, { type: 'USE_HAND_ABILITY', cardIid: badIid, abilityIndex: 0, actorIdx: 0 }, pool);
    chk(`②[${name}] 正對照：引擎端也拒絕（手牌張數不變）`, rBad.players[0].hand.length === 1,
        String(rBad.players[0].hand.length));

    // ── 正對照：不是我的回合 → 兩條路徑都不可以 ───────────────────
    const opsNotMine = M.getHandCardOps(fx.ok(), 0, pool, { isMyTurn: false });
    chk(`②[${name}] 正對照：非我方回合 → 中央述詞不給任何操作`,
        [...opsNotMine.values()].every(v => !v.has('hand-ability')), JSON.stringify([...opsNotMine]));
  }

  // op → 釋放區對照表完整（少一個 key = 那種操作拖過去永遠不生效）
  chk('②HAND_OP_DROP_TARGET 涵蓋每一個 HandCardOp',
      M.HAND_CARD_OPS.every(op => typeof M.HAND_OP_DROP_TARGET[op] === 'string'),
      JSON.stringify(M.HAND_CARD_OPS));
  chk('②hand-ability 的釋放區是空備戰格（卡面：將這張卡放置於備戰區）',
      M.HAND_OP_DROP_TARGET['hand-ability'] === 'bench-empty');
}

// ══════════════════════════════════════════════════════════════════════════
// ③ 結構：三種版面
// ══════════════════════════════════════════════════════════════════════════
const stripComments = (s) => s
  .replace(/[​-‍﻿]/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const deskRaw = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const desk = stripComments(deskRaw);
const mobRaw = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
const mob = stripComments(mobRaw);

// 手牌卡 template 區塊（用結構 anchor 截，不寫死行號）
function handBlockOf(src) {
  const a = src.indexOf('<div class="hand-strip">');
  if (a < 0) return null;
  const b = src.indexOf('{/key}', a);
  if (b < 0) return null;
  return src.slice(a, b);
}
const blk = handBlockOf(desk);
chk('③anchor：抓得到桌機手牌 template 區塊（上下界都要 —— 只有上界的話 anchor 失效會變成掃空字串）',
    !!blk && blk.length > 2500 && blk.length < 12000, String(blk?.length));

/** 否定型判準：手牌區塊裡出現「自行組裝可用性條件」的痕跡 */
function secondPredicateHits(block) {
  if (!block) return ['<no block>'];
  const bad = [];
  for (const pat of [
    /playable(Basic|Fossil|Trainer|Evo)Iids/g,
    /handActivateAbilities\s*\.\s*has/g,
    /getHandActivatableAbilities/g,
    /dragKind\s*=\s*can[A-Za-z]+\s*\?/g,               // v6.199 的三元列舉
  ]) { const m = block.match(pat); if (m) bad.push(...m); }
  // canXXX 一律必須直接由中央 ops 推導（值必須以 ops.has( 開頭）
  for (const m of block.matchAll(/\{@const\s+(can[A-Za-z]*)\s*=([^\n]*?)\}\s*$/gm)) {
    if (!/^\s*ops\.has\(/.test(m[2])) bad.push(m[0]);
  }
  return bad;
}
chk('③桌機手牌區塊：沒有第二份可用性判定（拖曳與點擊同源）',
    secondPredicateHits(blk).length === 0, JSON.stringify(secondPredicateHits(blk)));

chk('③桌機：可拖與否問中央 handCardDraggable(ops)',
    !!blk && /onpointerdown=\{\(e\)=>\{leaveHandCard\(\);\s*if\(handCardDraggable\(ops\)\)/.test(blk));
chk('③桌機：startDrag 收到的是 ops（不是自算的 kind）',
    !!blk && /startDrag\(e,\s*inst,\s*ops,\s*c\)/.test(blk));
chk('③桌機：canHandActivate 仍由中央 ops 推導（提示文字/title 讀它）',
    !!blk && /\{@const canHandActivate\s*=\s*ops\.has\('hand-ability'\)\}/.test(blk));
chk('⭐v6.208 站長裁定：點擊**不會**發動手牌特性（onclick 不得再呼叫 triggerHandActivateAbility）',
    !!blk && !/triggerHandActivateAbility/.test(blk));
chk('③桌機：draggable class 也讀同一支（dragKind = handCardDragKind(ops)）',
    !!blk && /\{@const dragKind = handCardDragKind\(ops\)\}/.test(blk)
          && /class:draggable=\{dragKind!==null\}/.test(blk));

// 釋放結算 / 釋放區高亮：不得再有任何手寫的 kind→釋放區對照
//   ⚠ 只擋 `d.kind` 是不夠的（Fable/子代理審查抓到）：`dragging?.kind===` 在
//     寶可夢格、桌墊 trainer 區、空備戰格都各寫過一份。這裡全掃，
//     只放行 drag-preview 那個**純文字標籤**區塊（它顯示的 kind 本來就由中央產生）。
const deskNoGhost = (() => {
  const a = desk.indexOf('<div class="drag-preview"');
  if (a < 0) return desk;
  const b = desk.indexOf('</div>', desk.indexOf('</div>', a) + 6);
  return desk.slice(0, a) + desk.slice(b < 0 ? a : b);
})();
const kindHits = deskNoGhost.match(/(?:d|dragging)\??\.kind\s*===\s*'[a-z-]+'/g) || [];
chk('③桌機：拖曳結算與釋放區高亮都不再用 .kind 分派（改查 handOpForDropTarget / dragOpFor）',
    kindHits.length === 0, kindHits.join(','));
chk('③自我驗證：.kind 掃描器抓得到違規樣本（否則排除 drag-preview 後可能整段掃空）',
    /(?:d|dragging)\??\.kind\s*===\s*'[a-z-]+'/.test("class:x={dragging?.kind==='trainer'}"));
chk('③桌機：寶可夢格與桌墊的釋放區高亮改問 dragOpFor',
    (desk.match(/dragOpFor\('poke'\)/g) || []).length >= 4 && /dragOpFor\('playmat'\)==='trainer'/.test(desk));
chk('③桌機：pointerup 有查中央 handOpForDropTarget', /handOpForDropTarget\(dOps,/.test(desk));
chk('③桌機：hand-ability 釋放會 dispatch useHandAbility，且 abilityIndex 來自中央 gate',
    /op === 'hand-ability' && benchEmpty/.test(desk)
    && /GameActions\.useHandAbility\(d\.iid,\s*meta\.abilityIndex\)/.test(desk),
    (desk.match(/GameActions\.useHandAbility\([^)]*\)/g) || []).join(','));
chk('③桌機：空備戰格高亮也問中央 dragOpFor(bench-empty)',
    /class:drop-zone=\{dragOpFor\('bench-empty'\)!==null/.test(desk));

// classic / fable：同一份 markup（fable 只是 .playmat 上的 CSS class）
const handCardTplCount = (desk.match(/<div class="hand-card" class:action-busy=\{actionBusy\}/g) || []).length;
chk('③版面：可操作手牌卡 template 只有一份（classic 與 fable 共用）',
    handCardTplCount === 1, String(handCardTplCount));
chk('③版面：fable 是 .playmat 上的純 CSS 版面',
    /class:layout-fable=\{battleLayout === 'fable'\}/.test(desk));
chk('③版面：fable 沒有在手牌區塊裡另開分支', !!blk && !blk.includes('fable'));
chk('③版面：battleLayout 三選一（classic / tabletop / fable）',
    /battleLayout = \$state<'classic' \| 'tabletop' \| 'fable'>/.test(desk));

// 手機直式：沒有卡片拖曳；入口讀中央 gate；不硬編卡名
chk('③手機直式：沒有手牌卡拖曳（走 sheet 選單）',
    !/startDrag\(/.test(mob) && !/type DragKind/.test(mob));
chk('③手機直式：手牌特性入口讀中央 getHandActivatableAbilities（取 abilityName/abilityIndex）',
    /for \(const a of getHandActivatableAbilities\(game, myIdx as 0 \| 1, pool\)\)/.test(mob));
// ⭐v6.201：手機的 handAbilityActivatableIids（第三份判定）已刪除，
//   黃框與 sheet 動作一律讀中央 getHandCardOps()（守衛細節見 test-v6201）。
chk('③手機直式：黃框與動作清單都讀中央 getHandCardOps（不再自帶第三份判定）',
    /getHandCardOps\(game, myIdx as 0 \| 1, pool,/.test(mob)
    && /\{@const playable = _ops\.size > 0\}/.test(mob)
    && !/handAbilityActivatableIids/.test(mob),
    JSON.stringify({ ops: /getHandCardOps\(/.test(mob), playable: /_ops\.size > 0/.test(mob) }));

// v6.125/v6.098 既有鐵律：UI 端禁硬編手牌特性卡名／特性名
const HARDCODED = ['激動俯衝', '緊急迴轉', '烈箭鷹', '齒輪怪'];
/** ③與④共用同一支判準 —— 否則 ④ 驗的是另一段碼，等於沒有正對照 */
function hardcodedHits(src) { return HARDCODED.filter(w => String(src ?? '').includes(w)); }
for (const [label, src] of [['桌機手牌區塊', blk ?? ''], ['手機直式', mob]]) {
  chk(`③${label}：沒有硬編手牌特性卡名／特性名（v6.098/v6.125 鐵律）`,
      hardcodedHits(src).length === 0, JSON.stringify(hardcodedHits(src)));
}

// ══════════════════════════════════════════════════════════════════════════
// ④ 否定型判準的自我驗證（正對照樣本必須被抓到）
// ══════════════════════════════════════════════════════════════════════════
{
  const violating = `<div class="hand-strip">
    {@const canEnergy=isEnergyCard&&game?.phase==='playing'}
    {@const canBasic=isBasicCard&&playableBasicIids.has(inst.iid)}
    {@const canHandActivate = handActivateAbilities.has(inst.iid)}
    {@const dragKind = canEnergy ? 'energy' : canBasic ? 'basic' : null}
  {/key}`;
  const vb = handBlockOf(violating);
  chk('④自我驗證：判準抓得到「第二份可用性判定」樣本', secondPredicateHits(vb).length >= 3,
      JSON.stringify(secondPredicateHits(vb)));
  chk('④自我驗證：硬編卡名判準（③用的同一支）餵違規樣本必須抓得到',
      hardcodedHits(`{@const canHandActivate = c.name === '烈箭鷹ex' && ab.name === '激動俯衝'}`).length >= 2);
  chk('④自我驗證：硬編卡名判準對乾淨樣本不誤報',
      hardcodedHits(`{@const canHandActivate = ops.has('hand-ability')}`).length === 0);
  chk('④自我驗證：乾淨樣本不會誤報',
      secondPredicateHits(`<div class="hand-strip">{@const ops = handCardOps.get(inst.iid) ?? EMPTY_HAND_OPS}{@const canEnergy=ops.has('energy')}{/key}`).length === 0);
  chk('④自我驗證：stripComments 真的會剝掉註解',
      !stripComments('<!-- 激動俯衝 -->x').includes('激動俯衝'));
}


// ══════════════════════════════════════════════════════════════════════════
// ⑤ 行為端求值：把 UI 的 template 表達式**真的執行一次**
//    ⚠「有出現某個字串」≠「拖曳真的會啟動」（v6.154 教訓）。
//    這裡抽出手牌卡的 dragKind / isActionable / onpointerdown / pointerup 的 op 決策，
//    餵「這張手牌唯一能做的事就是 hand-ability」（＝烈箭鷹ex｜激動俯衝 條件成立時的狀態），
//    斷言 (a) 卡片可拖 (b) pointerdown 真的呼叫 startDrag (c) 放到備戰格結算成 hand-ability。
// ══════════════════════════════════════════════════════════════════════════
/** 從 `{@const NAME = ...}` 抽出表達式（大括號配對，不寫死行數） */
function constExpr(block, name) {
  if (!block) return null;
  const i = block.indexOf('{@const ' + name);
  if (i < 0) return null;
  const eq = block.indexOf('=', i);
  if (eq < 0) return null;
  let depth = 1, j = eq + 1;
  while (j < block.length && depth > 0) {
    if (block[j] === '{') depth++;
    else if (block[j] === '}') { depth--; if (depth === 0) break; }
    j++;
  }
  return depth === 0 ? block.slice(eq + 1, j).trim() : null;
}
/** 從 `ATTR={...}` 抽出 handler 原始碼（大括號配對） */
function attrExpr(block, attr) {
  if (!block) return null;
  const i = block.indexOf(attr + '={');
  if (i < 0) return null;
  let depth = 0, j = i + attr.length + 1, start = j;
  while (j < block.length) {
    if (block[j] === '{') depth++;
    else if (block[j] === '}') { depth--; if (depth === 0) return block.slice(start + 1, j); }
    j++;
  }
  return null;
}

// ⚠ 這一區**不依賴新模組是否存在** —— HEAD（沒有中央述詞）也要跑得起來，
//   才能證明「舊 template 求值出來就是拖不動」，而不是只證明「檔案不存在」。
if (blk) {
  const onlyHandAbility = new Set(['hand-ability']);
  // 舊寫法會用到的名字全部餵成「這張卡其他操作都不行」
  const ENV = {
    ops: onlyHandAbility,
    handCardDragKind: M?.handCardDragKind ?? (() => null),
    handCardDraggable: M?.handCardDraggable ?? (() => false),
    handOpForDropTarget: M?.handOpForDropTarget ?? (() => null),
    canEnergy: false, canBasic: false, canFossil: false, canEvolve: false,
    canTrainer: false, isToolCard: false, canHandActivate: true,
  };
  const evalExpr = (expr, extra = {}) => {
    const env = { ...ENV, ...extra };
    const names = Object.keys(env);
    // eslint-disable-next-line no-new-func
    return new Function(...names, 'return (' + expr + ');')(...names.map(n => env[n]));
  };

  const dkExpr = constExpr(blk, 'dragKind');
  chk('⑤anchor：抓得到手牌卡的 dragKind 表達式', !!dkExpr, String(dkExpr));
  let dk = null, dkErr = '';
  try { dk = evalExpr(dkExpr ?? 'null'); } catch (e) { dkErr = String(e); }
  chk('⑤行為端：只有手牌特性可用時，dragKind 必須非 null（v6.199 這裡是 null → 拖不動）',
      dk !== null && dk !== undefined, `dragKind=${JSON.stringify(dk)} ${dkErr}`);
  chk('⑤行為端：class:draggable={dragKind!==null} 會加上 .draggable', dk !== null);

  const iaExpr = constExpr(blk, 'isActionable');
  let ia = null; try { ia = evalExpr(iaExpr ?? 'false'); } catch {}
  chk('⑤行為端：isActionable 已涵蓋手牌特性（黃框與可拖同一支）', ia === true, String(ia));

  // pointerdown handler 真的執行一次
  const pdSrc = attrExpr(blk, 'onpointerdown');
  chk('⑤anchor：抓得到手牌卡的 onpointerdown handler', !!pdSrc && pdSrc.includes('leaveHandCard'), String(pdSrc));
  let startDragCalls = [];
  try {
    const env = {
      ...ENV,
      leaveHandCard: () => {},
      actionBusy: false,
      tActSay: () => {},
      TACT_BLOCKED_MSG: 'blocked',
      startDrag: (...a) => { startDragCalls.push(a); },
      dragKind: dk,
      inst: { iid: 'H1', cardId: '19612' },
      c: { name: '烈箭鷹ex' },
    };
    const names = Object.keys(env);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, 'return (' + pdSrc + ');')(...names.map(n => env[n]));
    fn({ button: 0, clientX: 0, clientY: 0, pointerId: 1, target: null, currentTarget: null });
  } catch (e) { startDragCalls = []; chk('⑤pointerdown 可求值', false, String(e)); }
  chk('⑤行為端：pointerdown 真的呼叫了 startDrag（＝拖曳動畫會出現）',
      startDragCalls.length === 1, JSON.stringify(startDragCalls.length));
  chk('⑤行為端：startDrag 拿到的第 3 個參數就是中央 ops 集合',
      startDragCalls[0]?.[2] === onlyHandAbility, String(startDragCalls[0]?.[2]));

  // pointerup 的 op 決策（釋放在空備戰格）
  const opLine = desk.match(/const op = \(dropZone \? handOpForDropTarget\(dOps, dropZone\) : null\)\s*\?\?\s*handOpForDropTarget\(dOps, 'playmat'\);/);
  chk('⑤anchor：抓得到 pointerup 的 op 決策式', !!opLine, String(opLine));
  let opVal = null;
  if (opLine) {
    // eslint-disable-next-line no-new-func
    opVal = new Function('handOpForDropTarget', 'dOps', 'dropZone',
      opLine[0].replace(/^const op = /, 'return ').replace(/;$/, ';'))(
      ENV.handOpForDropTarget, onlyHandAbility, 'bench-empty');
  }
  chk('⑤行為端：拖到空備戰格 → op 求值為 hand-ability', opVal === 'hand-ability', String(opVal));
  // 正對照：這張卡不可用時（ops 空）→ 不可拖、放哪都不結算
  const empty = new Set();
  let dkEmpty = null; try { dkEmpty = evalExpr(dkExpr ?? 'null', { ops: empty, canHandActivate: false }); } catch {}
  chk('⑤正對照：ops 為空 → dragKind 為 null（不可拖）', dkEmpty === null, String(dkEmpty));
  chk('⑤正對照：ops 為空 → 放到備戰格不結算', ENV.handOpForDropTarget(empty, 'bench-empty') === null);
}


// ⚠ ②整段包在 if (M)、⑤包在 if (blk)：任何一段沒跑，檢查數會無聲縮水。
//   （沒有這條的話「bundle 壞掉」看起來會很像「只有一條紅」。）
const EXPECTED_MIN_CHECKS = 80;
const _total = pass + fail;
if (_total < EXPECTED_MIN_CHECKS) {
  fail++;
  console.log('  ❌ 檢查總數縮水：預期 >=' + EXPECTED_MIN_CHECKS + '，實際 ' + _total
    + '（多半是 bundle 失敗或 anchor 失效，整段檢查被跳過）');
}
console.log(`\n[test-v6200-hand-drag-click-parity] pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
