// ⭐⭐⭐ v6.176 守衛 —— 兩件事：
//   ① 「同一個 iid 跨 zone 各有一份」的幻影卡（v6.175 只做同區去重，抓不到）
//   ② 場上目標型 picker（heal-target / bench-choose / opp-bench-choose / opp-poke-choose）
//      沒宣告 validIids 時完全不經中央消毒閘 —— 改由中央閘用 UI 的同一份述詞兜底
//
// 全部行為端實跑（applyAction / sanitizeSelectedIids），靜態掃描只用在「UI 有沒有真的接上」。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6176-s.js'), E = join(ROOT, '.x6176-e.ts'), O = join(ROOT, '.x6176-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* ignore */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, sanitizeSelectedIids } from './src/lib/game/engine';\n"
  + "export { fieldPickerBaseCandidates, fieldPickerBaseIids, FIELD_TARGET_PICKER_TYPES } from './src/lib/game/selection-candidates';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const ck = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'k' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });

/** 收集某位玩家「每個 iid 出現在哪些位置」（含所有 zone 的巢狀附加物）。 */
function locations(pl) {
  const m = new Map();
  const add = (iid, where) => { if (!m.has(iid)) m.set(iid, []); m.get(iid).push(where); };
  const cnt = (c, where) => {
    add(c.iid, where);
    for (const e of (c.energyAttached || [])) add(e.iid, where + '/' + c.iid + '.energy');
    if (c.toolAttached) add(c.toolAttached.iid, where + '/' + c.iid + '.tool');
    for (const e of (c.extraTools || [])) add(e.iid, where + '/' + c.iid + '.extraTool');
    for (const e of (c.evolvedFromStack || [])) add(e.iid, where + '/' + c.iid + '.stack');
  };
  for (const z of ['hand', 'deck', 'discard', 'prizes']) for (const c of (pl[z] || [])) cnt(c, z);
  if (pl.active) cnt(pl.active, 'active');
  for (const b of (pl.bench || [])) cnt(b, 'bench');
  return m;
}
const crossZoneDups = (st) => st.players.flatMap((pl, i) =>
  [...locations(pl).entries()].filter(([, v]) => v.length > 1).map(([iid, v]) => `P${i}:${iid}@${v.join('+')}`));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── A. 獵斑魚｜潛者捕捉：跨 zone 不得出現同一個 iid 兩份 ──');
// 卡面（static/cards）：「【昏厥】的寶可夢身上附加的『基本【水】能量』卡不丟棄，而是全部放回手牌。」
// ⚠ 實作**刻意**讓那些能量在玩家確認前留在昏厥實例上（巢狀）、不進扁平清單 —— 那是有意義的暫存。
//   所以去重只能刪「別處已經有一份」的幻影，絕不能順手把暫存攤平（會讓能量提早進棄牌區）。
{
  const CID = { sakura: '12775', relicanth: '12774', onix: '13979', waterE: '18519', charz: '13163' };
  const wE = () => inst(CID.waterE);
  const base = () => mod.createGame({ name: 'P1', entries: [{ cardId: CID.charz, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.charz, count: 1 }] }, pool);
  const setup = () => {
    const g = base();
    return { ...g, phase: 'playing', turnPhase: 'main', activePlayerIndex: 1, firstPlayerIdx: 0,
      isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
      players: [
        { ...g.players[0], hand: [], deck: [inst(CID.charz)], discard: [], prizes: [inst(CID.charz)],
          bench: [inst(CID.relicanth), inst(CID.charz)], active: inst(CID.sakura, { energyAttached: [wE(), wE()] }) },
        { ...g.players[1], hand: [], deck: [inst(CID.charz)], discard: [], prizes: Array.from({ length: 6 }, () => inst(CID.charz)),
          bench: [], active: inst(CID.onix, { energyAttached: [wE(), wE(), wE(), wE()] }) },
      ] };
  };
  const atkIdx = pool.get(CID.onix).attacks.findIndex(a => a.name === '怪力');
  const opened = mod.applyAction(setup(), { type: 'ATTACK', attackIndex: atkIdx }, pool);
  ck('潛者捕捉確認選單有開起來（fixture 有效）', opened.pendingSelection?.effectKey === 'diver-catch-confirm');
  ck('★★★ 確認未決時**不得**去重掉暫存能量（那是刻意保留的巢狀暫存）',
    crossZoneDups(opened).length === 0, JSON.stringify(crossZoneDups(opened)));
  ck('★ 確認未決時暫存能量既不在棄牌也不在手牌（v5.918 的設計沒被破壞）',
    opened.players[0].discard.every(c => String(c.cardId) !== CID.waterE)
    && opened.players[0].hand.every(c => String(c.cardId) !== CID.waterE));
  const tok = opened.pendingSelection?.token;
  const yes = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', effectKey: 'diver-catch-confirm', selectedIids: ['yes'], actorIdx: 0, pendingToken: tok }, pool);
  ck('★★★ 選「是」→ 能量回手牌，且**沒有**任何 iid 同時留在棄牌區的昏厥實例上',
    crossZoneDups(yes).length === 0, JSON.stringify(crossZoneDups(yes)));
  ck('★ 選「是」→ 2 張基本【水】能量確實在手牌（沒有被去重誤刪）',
    yes.players[0].hand.filter(c => String(c.cardId) === CID.waterE).length === 2,
    String(yes.players[0].hand.filter(c => String(c.cardId) === CID.waterE).length));
  const no = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', effectKey: 'diver-catch-confirm', selectedIids: ['no'], actorIdx: 0, pendingToken: tok }, pool);
  ck('★★★ 選「否」→ 一樣沒有跨區重複（v6.175 的同區去重不得退化）',
    crossZoneDups(no).length === 0, JSON.stringify(crossZoneDups(no)));
  ck('★ 選「否」→ 2 張能量在棄牌區（沒被去重吃掉）',
    no.players[0].discard.filter(c => String(c.cardId) === CID.waterE).length === 2);
  // 正對照：人工塞一個跨區幻影（手牌扁平 + 棄牌區巢狀），做任意 action 後必須自癒
  {
    const g = base();
    const ghost = inst(CID.waterE);
    const st = { ...g, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
      isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
      players: [
        { ...g.players[0], hand: [ghost], deck: [inst(CID.charz), inst(CID.charz)], prizes: [inst(CID.charz)],
          discard: [inst(CID.sakura, { energyAttached: [{ ...ghost }] })], bench: [], active: inst(CID.charz) },
        { ...g.players[1], hand: [], deck: [inst(CID.charz)], discard: [], prizes: [inst(CID.charz)], bench: [], active: inst(CID.charz) },
      ] };
    ck('★ 正對照：人工幻影確實被判定為跨區重複（判準抓得到）', crossZoneDups(st).length === 1, JSON.stringify(crossZoneDups(st)));
    const healed = mod.applyAction(st, { type: 'END_TURN', actorIdx: 0 }, pool);
    ck('★★★ 既有幻影局：做任意 action（applyAction 單一出口）會自癒', crossZoneDups(healed).length === 0, JSON.stringify(crossZoneDups(healed)));
    ck('★★★ 自癒時刪的是**巢狀那份**、手牌那份留著（只刪幻影不搬卡）',
      healed.players[0].hand.some(c => c.iid === ghost.iid)
      && healed.players[0].discard.every(c => (c.energyAttached || []).every(e => e.iid !== ghost.iid)));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── B. 中央消毒閘：場上目標型 picker 沒宣告 validIids 時也不再裸奔 ──');
{
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P0', active: inst('16829'), bench: [inst('13982')], hand: [inst('17122')], deck: [inst('17122')], discard: [inst('17220')], prizes: [] },
      { name: 'P1', active: inst('16829'), bench: [inst('13982'), inst('13982')], hand: [], deck: [inst('13133')], discard: [], prizes: [] },
    ],
  };
  const p0 = st.players[0], p1 = st.players[1];
  const mk = (type, srcIdx, params) => ({ type, actorIdx: 0, sourcePlayerIdx: srcIdx, minCount: 1, maxCount: 1, effectKey: 'x', params });
  const san = (pending, iids) => mod.sanitizeSelectedIids(st, pending, iids, pool);

  ck('★★★ opp-poke-choose：送**棄牌區能量**的 iid（沸騰鬥志災難的形狀）必須被濾成空',
    san(mk('opp-poke-choose', 1, {}), [p0.discard[0].iid]).length === 0);
  ck('★★★ opp-poke-choose：送**自己場上**的 iid（打錯邊）必須被濾成空',
    san(mk('opp-poke-choose', 1, {}), [p0.active.iid]).length === 0);
  ck('★ opp-poke-choose：對手戰鬥位與備戰都放行（不得比 UI 嚴）',
    san(mk('opp-poke-choose', 1, {}), [p1.active.iid, p1.bench[0].iid]).length === 2);
  ck('★★★ bench-choose（無 includeActive）：戰鬥位不得被勾中（UI 本來就沒列它）',
    san(mk('bench-choose', 0, {}), [p0.active.iid]).length === 0);
  ck('★ bench-choose + includeActive：戰鬥位放行', san(mk('bench-choose', 0, { includeActive: true }), [p0.active.iid]).length === 1);
  ck('★ heal-target：自己戰鬥位 + 備戰都放行', san(mk('heal-target', 0, {}), [p0.active.iid, p0.bench[0].iid]).length === 2);
  ck('★★★ heal-target：送手牌 iid 必須被濾', san(mk('heal-target', 0, {}), [p0.hand[0].iid]).length === 0);
  ck('★★★ opp-bench-choose：對手戰鬥位不得被勾中（卡面說的是備戰）',
    san(mk('opp-bench-choose', 1, {}), [p1.active.iid]).length === 0);
  ck('★ 有宣告 validIids 時仍以宣告為準（兜底不得蓋掉逐卡宣告）',
    san(mk('opp-poke-choose', 1, { validIids: [p1.bench[0].iid] }), [p1.active.iid, p1.bench[0].iid]).length === 1);
  ck('★ 不在四型內的 pending 不受影響（hand-choose 無 validIids → 原封放行）',
    san({ type: 'hand-choose', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1, effectKey: 'x' }, ['whatever']).length === 1);
  ck('★ UI 述詞與中央閘同源：fieldPickerBaseIids 對四型的輸出就是白名單',
    mod.fieldPickerBaseIids('opp-poke-choose', p1).join(',') === [p1.active.iid, ...p1.bench.map(b => b.iid)].join(','));
  ck('★ FIELD_TARGET_PICKER_TYPES 涵蓋四型', ['heal-target', 'bench-choose', 'opp-bench-choose', 'opp-poke-choose']
    .every(t => mod.FIELD_TARGET_PICKER_TYPES.has(t)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── C. 冰伊布ex｜藍柱石：卡面「身上放置有 6 個傷害指示物的」是目標條件 ──');
{
  const ice = [...pool.values()].find(c => c.name === '冰伊布ex' && (c.attacks || []).some(a => a.name === '藍柱石'));
  ck('fixture：找得到 冰伊布ex｜藍柱石', !!ice);
  if (ice) {
    const ai = ice.attacks.findIndex(a => a.name === '藍柱石');
    // 招式費用【草】【水】【惡】——用真正對得上的基本能量，不然 canAffordAttack 會擋掉整個測試
    const basicOf = (zh) => [...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes(zh));
    const eCost = ['【草】', '【水】', '【惡】'].map(z => inst(String(basicOf(z).id)));
    // 對手：戰鬥位剛好 60（=6 個指示物）、備戰A 剛好 60、備戰B 只有 30（不符）
    const st = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingPrizes: [0, 0],
      players: [
        { name: 'P0', active: inst(String(ice.id), { energyAttached: eCost }),
          bench: [], hand: [], deck: [inst('17122')], discard: [], prizes: [inst('17122'), inst('17122')] },
        { name: 'P1', active: inst('16829', { damage: 60 }), bench: [inst('13982', { damage: 60 }), inst('13982', { damage: 30 })],
          hand: [], deck: [inst('13133')], discard: [], prizes: [inst('13133')] },
      ],
    };
    const s = mod.applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, pool);
    ck('藍柱石開 opp-poke-choose（多個候選）', s.pendingSelection?.effectKey === 'lanzhushi-ko', String(s.pendingSelection?.effectKey));
    const vi = s.pendingSelection?.params?.validIids;
    ck('★★★ pending 帶 validIids，且**只有剛好 6 個指示物**的那兩隻',
      Array.isArray(vi) && vi.length === 2
      && vi.includes(st.players[1].active.iid) && vi.includes(st.players[1].bench[0].iid),
      JSON.stringify(vi));
    ck('★★★ 不符條件的那隻（30 傷害）不在 validIids —— 但它本來就不該被玩家勾到',
      Array.isArray(vi) && !vi.includes(st.players[1].bench[1].iid));
    const bad = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [st.players[1].bench[1].iid], actorIdx: 0, pendingToken: s.pendingSelection?.token }, pool);
    ck('★★★ 勾不符條件的目標 → 不得被昏厥（中央閘濾成空）',
      bad.players[1].bench.some(b => b.iid === st.players[1].bench[1].iid));
    const ok = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [st.players[1].bench[0].iid], actorIdx: 0, pendingToken: s.pendingSelection?.token }, pool);
    ck('★ 合法目標仍可正常昏厥（validIids 沒有比卡面嚴）',
      !ok.players[1].bench.some(b => b.iid === st.players[1].bench[0].iid));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── D. 振翼髮｜蠱惑挪移：卡面「自己的備戰區的『古代』寶可夢」 ──');
{
  const bird = [...pool.values()].find(c => c.name === '振翼髮' && (c.attacks || []).some(a => a.name === '蠱惑挪移'));
  const ancient = [...pool.values()].find(c => c.supertype === 'Pokemon' && (c.tags || []).includes('古代') && c.name !== '振翼髮');
  const plain = [...pool.values()].find(c => c.supertype === 'Pokemon' && !(c.tags || []).includes('古代') && (c.stage === 'Basic' || c.subtype === 'Basic'));
  ck('fixture：找得到 振翼髮｜蠱惑挪移 + 一張古代 + 一張非古代', !!bird && !!ancient && !!plain);
  if (bird && ancient && plain) {
    const ai = bird.attacks.findIndex(a => a.name === '蠱惑挪移');
    const ancientInst = inst(String(ancient.id), { damage: 30 });
    const plainInst = inst(String(plain.id), { damage: 50 });
    const st = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingPrizes: [0, 0],
      players: [
        { name: 'P0', active: inst(String(bird.id), { energyAttached: [inst('18519'), inst('18519')] }),
          bench: [ancientInst, plainInst], hand: [], deck: [inst('17122')], discard: [], prizes: [inst('17122')] },
        { name: 'P1', active: inst('16829'), bench: [], hand: [], deck: [inst('13133')], discard: [], prizes: [inst('13133')] },
      ],
    };
    const s = mod.applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, pool);
    ck('蠱惑挪移開 bench-choose', s.pendingSelection?.effectKey === 'h-wave3-move-bench-dmg-to-opp-active', String(s.pendingSelection?.effectKey));
    const vi = s.pendingSelection?.params?.validIids;
    ck('★★★ pending 帶 validIids 且只有「古代」那隻', Array.isArray(vi) && vi.length === 1 && vi[0] === ancientInst.iid, JSON.stringify(vi));
    const bad = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [plainInst.iid], actorIdx: 0, pendingToken: s.pendingSelection?.token }, pool);
    ck('★★★ 勾非古代的備戰 → 指示物不得被搬走（原本 resolver 完全沒檢查古代）',
      (bad.players[0].bench.find(b => b.iid === plainInst.iid)?.damage ?? 0) === 50
      && (bad.players[1].active?.damage ?? 0) === 0);
    const ok = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [ancientInst.iid], actorIdx: 0, pendingToken: s.pendingSelection?.token }, pool);
    ck('★ 勾古代那隻仍正常結算（沒有比卡面嚴）',
      (ok.players[0].bench.find(b => b.iid === ancientInst.iid)?.damage ?? 99) === 0 && (ok.players[1].active?.damage ?? 0) === 30,
      `bench=${ok.players[0].bench.find(b => b.iid === ancientInst.iid)?.damage} opp=${ok.players[1].active?.damage}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── E. UI 接線：picker 顯示的候選必須來自跟中央閘同一份述詞 ──');
{
  const raw = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const src = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/[​-‍﻿]/g, '');
  ck('★ selectionCandidates 有 import 中央述詞（沒 import = runtime 炸彈）',
    /import \{[^}]*fieldPickerBaseCandidates[^}]*\} from '\$lib\/game\/selection-candidates'/.test(src));
  for (const t of ['bench-choose', 'opp-poke-choose', 'opp-bench-choose', 'heal-target']) {
    const i = src.indexOf(`case '${t}':`);
    const blk = i >= 0 ? src.slice(i, i + 700) : '';
    ck(`★★★ case '${t}' 的候選來自 fieldPickerBaseCandidates`, i >= 0 && blk.includes('fieldPickerBaseCandidates'), blk.slice(0, 160));
  }
  ck('★ 掃描器正對照：舊寫法（自己 inline 拼 active+bench）必須被判為未接上',
    !"case 'heal-target': { const all = [...(src.active?[src.active]:[]), ...src.bench]; }".includes('fieldPickerBaseCandidates'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── F. 棘輪：minCount>=1 卻沒宣告 validIids 的場上目標型 picker ──');
// ⚠ v6.175 的掃描器用「effectKey 往前 1500 字元找第一個 type:」+「blk.includes(validIids)」，
//   兩者都會抓到**鄰居物件**的欄位（假陽性）也會漏掉（真陰性），而且 dedupe by key
//   ⇒ 同一個 key 有 10 個 producer 時只看得到 1 個。這裡改成：
//     ・先 mask 掉註解/字串/模板（括號配對不受 `${}` 干擾）
//     ・從 effectKey 錨點**往回**做括號配對，取出**該物件**的完整字面量
//     ・逐 occurrence 統計（不 dedupe），數字才誠實
{
  const FIELD = new Set(['heal-target', 'bench-choose', 'opp-bench-choose', 'opp-poke-choose']);
  const walk = (d, acc = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const fp = join(d, e.name);
      if (e.isDirectory()) walk(fp, acc); else if (e.name.endsWith('.ts')) acc.push(fp);
    }
    return acc;
  };
  function mask(s0) {
    const a = s0.split(''); const n = a.length; let i = 0;
    const blank = (st2, en) => { for (let k = st2; k < en && k < n; k++) if (a[k] !== '\n') a[k] = ' '; };
    while (i < n) {
      const c = s0[i];
      if (c === '/' && s0[i + 1] === '/') { let j = s0.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue; }
      if (c === '/' && s0[i + 1] === '*') { let j = s0.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue; }
      if (c === "'" || c === '"') { let j = i + 1; while (j < n) { if (s0[j] === '\\') { j += 2; continue; } if (s0[j] === c || s0[j] === '\n') break; j++; } blank(i + 1, j); i = j + 1; continue; }
      if (c === '`') { let j = i + 1, d2 = 0; while (j < n) { if (s0[j] === '\\') { j += 2; continue; } if (s0[j] === '$' && s0[j + 1] === '{') { d2++; j += 2; continue; } if (s0[j] === '}' && d2 > 0) { d2--; j++; continue; } if (s0[j] === '`' && d2 === 0) break; j++; } blank(i + 1, j); i = j + 1; continue; }
      i++;
    }
    return a.join('');
  }
  const scanFile = (raw) => {
    const s0 = raw.replace(/[​-‍﻿]/g, '');
    const m = mask(s0);
    const res = [];
    for (const mm of s0.matchAll(/effectKey:\s*'([^']+)'/g)) {
      const at = mm.index;
      if (m[at] !== 'e') continue;                      // 被 mask 掉 = 註解/字串裡
      let depth = 0, start = -1;
      for (let i = at; i >= 0; i--) { const ch = m[i]; if (ch === '}') depth++; else if (ch === '{') { if (depth === 0) { start = i; break; } depth--; } }
      if (start < 0) continue;
      let d2 = 0, end = -1;
      for (let i = start; i < m.length; i++) { const ch = m[i]; if (ch === '{') d2++; else if (ch === '}') { d2--; if (d2 === 0) { end = i; break; } } }
      if (end < 0) continue;
      const objM = m.slice(start, end + 1), obj = s0.slice(start, end + 1);
      const tm = objM.match(/(?:^|[\s,{])type:\s*'/);
      if (!tm) continue;
      const p = start + tm.index + tm[0].length;
      const type = s0.slice(p, s0.indexOf("'", p));
      if (!FIELD.has(type)) continue;
      const mc = obj.match(/minCount:\s*([^,\n}]+)/);
      res.push({ key: mm[1], type, minCount: mc ? mc[1].trim() : '?', hasValid: /validIids/.test(obj) });
    }
    return res;
  };
  const all = [];
  for (const f of walk(join(ROOT, 'src/lib/game'))) all.push(...scanFile(readFileSync(f, 'utf8')).map(r => ({ ...r, file: f })));
  ck('★ 掃描器有掃到東西（下限：場上目標型 pending occurrence >= 180）', all.length >= 180, `掃到 ${all.length}`);
  // 掃描器自我驗證（正對照 + 反對照）：兩個樣本都必須被正確歸類
  {
    const good = scanFile("x(y, {\n  type: 'heal-target',\n  minCount: 1,\n  effectKey: 'sample-good',\n  params: { validIids: z },\n});\n");
    const bad = scanFile("x(y, {\n  type: 'heal-target',\n  minCount: 1,\n  effectKey: 'sample-bad',\n  params: { healAmount: 30 },\n});\n");
    ck('★ 掃描器正對照：宣告了 validIids 的樣本必須被判為已宣告', good.length === 1 && good[0].hasValid === true);
    ck('★ 掃描器反對照：沒宣告的樣本必須被判為未宣告', bad.length === 1 && bad[0].hasValid === false);
    // 鄰居污染對照：v6.175 掃描器會把上一個物件的 validIids 算到下一個頭上
    const nb = scanFile("a({ type: 'heal-target', minCount: 1, effectKey: 'nb-1', params: { validIids: q } });\n"
      + "b({ type: 'heal-target', minCount: 1, effectKey: 'nb-2', params: { healAmount: 1 } });\n");
    ck('★★ 掃描器不得被**鄰居**的 validIids 污染（v6.175 的假陰性來源）',
      nb.length === 2 && nb[0].hasValid === true && nb[1].hasValid === false, JSON.stringify(nb.map(x => [x.key, x.hasValid])));
  }
  const naked = all.filter(r => !String(r.minCount).startsWith('0') && !r.hasValid);
  // ⚠ 這條棘輪只保證「不准變多」。中央閘（B 段）已讓這些 picker 不再裸奔，
  //   但**卡面比「該側場上」窄**的那些仍必須逐張宣告 validIids —— 那是接下來幾輪的工作。
  ck('★★★ 「minCount>=1 卻沒宣告 validIids」的場上目標型 picker 不得增加（棘輪 <= 110）',
    naked.length <= 110, `目前 ${naked.length} 個：${naked.slice(0, 6).map(x => x.key).join(', ')}…`);
  for (const k of ['lanzhushi-ko', 'h-wave3-move-bench-dmg-to-opp-active', 'greninja-shuriken-6']) {
    ck(`★ 已補的不准退回名單：${k}`, !naked.some(r => r.key === k));
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.176 跨區 iid 去重 / 場上目標 picker 中央閘：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
