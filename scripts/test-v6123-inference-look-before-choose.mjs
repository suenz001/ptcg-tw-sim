// v6.123 守衛：【推理組合】的決策點必須落在「看完 3 張之後」。
//
// 卡面（台灣官方，static/cards MC 17116 / SV8 11274）：
//   「查看自己的牌庫上方3張卡，以任意順序排列，放回牌庫上方。
//     或者將那些卡全部翻回反面並重洗，放回牌庫下方。」
//   ⇒ 先「查看」，看完才在兩個選項之間二選一。
//
// v2.164 的舊實裝先開 modal-choice 問「要排序還是洗回底」，**這時玩家還沒看到那 3 張**
// —— 等於逼玩家盲猜，卡面給的資訊完全沒用上。
// v6.123 改成直接開 reorder-deck-top（3 張攤開），排序畫面上多一顆 altAction 按鈕。
//
// ⚠⚠ 本檔還鎖住一個**同版一併修掉的既有 bug**：
//   卡面說「將**那些卡**（3 張）翻回反面並重洗，放回牌庫下方」——
//   **牌庫其餘部分不該被重洗**。舊碼寫 `shuffle(rest)`，會把玩家已知的牌庫順序整個摧毀。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x123-s.js'), E = join(ROOT, '.x123-e.ts'), O = join(ROOT, '.x123-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { TRAINER_EFFECTS, RESOLVERS } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// 任一張卡當牌庫填充物即可（本卡不看卡種）
let FILLER = null;
for (const [id] of pool) { FILLER = id; break; }
ok(FILLER, '找不到任何卡');
const inst = (iid) => ({ iid, cardId: FILLER, damage: 0, energyAttached: [], evolvedFromStack: [] });

function mkState(deckLen = 8) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, pendingChainQueue: [], setupDone: [true, true], pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst('a1'), bench: [], hand: [],
        deck: Array.from({ length: deckLen }, (_, i) => inst('d' + i)), discard: [], prizes: [] },
      { name: 'P2', active: inst('b1'), bench: [], hand: [],
        deck: Array.from({ length: deckLen }, (_, i) => inst('e' + i)), discard: [], prizes: [] },
    ],
  };
}

console.log('① 決策點必須在「看完 3 張」之後');

T('⭐⭐⭐ 打出推理組合 → 直接開 reorder-deck-top（不是先問的 modal-choice）', () => {
  const fn = mod.TRAINER_EFFECTS.get('推理組合');
  ok(fn, '找不到推理組合的 TRAINER_EFFECTS');
  const s = fn(mkState(), 0, pool);
  ok(s.pendingSelection, '沒有開任何 pending');
  ok(s.pendingSelection.type === 'reorder-deck-top',
    '開的是 ' + s.pendingSelection.type + '，應為 reorder-deck-top。\n'
    + '      卡面是「查看…以任意順序排列…或者…」—— 先看完 3 張才二選一。\n'
    + '      先開 modal-choice 問＝逼玩家盲猜，卡面資訊完全沒用上。');
  ok(s.pendingSelection.effectKey === 'reorder-deck-top-apply',
    'effectKey 應走中央的 reorder-deck-top-apply');
  const cand = s.pendingSelection.params?.candidateIids ?? [];
  ok(cand.length === 3, '候選應為牌庫頂 3 張，實得 ' + cand.length);
});

T('⭐⭐ 排序畫面必須帶 altAction（卡面「或者」那一半）', () => {
  const s = mod.TRAINER_EFFECTS.get('推理組合')(mkState(), 0, pool);
  const alt = s.pendingSelection.params?.altAction;
  ok(alt && alt.id, '沒有 params.altAction —— 玩家只剩「排序」一個選項，卡面的另一半消失了');
  ok(typeof alt.label === 'string' && alt.label.length > 0, 'altAction 缺 label（按鈕會沒有文字）');
});

console.log('② 次要動作：翻回反面重洗放回牌庫下方');

T('⭐⭐⭐ 送出 altAction.id → 那 3 張進牌庫最下方', () => {
  const s0 = mod.TRAINER_EFFECTS.get('推理組合')(mkState(), 0, pool);
  const { params } = s0.pendingSelection;
  const before = s0.players[0].deck.map((c) => c.iid);
  const top3 = new Set(before.slice(0, 3));
  const r = mod.RESOLVERS.get('reorder-deck-top-apply');
  ok(r, '找不到 reorder-deck-top-apply resolver');
  const s1 = r({ ...s0, pendingSelection: null }, 0, [params.altAction.id], params, pool);
  const after = s1.players[0].deck.map((c) => c.iid);
  ok(after.length === before.length, '牌庫張數變了：' + before.length + ' → ' + after.length);
  const tail = new Set(after.slice(-3));
  ok([...top3].every((id) => tail.has(id)),
    '原本牌庫頂的 3 張沒有被放到最下方。before=' + before.join(',') + ' after=' + after.join(','));
});

T('⭐⭐⭐ 只重洗「那些卡」—— 牌庫其餘部分順序必須逐張不變（既有 bug）', () => {
  const s0 = mod.TRAINER_EFFECTS.get('推理組合')(mkState(12), 0, pool);
  const { params } = s0.pendingSelection;
  const before = s0.players[0].deck.map((c) => c.iid);
  const r = mod.RESOLVERS.get('reorder-deck-top-apply');
  const s1 = r({ ...s0, pendingSelection: null }, 0, [params.altAction.id], params, pool);
  const after = s1.players[0].deck.map((c) => c.iid);
  const restBefore = before.slice(3).join(',');
  const restAfter = after.slice(0, after.length - 3).join(',');
  ok(restBefore === restAfter,
    '牌庫其餘部分被重洗了。\n'
    + '      卡面：「將**那些卡**全部翻回反面並重洗，放回牌庫下方」—— 只有那 3 張要洗。\n'
    + '      把 rest 也洗掉會摧毀玩家已知的牌庫順序（例：上一次推理組合／蕾荷排好的頂部）。\n'
    + '      before rest=' + restBefore + '\n      after  rest=' + restAfter);
});

console.log('③ 不得波及共用同一個 resolver 的其他卡（蕾荷／天眼／攪亂雷達）');

T('⭐⭐ 蕾荷的 pending 不得帶 altAction（fail-closed，建構上就不可能觸發）', () => {
  const fn = mod.TRAINER_EFFECTS.get('蕾荷');
  ok(fn, '找不到蕾荷');
  const s = fn(mkState(), 0, pool);
  ok(s.pendingSelection?.type === 'reorder-deck-top', '蕾荷應開 reorder-deck-top');
  ok(!s.pendingSelection.params?.altAction, '蕾荷不該有 altAction');
});

T('⭐⭐⭐ 正對照 fail-closed：拿掉 params.altAction 後送同一個哨兵字串 → 分支不得進入', () => {
  // ⚠ 這條要用 allowDiscard:false 的 pending 來驗。
  //   蕾荷是 allowDiscard:true（卡面「選任意數量丟棄」，minCount=0），
  //   送任何非候選字串＝「一張都不留」→ 全部進棄牌，那是它**正常的**語義，不能拿來當正對照
  //   （我第一版就寫錯，測試紅了才發現）。
  const s0 = mod.TRAINER_EFFECTS.get('推理組合')(mkState(12), 0, pool);
  const { altAction, ...paramsNoAlt } = s0.pendingSelection.params;
  ok(altAction?.id, '前提：推理組合本來有 altAction');
  const before = s0.players[0].deck.map((c) => c.iid);
  const r = mod.RESOLVERS.get('reorder-deck-top-apply');
  // 沒有 params.altAction ⇒ 分支不進入 ⇒ 哨兵被 candidateSet 過濾 ⇒ safetyAppend 原順序保留
  const s1 = r({ ...s0, pendingSelection: null }, 0, [altAction.id], paramsNoAlt, pool);
  const after = s1.players[0].deck.map((c) => c.iid);
  ok(before.join(',') === after.join(','),
    'fail-closed 破功：沒帶 altAction 也走了重洗分支。\n'
    + '      before=' + before.join(',') + '\n      after =' + after.join(','));
});

T('⭐ 蕾荷本身的語義不受影響：留 2 張丟 3 張仍然照舊', () => {
  const s0 = mod.TRAINER_EFFECTS.get('蕾荷')(mkState(12), 0, pool);
  const { params } = s0.pendingSelection;
  const cand = params.candidateIids;
  const keep = cand.slice(0, 2);
  const r = mod.RESOLVERS.get('reorder-deck-top-apply');
  const s1 = r({ ...s0, pendingSelection: null }, 0, keep, params, pool);
  ok(s1.players[0].deck.slice(0, 2).map((c) => c.iid).join(',') === keep.join(','),
    '蕾荷的保留+排序壞了');
  ok(s1.players[0].discard.length === cand.length - 2,
    '蕾荷的丟棄張數不對：' + s1.players[0].discard.length);
});

T('⭐ 排序路徑（送 iid 順序）仍然正常：反轉頂 3 張', () => {
  const s0 = mod.TRAINER_EFFECTS.get('推理組合')(mkState(), 0, pool);
  const { params } = s0.pendingSelection;
  const cand = params.candidateIids;
  const r = mod.RESOLVERS.get('reorder-deck-top-apply');
  const s1 = r({ ...s0, pendingSelection: null }, 0, [...cand].reverse(), params, pool);
  const after = s1.players[0].deck.map((c) => c.iid);
  ok(after.slice(0, 3).join(',') === [...cand].reverse().join(','),
    '排序路徑壞了：實得 ' + after.slice(0, 3).join(','));
});

console.log('④ UI：排序畫面要有次要動作按鈕，且不得重用 confirmSelection');

T('⭐⭐ reorder 的 footer 有 altAction 按鈕（只在帶 altAction 時渲染）', () => {
  const i = PAGE.indexOf("{:else if pendingSelection.type === 'reorder-deck-top'}");
  ok(i >= 0, '找不到 reorder-deck-top 的 footer 區塊');
  const w = PAGE.slice(i, i + 1400);
  ok(/\{#if pendingSelection\.params\?\.altAction\}/.test(w),
    'footer 沒有 altAction 條件渲染 —— 卡面的「或者」那一半按不到');
  ok(/onclick=\{confirmSelectionAlt\}/.test(w), 'altAction 按鈕沒有接 confirmSelectionAlt');
});

T('⭐⭐ confirmSelectionAlt 必須自己送 altAction.id 並帶 sid（不得重用 confirmSelection）', () => {
  const i = PAGE.indexOf('function confirmSelectionAlt()');
  ok(i >= 0, '找不到 confirmSelectionAlt');
  const body = PAGE.slice(i, PAGE.indexOf('\n  }', i));
  ok(/resolveSelection\(\[alt\.id\], sid\)/.test(body),
    'confirmSelectionAlt 沒有送 [altAction.id] + sid。\n'
    + '      ⚠ 不能重用 confirmSelection()：它有 selectionValid gate，且 payload 固定是排序後的 iid。\n'
    + '      ⚠ sid（線上 senderIdx）不能省，否則對手側 race 時語義不對。');
  ok(/selectionReorderKeep = \[\]/.test(body), '送出後沒有清掉排序暫存');
  // 正對照：舊寫法（直接呼叫 confirmSelection）會被這條抓到
  ok(!/confirmSelection\(\)/.test(body), 'confirmSelectionAlt 內部又去呼叫 confirmSelection()');
});

console.log('⑤ 舊 resolver 保留相容（舊 client mid-pending 換版不致效果蒸發）');

T('⭐ inference-combination-choice resolver 仍在（已無 producer，純相容）', () => {
  ok(mod.RESOLVERS.has('inference-combination-choice'),
    '舊 resolver 被刪了 —— 舊 client 在該 pending 掛著時換版，effect 會靜默蒸發');
  // 但 producer 必須已經移除
  const s = mod.TRAINER_EFFECTS.get('推理組合')(mkState(), 0, pool);
  ok(s.pendingSelection.effectKey !== 'inference-combination-choice',
    '推理組合又開回舊的 modal-choice 了');
});

console.log('\n=== v6.123 推理組合「看完再決定」守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
