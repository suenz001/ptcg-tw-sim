/**
 * ⭐⭐⭐ v6.331 守衛 — modal-choice 的空／對不上任何選項的 payload
 *
 * 玩家回報：「modal-choice 選擇為空（取消）時，卡片已經消耗掉了，什麼都不做。」
 * 實跑重現（BASE 041d7d6d，奇異時鐘 step2、胡地堆疊深度 2）：
 *   送 selectedIids: [] ⇒ pendingSelection 被關掉、胡地一層都沒退、奇異時鐘已在棄牌區。
 *
 * 為什麼 v6.010 / v6.174 / v6.175 三道既有閘都攔不到：
 *   modal-choice 在 `VALID_IIDS_GATE_EXEMPT` 名單裡（payload 是選項 id 不是 iid，必須原封放行），
 *   而 v6.175 的 reject 分支要求 `_rawIids.length > 0` —— 真正的空陣列直接穿過去。
 *
 * 本守衛全部是**行為端**斷言（RULE #2）：跑真的 applyAction 管線，不做字串比對；
 * 只有 D 段的三條是結構鎖，且都先剝註解（v6.126 / v6.312 的教訓）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6331-s.js'), E = join(ROOT, '.v6331-e.ts'), O = join(ROOT, '.v6331-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

writeFileSync(S, 'export const base="";');
writeFileSync(E, [
  "export { applyAction } from './src/lib/game/engine';",
  "export { TRAINER_EFFECTS } from './src/lib/game/effects/_shared';",
  "export * as SEL from './src/lib/game/selection-ui';",
  "import './src/lib/game/effects';",
].join('\n'));
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);
const SEL = mod.SEL;
// ⚠ HEAD-FAIL 用：BASE 上這些中央述詞根本不存在。直接呼叫會 throw ⇒ 整支守衛在第一條就爆掉，
//   後面 40 條（含真正的行為端證明）永遠跑不到，那樣的「紅」證明不了每一條都在做事。
//   ⇒ 缺席時回一個絕不等於 true/false 的哨兵，讓**每一條**各自誠實翻紅。
const MISSING = Symbol('missing');
const F = (n) => (typeof SEL?.[n] === 'function' ? SEL[n] : () => MISSING);
const modalChoicePayloadValid = F('modalChoicePayloadValid');
const modalChoiceCandidateCount = F('modalChoiceCandidateCount');
const modalChoiceEnabledOptions = F('modalChoiceEnabledOptions');
const aiStuckSelectionPayload = F('aiStuckSelectionPayload');
const selectionHasNoExit = F('selectionHasNoExit');

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n) => [...pool.values()].filter((c) => c.name === n && ['H', 'I', 'J'].includes(c.regulationMark))[0];

// ════════════════════════════════════════════════════════════════════
console.log('\n【A】中央純述詞 modalChoicePayloadValid / candidateCount');
// ════════════════════════════════════════════════════════════════════
const OPTS = { options: [{ id: 'yes', text: '是' }, { id: 'no', text: '否' }] };
ok(modalChoicePayloadValid(OPTS, []) === false, 'A1 空 payload ＋ 有選項 ⇒ 無效');
ok(modalChoicePayloadValid(OPTS, [undefined]) === false, 'A2 [undefined]（字串陣列 options 造成的形狀）⇒ 無效');
ok(modalChoicePayloadValid(OPTS, ['nope']) === false, 'A3 不存在的選項 id ⇒ 無效');
ok(modalChoicePayloadValid(OPTS, ['yes']) === true, 'A4 合法選項 id ⇒ 有效');
const MIXED = { options: [{ id: 'a', text: 'a' }, { id: 'x', text: 'x', disabled: true }] };
const MIXED_DISABLED_FIRST = { options: [{ id: 'x', text: 'x', disabled: true }, { id: 'b', text: 'b' }] };
const MIXED_DISABLED_ONLY = { options: [{ id: 'x', text: 'x', disabled: true }] };
ok(modalChoicePayloadValid(MIXED, ['x']) === false, 'A5 還有可按的選項時，disabled 的那個不能被送進來');
ok(modalChoicePayloadValid(MIXED, ['a']) === true, 'A5b 同一組裡 enabled 的那個照常有效');
ok(modalChoicePayloadValid(MIXED, []) === false, 'A5c 還有可按的選項時，空 payload 仍然無效');
ok(modalChoicePayloadValid({ options: [{ id: 'x', text: 'x', disabled: true }] }, []) === true,
  'A5d **全部**選項都 disabled ⇒ 玩家一顆都按不下去 ⇒ 空 payload 必須放行（逃生口）');
ok(modalChoicePayloadValid({ options: [] }, []) === true, 'A6 零選項 ⇒ 放行（空 payload 是唯一出口，不可製造軟鎖）');
ok(modalChoicePayloadValid({}, []) === true, 'A7 完全沒有 options 欄位 ⇒ 放行');
ok(modalChoicePayloadValid({ stepper: { min: 10, max: 200 } }, ['100']) === true, 'A8 stepper 範圍內 ⇒ 有效');
ok(modalChoicePayloadValid({ stepper: { min: 10, max: 200 } }, ['999']) === false, 'A9 stepper 超出上限 ⇒ 無效');
ok(modalChoicePayloadValid({ stepper: { min: 10, max: 200 } }, []) === false, 'A10 stepper 空 payload ⇒ 無效');
ok(modalChoiceCandidateCount(OPTS) === 2 && modalChoiceCandidateCount({ options: [] }) === 0
  && modalChoiceCandidateCount({ stepper: { min: 0, max: 1, step: 1, init: 0 } }) === 1,
  'A11 candidateCount：options 2／空 0／stepper 1');
// ⚠ 這一段是「反安慰劑自檢」：呼叫的是與引擎完全同一個函式（不是把判準再抄一次）
ok(modalChoiceEnabledOptions({ options: ['確認結束回合'] }).length === 0,
  'A12 字串陣列 options 不算任何可用選項（＝小霞的朝氣的舊形狀）');
ok((SEL.modalChoiceAllOptions?.({ options: [{ id: 2, text: 'x' }] }) ?? ['x']).length === 0,
  'A12b 非字串的 option id 不算合法選項（payload 是字串，`===` 永遠對不上 ⇒ 會被誤擋）');
// ⚠⚠ 以下三條鎖住「disabled 的過濾只有一份」：對抗性審查實測，把中央
//   modalChoiceEnabledOptions 的 disabled 過濾拿掉，本檔原本 43 條**全部照樣綠**
//   （因為 modalChoicePayloadValid 當時把同一個判準就地又寫了一次）＝安慰劑。
ok(modalChoiceCandidateCount(MIXED) === 1,
  'A12c candidateCount 不把 disabled 算成候選（算進去 ⇒ 全 disabled 時不長放棄鈕＝畫面鎖死）');
ok(modalChoiceCandidateCount(MIXED_DISABLED_ONLY) === 0, 'A12d 全部 disabled ⇒ 候選數 0');
ok(JSON.stringify(aiStuckSelectionPayload({ type: 'modal-choice', params: MIXED_DISABLED_FIRST })) === '["b"]',
  'A12e AI 保險絲要跳過 disabled（送 disabled 的 id 會被自己的中央閘退回，白繞好幾拍）');

console.log('\n【A-2】selectionHasNoExit 對 modal-choice 改讀 params.options');
const mkSel = (params) => ({ type: 'modal-choice', actorIdx: 0, sourcePlayerIdx: 0, effectKey: 'x', minCount: 1, params });
ok(selectionHasNoExit(mkSel(OPTS), 0) === false,
  'A13 有 2 個選項時**不**判成「沒有出口」（UI 才不會多長一顆放棄鈕）');
ok(selectionHasNoExit(mkSel({ options: [] }), 0) === true, 'A14 零選項 ⇒ 判成沒有出口 ⇒ UI 給放棄鈕');
ok(selectionHasNoExit({ type: 'bench-choose', actorIdx: 0, sourcePlayerIdx: 0, effectKey: 'x', minCount: 1 }, 0) === true,
  'A15 非 modal-choice：候選 0 ⇒ 沒有出口（零回歸）');
// ⚠ A15 只餵 candidateCount=0，證明不了「非 modal-choice 仍讀 candidateCount」——
//   把三元式改成一律讀 params，A13~A15 照樣全綠（對抗性審查實測）。A15b 才是那一條的鎖。
ok(selectionHasNoExit({ type: 'bench-choose', actorIdx: 0, sourcePlayerIdx: 0, effectKey: 'x', minCount: 1 }, 3) === false,
  'A15b 非 modal-choice：candidateCount>0 ⇒ 有出口（述詞不可以改成一律讀 params.options）');
ok(selectionHasNoExit(mkSel({ options: [] }), 5) === true,
  'A15c modal-choice：呼叫端傳什麼 candidateCount 都不算數，一律以 params.options 為準');
ok(selectionHasNoExit(mkSel(MIXED_DISABLED_ONLY), 0) === true,
  'A15d modal-choice：選項全部 disabled ⇒ 一顆都按不下去 ⇒ 判成沒有出口（給放棄鈕）');

console.log('\n【A-3】AI 無進展保險絲 payload');
ok(JSON.stringify(aiStuckSelectionPayload(mkSel(OPTS))) === '["yes"]', 'A16 modal-choice ⇒ 第一個可用選項');
ok(JSON.stringify(aiStuckSelectionPayload(mkSel({ stepper: { min: 10, max: 200, step: 10, init: 100 } }))) === '["100"]',
  'A17 stepper ⇒ init');
ok(JSON.stringify(aiStuckSelectionPayload({ type: 'deck-search', params: {} })) === '[]',
  'A18 非 modal-choice ⇒ 維持空陣列（零回歸）');
ok(JSON.stringify(aiStuckSelectionPayload(mkSel({ options: [] }))) === '[]', 'A19 零選項 ⇒ 空陣列（唯一出口）');

// ════════════════════════════════════════════════════════════════════
console.log('\n【B】行為端：真的跑 applyAction 管線（奇異時鐘 → 胡地 深度 2）');
// ════════════════════════════════════════════════════════════════════
const kasei = byName('凱西'), yung = byName('勇基拉'), abra2 = byName('胡地'), clock = byName('奇異時鐘');
if (!kasei || !yung || !abra2 || !clock) { console.log('  FAIL 前置：找不到 凱西/勇基拉/胡地/奇異時鐘'); fail++; }
let n = 0; const I = () => `v6331_${++n}`;
const inst = (cid, extra = {}) => ({ iid: I(), cardId: String(cid), damage: 0, energyAttached: [], ...extra });

function openOddClockStep2() {
  const target = inst(abra2.id, { evolvedFromStack: [{ iid: I(), cardId: String(kasei.id) }, { iid: I(), cardId: String(yung.id) }] });
  const card = inst(clock.id);
  let st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: undefined, setupDone: [true, true],
    players: [
      { name: 'A', active: target, bench: [], hand: [card], deck: [inst(kasei.id)], discard: [], prizes: [] },
      { name: 'B', active: inst(kasei.id), bench: [], hand: [], deck: [inst(kasei.id)], discard: [], prizes: [] },
    ],
  };
  st = mod.applyAction(st, { type: 'PLAY_TRAINER', iid: card.iid, actorIdx: 0 }, pool);
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [target.iid], actorIdx: 0, pendingToken: st.pendingSelection?.token }, pool);
  return { st, targetIid: target.iid };
}
const resolve = (st, iids) => mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: 0, pendingToken: st.pendingSelection?.token }, pool);
const activeOf = (st) => st.players[0].active;

{
  const { st } = openOddClockStep2();
  // 前置斷言（防「對空集合做否定斷言＝恆真安慰劑」，v6.330 的教訓）
  ok(st.pendingSelection?.effectKey === 'odd-clock-step2'
    && (st.pendingSelection?.params?.options ?? []).length === 2,
    'B0 前置：真的開出 odd-clock-step2 且有 2 個選項');

  const before = JSON.stringify(activeOf(st));
  const s1 = resolve(st, []);
  ok(s1.pendingSelection?.effectKey === 'odd-clock-step2', 'B1 送空選擇 ⇒ pending **留在原地**（玩家可以重選）');
  ok(JSON.stringify(activeOf(s1)) === before, 'B2 送空選擇 ⇒ 盤面完全沒動');

  const s2 = resolve(st, ['no-such-option']);
  ok(s2.pendingSelection?.effectKey === 'odd-clock-step2', 'B3 送不存在的選項 id ⇒ pending 留在原地');

  const s3 = resolve(st, ['2']);
  ok(s3.pendingSelection == null, 'B4 送合法選項 ⇒ pending 正常關閉（不可過度阻擋）');
  ok(pool.get(activeOf(s3)?.cardId)?.name === '凱西', 'B5 送 "2" ⇒ 真的退化兩層變成凱西');
}

{
  // streak 上限：連續送空不可以永遠擋住（軟鎖比卡片白費更嚴重）
  let { st } = openOddClockStep2();
  let opened = 0;
  for (let i = 0; i < 6; i++) {
    st = resolve(st, []);
    if (st.pendingSelection?.effectKey === 'odd-clock-step2') opened++;
    else break;
  }
  ok(st.pendingSelection == null, `B6 連續送空最終一定放行（不軟鎖）— 擋了 ${opened} 次後放行`);
  ok(opened >= 1 && opened <= 5, `B7 擋下的次數受上限拘束（實測 ${opened} 次）`);
}

{
  // 零選項的 modal-choice：空 payload 必須放行，否則畫面鎖死
  const { st } = openOddClockStep2();
  const stub = { ...st, pendingSelection: { ...st.pendingSelection, params: { ...st.pendingSelection.params, options: [] } } };
  const s = resolve(stub, []);
  ok(s.pendingSelection == null, 'B8 零選項的 modal-choice 送空 ⇒ 放行（不製造新軟鎖）');
}

console.log('\n【B-2】小霞的朝氣：options 必須是 {id,text} 物件（舊版是字串 ⇒ 空白按鈕）');
{
  const karu = byName('小霞的朝氣');
  ok(!!karu, 'B9 前置：找到 小霞的朝氣');
  const card = inst(karu.id);
  let st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: undefined, setupDone: [true, true],
    players: [
      { name: 'A', active: inst(kasei.id), bench: [], hand: [card], deck: [], discard: [], prizes: [] },
      { name: 'B', active: inst(kasei.id), bench: [], hand: [], deck: [inst(kasei.id)], discard: [], prizes: [] },
    ],
  };
  const fn = mod.TRAINER_EFFECTS.get('小霞的朝氣');
  ok(typeof fn === 'function', 'B10 前置：小霞的朝氣 有實作');
  const s = fn(st, 0, pool);
  const opts = s.pendingSelection?.params?.options ?? [];
  ok(s.pendingSelection?.effectKey === 'm5-trainer-karunari-vigor-end-only' && opts.length === 1,
    'B11 前置：牌庫為空 ⇒ 開出「僅結束回合」的 modal-choice');
  ok(opts.every((o) => o && typeof o === 'object' && typeof o.id === 'string' && o.id
    && typeof o.text === 'string' && o.text.length > 0),
    'B12 選項是 {id,text} 物件且文字非空（舊版是字串 ⇒ UI 渲染出沒有文字的空白按鈕）');
  ok(modalChoicePayloadValid(s.pendingSelection?.params, [opts[0]?.id]) === true,
    'B13 UI 會送出的 opt.id 通得過中央閘（否則玩家會被自己的按鈕擋住）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n【C】全站掃描：modal-choice 的 options 陣列字面量元素必須是物件');
// ════════════════════════════════════════════════════════════════════
{
  const srcDir = join(ROOT, 'src/lib/game');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : (e.name.endsWith('.ts') ? [join(d, e.name)] : []));
  const bad = [];
  for (const f of walk(srcDir)) {
    const stripped = stripCommentsBlankChecked(readFileSync(f, 'utf8'));
    for (const m of stripped.matchAll(/options:\s*\[\s*(['"`])/g)) {
      bad.push(`${f.slice(ROOT.length)}:${stripped.slice(0, m.index).split('\n').length}`);
    }
  }
  ok(bad.length === 0, `C1 沒有任何 options 直接寫成字串陣列${bad.length ? ' ⇒ ' + bad.join(', ') : ''}`);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n【D】結構鎖（剝註解後掃，避免自己的註解引用字面量造成假紅）');
// ════════════════════════════════════════════════════════════════════
{
  const eng = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  const gateIdx = eng.indexOf('modalChoicePayloadValid(state.pendingSelection.params');
  const clearIdx = eng.indexOf('pendingSelection: undefined, _rejectedResolveStreak: undefined');
  ok(gateIdx > 0, 'D1 engine 有呼叫中央述詞 modalChoicePayloadValid');
  ok(gateIdx > 0 && clearIdx > 0 && gateIdx < clearIdx,
    'D2 中央閘必須在「清掉 pendingSelection」**之前**（放後面等於一點用都沒有）');

  const pg = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));
  ok(/params:\s*pendingSelection\.params,\s*\}\s*,\s*selectionItems\.length\)/.test(pg),
    'D3 pendingStuckEmpty 有把 params 傳給 selectionHasNoExit（不傳＝ 38 個 modal-choice 全被判成沒出口）');
  ok(pg.includes('aiStuckSelectionPayload(_g.pendingSelection)'),
    'D4 AI 無進展保險絲走中央 aiStuckSelectionPayload（送 [] 會被新閘退回、白繞好幾拍）');
  // ⚠ 第一個 <div class="sel-footer"> 就是選擇面板的 footer（後面那幾個是 mulligan／撤退等別的 modal）。
  const fIdx = pg.indexOf('<div class="sel-footer">');
  const fSeg = fIdx >= 0 ? pg.slice(fIdx, fIdx + 8000) : '';
  ok(fIdx >= 0 && fSeg.includes("pendingSelection.type === 'modal-choice'"),
    'D5a 抓到的確實是選擇面板的 footer（含 modal-choice 分支）');
  ok(/type === 'modal-choice'\}[\s\S]{0,400}?\{#if pendingStuckEmpty\}[\s\S]{0,400}?abandonSelection/.test(fSeg),
    'D5b modal-choice 的 footer 分支裡有 pendingStuckEmpty ⇒ abandonSelection 的逃生口');
}

console.log(`\n═══ v6.331 守衛：PASS ${pass} / FAIL ${fail} ═══`);
if (fail > 0) process.exit(1);
