// ⭐⭐⭐ v6.420 守衛：對戰畫面所有浮動視窗的「可拖曳 ＋ 拖不出畫面 ＋ 關得掉」。
// ⚠⚠ v6.425 起：本檔守的「完整留在畫面內」已改名為 `contain` 模式（浮動按鈕／面板用）；一般視窗預設 `reachable`
//   （可拖到畫面外、把手留在畫面內）——下文「留一角是錯的」指的是 v6.420 當時的判斷，現行規則見 test-v6425-promote-modal-dedupe-and-reach。
//
// 【玩家回報】手機上把視窗不小心拖到側邊（有時候會自己彈走）之後，**關不掉、也不能做任何動作**。
//   根因兩個，兩個都在這一版根治：
//     ① 位移**沒有夾制** ⇒ 視窗可以被拖到畫面外，關閉鈕跟著出去，而 overlay 仍蓋著整個畫面。
//     ② 拖曳實作**寫了兩份**（game/+page.svelte 的 modalOffset／MobilePortraitBattle 的 sheetOffset，
//        IRON_RULES Rule 38）⇒ 改一邊另一邊不會跟著動。
//   ⇒ 收斂成 `src/lib/modal-drag.ts`（`use:modalDrag` action ＋ 純函式 `clampModalOffset`）。
//
// 【站長要求（逐字）】「所有的 picker 或 UI/UX 等視窗應該全部都要做成可以拖曳，讓玩家可以拖曳
//   查看下方的戰況，並且顯示資訊類型的視窗務必確認有關閉按鈕，避免因為視窗無法關閉而卡住」。
//
// 【段落】
//   A 夾制純函式的行為端（含反安慰劑：把夾制拿掉必須被抓到）
//   B Playwright 真的拖：375×667 拖到畫面外，視窗仍留在畫面內、關閉鈕仍點得到
//   C 靜態接線：每一個「會蓋住畫面的視窗」都要掛中央 action（豁免逐條列理由）
//   D 資訊類視窗一定要有出口（✕ 或點背景關閉）
//   E 判準只有一份：兩個檔案都不得再自己寫 pointer 拖曳
//   F 獎賞卡背用站內唯一那一份 `.card-back`（站長：要跟 setup／觀戰一致）
//
// 【HEAD-FAIL】BASE（v6.419）上 A／B／C／E／F 全紅（那時 modal-drag.ts 還不存在）。
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { templateOnly as templateOnlyChecked, GAME_INLINE_STYLE } from './lib/strip-markup-sections.mjs';
import { cssOf } from './lib/svelte-style-block.mjs';   // 樣式區塊的**唯一**判準（test-v6392 在守）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const TA = async (name, fn) => { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };

const GAME = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const MPB = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
const gameT = templateOnlyChecked(GAME, { label: 'game', minSections: 1, mustKeep: ['selection-overlay'], allowResidual: [GAME_INLINE_STYLE] });
const mpbT = templateOnlyChecked(MPB, { label: 'mpb', minSections: 1, mustKeep: ['mp-sheet'] });

// ══════════════════════════════════════════════════════════════════════════════
// 【A】夾制純函式（行為端）
// ══════════════════════════════════════════════════════════════════════════════
const esbuild = require_('esbuild');
const dirA = mkdtempSync(join(tmpdir(), 'v6420-'));
// ⚠ IRON_RULES Rule 41：BASE 上 modal-drag.ts 根本不存在 ⇒ build 會 throw。
//   不可以讓整支守衛在第一行就炸掉（那樣只證明了「第一條紅」），改成哨兵：
//   MD = {}，每一條各自誠實翻紅。
let MD = {};
const MD_EXISTS = existsSync(join(ROOT, 'src/lib/modal-drag.ts'));
if (MD_EXISTS) {
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/lib/modal-drag.ts')], bundle: true, format: 'esm',
    outfile: join(dirA, 'md.mjs'), platform: 'neutral', logLevel: 'silent',
  });
  MD = await import(pathToFileURL(join(dirA, 'md.mjs')).href);
}
const MISSING = Symbol('missing');
const clamp = typeof MD.clampModalOffset === 'function' ? MD.clampModalOffset : () => MISSING;
// ⭐v6.425（Rule 40）：站長要求一般視窗可以拖到畫面外看底下的對戰紀錄 ⇒ 預設夾制改成 `reachable`
//   （只保證把手抓得到，見 modal-drag.ts）。v6.420 的「完整留在畫面內」規則仍存在、改名為 `contain`
//   （浮動按鈕／面板在用）——本檔 A／B 段守的正是那一條規則，所以一律明確帶 'contain' 驗；
//   預設 `reachable` 的行為（含「拖出去之後一定拖得回來、關閉鈕按得到」）由 test-v6425-promote-modal-dedupe-and-reach 守。
const clampContain = (b, o, vw, vh) => clamp(b, o, vw, vh, 'contain');
const MINV = typeof MD.MODAL_MIN_VISIBLE === 'number' ? MD.MODAL_MIN_VISIBLE : 0;

/** ⭐ 判準只寫一份：A2～A6 的正式斷言與 A8 的反安慰劑共用它。 */
function visibleAfterDrag(fn, base, want, vw, vh) {
  const off = fn(base, want, vw, vh);
  if (off === MISSING || !off) return null;
  const left = base.left + off.x, top = base.top + off.y;
  return {
    off,
    visW: Math.min(left + base.width, vw) - Math.max(left, 0),   // 水平交集
    visH: Math.min(top + base.height, vh) - Math.max(top, 0),    // 垂直交集
    top, left,
  };
}
/** 模擬「沒有夾制」的舊寫法（反安慰劑樣本）。 */
const noClamp = (_base, want) => ({ ...want });

const VIEWS = [[375, 667], [320, 568], [1280, 800]];
const BASES = [
  { name: '一般視窗', rect: { left: 40, top: 60, width: 300, height: 400 } },
  { name: '比畫面高的視窗', rect: { left: 10, top: 0, width: 355, height: 900 } },
  { name: '比夾制量還小的視窗', rect: { left: 100, top: 100, width: 30, height: 20 } },
];
T('A0. 中央模組有 clampModalOffset（HEAD-FAIL：BASE 上整個檔案不存在）', () => {
  assert.notStrictEqual(clamp({ left: 0, top: 0, width: 1, height: 1 }, { x: 0, y: 0 }, 100, 100), MISSING,
    'clampModalOffset 不存在');
  assert.ok(MINV >= 40, `MODAL_MIN_VISIBLE 太小（${MINV}）`);
});
T('A1. 不拖曳時位移不變（夾制不得把正常位置也改掉）', () => {
  // ⚠ 用「置中、本來就完全在畫面內」的 base —— 站內每個視窗都是 flex 置中。
  //   （拿一個本來就溢出畫面的 base 當測資，夾制當然會把它拉回來，那不是 bug。）
  for (const [vw, vh] of VIEWS) {
    for (const [w, h] of [[300, 400], [Math.min(355, vw), 200]]) {
      const rect = { left: Math.max(0, (vw - w) / 2), top: Math.max(0, (vh - h) / 2), width: w, height: h };
      const r = visibleAfterDrag(clamp, rect, { x: 0, y: 0 }, vw, vh);
      assert.ok(r, 'clamp 不存在');
      assert.deepStrictEqual(r.off, { x: 0, y: 0 }, `${w}x${h} @${vw}x${vh} 被無故移動`);
    }
  }
});
T('A1b. ⭐ 視窗一開始就溢出畫面（轉向／縮放之後）⇒ 夾制要把它拉回來', () => {
  const rect = { left: 40, top: 60, width: 300, height: 400 };   // 320 寬的畫面放不下
  const r = visibleAfterDrag(clampContain, rect, { x: 0, y: 0 }, 320, 568);
  assert.ok(r.left + rect.width <= 320 + 0.01, `右緣仍在畫面外（${(r.left + rect.width).toFixed(1)}）`);
  assert.ok(r.left >= -0.01, `左緣被拉到畫面外（${r.left.toFixed(1)}）`);
});
for (const [dx, dy, dir] of [[9999, 0, '右'], [-9999, 0, '左'], [0, -9999, '上'], [0, 9999, '下'], [9999, 9999, '右下'], [-9999, -9999, '左上']]) {
  T(`A2 拖到${dir}邊界外 ⇒ 視窗**完整**留在畫面內（比畫面大的軸則不露白）`, () => {
    for (const [vw, vh] of VIEWS) for (const b of BASES) {
      const r = visibleAfterDrag(clampContain, b.rect, { x: dx, y: dy }, vw, vh);
      assert.ok(r, 'clamp 不存在');
      // ⭐ 判準：可視交集 === min(視窗尺寸, 畫面尺寸) —— 一個像素都不准跑到畫面外
      const needW = Math.min(b.rect.width, vw), needH = Math.min(b.rect.height, vh);
      assert.ok(r.visW >= needW - 0.01, `${b.name} @${vw}x${vh} 往${dir}：水平只剩 ${r.visW.toFixed(1)}（需要 ${needW}）`);
      assert.ok(r.visH >= needH - 0.01, `${b.name} @${vw}x${vh} 往${dir}：垂直只剩 ${r.visH.toFixed(1)}（需要 ${needH}）`);
    }
  });
}
T('A3. 比畫面矮的視窗：上緣不得被拖到 0 以上（把手與關閉鈕一定看得到）', () => {
  const b = { left: 40, top: 60, width: 300, height: 400 };
  const r = visibleAfterDrag(clamp, b, { x: 0, y: -9999 }, 375, 667);
  assert.ok(r.top >= -0.01, `上緣被拖到 ${r.top.toFixed(1)}`);
});
T('A3b. ⭐⭐ 比畫面窄的視窗：往右拖之後**右緣**也不得超出（關閉鈕多半在右上角）', () => {
  const b = { left: 40, top: 60, width: 300, height: 400 };
  for (const [vw, vh] of VIEWS) {
    const r = visibleAfterDrag(clampContain, b, { x: 9999, y: 0 }, vw, vh);
    assert.ok(r.left + b.width <= vw + 0.01, `@${vw}x${vh} 右緣跑到 ${(r.left + b.width).toFixed(1)}（畫面寬 ${vw}）`);
  }
});
T('A4. ⭐⭐ 比畫面高的視窗：**不准**往上拖（把手與關閉鈕都在頂端，出畫面就抓不回來）', () => {
  // ⚠ 這一條是審查者實測改出來的：原本允許往上拖（讓玩家看視窗下半部），
  //   結果 500×900 的視窗可以被拖到 top=-233 ⇒ 把手整條出畫面 ⇒ 從畫面內任何一點都抓不到。
  //   站內每個視窗都有 max-height ＋ overflow，看下半部靠**內部捲動**，不必拖視窗。
  for (const b of [{ left: 10, top: 0, width: 355, height: 900 }, { left: 0, top: 0, width: 500, height: 900 }]) {
    const r = visibleAfterDrag(clamp, b, { x: 0, y: -9999 }, 375, 667);
    assert.ok(r.top >= -0.01, `比畫面高的視窗被拖到 top=${r.top.toFixed(1)}（把手會出畫面）`);
  }
});
T('A4b. ⭐ 比畫面寬的視窗：水平仍可左右拖（把手橫跨整個寬度，拖到哪都還抓得到）', () => {
  const b = { left: 0, top: 10, width: 500, height: 300 };
  const r = visibleAfterDrag(clampContain, b, { x: -9999, y: 0 }, 375, 667);
  assert.ok(r.left < -1, `比畫面寬的視窗竟然不能往左拖（left=${r.left.toFixed(1)}）`);
  assert.ok(r.left + b.width >= 375 - 0.01, `右緣拖到 ${(r.left + b.width).toFixed(1)} ⇒ 畫面右側露白`);
});
T('A5. ⭐【反安慰劑】把夾制拿掉的樣本，A2 的判準必須抓得到（不是恆真）', () => {
  const b = { left: 40, top: 60, width: 300, height: 400 };
  const bad = visibleAfterDrag(noClamp, b, { x: 9999, y: 9999 }, 375, 667);
  assert.ok(bad.visW < Math.min(b.width, 375) || bad.visH < Math.min(b.height, 667),
    'A2 的判準壞了：沒有夾制的樣本竟然也算「留得住」');
  const good = visibleAfterDrag(clampContain, b, { x: 9999, y: 9999 }, 375, 667);
  assert.ok(good.visW >= Math.min(b.width, 375) && good.visH >= Math.min(b.height, 667),
    'A2 的判準壞了：正確的夾制被判成留不住');
  // ⭐ 舊版「留一角」的夾制也必須被抓到（那正是實測發現關閉鈕仍會跑掉的那一版）
  const cornerOnly = (bb, want, vw, vh) => {
    const m = 72;
    const lo = m - bb.width - bb.left, hi = vw - m - bb.left;
    return { x: Math.min(Math.max(want.x, lo), hi), y: Math.min(Math.max(want.y, -bb.top), vh - m - bb.top) };
  };
  const old = visibleAfterDrag(cornerOnly, b, { x: 9999, y: 0 }, 375, 667);
  assert.ok(old.left + b.width > 375 + 0.01,
    'A3b 的判準壞了：舊版「留一角」的夾制竟然也算過（實測它會讓右上角的關閉鈕跑出畫面）');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】靜態接線：會蓋住畫面的視窗都要掛中央 action
// ══════════════════════════════════════════════════════════════════════════════
// ⚠ 豁免逐條寫理由（IRON_RULES：白名單每一條都要有為什麼安全的說明）：
const DRAG_EXEMPT = {
  'coin-overlay': '擲幣動畫，沒有任何互動元素、播完自動消失',
  'coin-flip-overlay': '同上（單次擲幣動畫）',
  'draw-fly-overlay': '抽牌飛卡動畫，pointer-events 全程不吃事件',
  'prize-pick-overlay': '取獎賞飛卡動畫，同上',
  'turn-banner-overlay': '回合開始橫幅，2 秒後自動消失',
  'lightbox-overlay': '全螢幕圖片檢視：本來就滿版（拖曳沒有意義），且**點畫面任何一處都會關閉**',
  'float-evo-backdrop': '進化選單的透明遮罩本身（選單是它的**兄弟**元素、已掛 action）；點遮罩即關閉',
};
// ⚠⚠ 掃描器第一版只認「單一 class」（`class="xxx-overlay"`），審查者實測漏掉 4 個多 class 的視窗
//   （`zoom-overlay restart-proposal-overlay` ×2、`modal-overlay undo-modal-overlay`、
//    `modal-overlay notify-prompt-overlay`），而 C0 的下限斷言察覺不到（25 個照樣過）。
//   ⇒ 改成「class 清單中**任一** token 以 overlay／backdrop 結尾」，並用**最具體**的那個 token 當名字。
const OVERLAY_RE = /<div class="([^"]*)"/g;
const GENERIC = new Set(['modal-overlay', 'zoom-overlay']);
/** 從 `<div` 開頭配對到它自己的 `</div>`（只數 div），超過 cap 就截在 cap。 */
function ownSubtree(tpl, start, cap) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, mm;
  while ((mm = re.exec(tpl)) !== null) {
    depth += mm[0] === '</div>' ? -1 : 1;
    if (depth === 0) return tpl.slice(start, Math.min(re.lastIndex, start + cap));
    if (re.lastIndex - start > cap) break;
  }
  return tpl.slice(start, start + cap);
}
function scanOverlays(tpl, label) {
  const out = [];
  for (const m of tpl.matchAll(OVERLAY_RE)) {
    const toks = m[1].split(/\s+/).filter(Boolean);
    const hits = toks.filter((t) => /(?:overlay|backdrop)$/.test(t));
    if (hits.length === 0) continue;
    if (toks.some((t) => t.startsWith('tt-attach'))) continue;   // 場上能量標記，不是視窗
    const cls = hits.find((t) => !GENERIC.has(t)) ?? hits[0];
    // ⭐v6.423（Rule 40）：原本固定取 900 字元 ⇒ 會把**後面的兄弟元素**也算進來
    //   （v6.423 在回合橫幅之後放了掛 action 的對手回合按鈕，C3 就把 turn-banner-overlay 誤判成
    //   「掛了 action 卻沒有把手」）。改成只取**這個元素自己的子樹**（div 開合配對），上限 900 不變。
    const seg = ownSubtree(tpl, m.index, 900);
    out.push({ label, cls, toks, index: m.index, hasDrag: seg.includes('use:modalDrag'), seg });
  }
  return out;
}
const OVS = [...scanOverlays(gameT, 'game'), ...scanOverlays(mpbT, 'mpb')];
T('C0. 掃描器下限：掃到的視窗數合理（掃不到東西時不准綠燈）', () => {
  assert.ok(OVS.length >= 35, `只掃到 ${OVS.length} 個視窗 —— 掃描器壞了？（v6.420 實測 38）`);
  // ⭐ 用審查者抓到的四個漏網者當正對照：掃描器必須看得見它們
  for (const k of ['restart-proposal-overlay', 'undo-modal-overlay', 'notify-prompt-overlay']) {
    assert.ok(OVS.some((o) => o.cls === k), `掃描器看不見 ${k}（多 class 的視窗又漏了）`);
  }
  assert.ok(OVS.some((o) => o.cls === 'selection-overlay'), '連 selection-overlay 都沒掃到');
  assert.ok(OVS.some((o) => o.label === 'mpb'), '手機直式的視窗完全沒掃到');
});
T('C1. ⭐⭐⭐【HEAD-FAIL】每一個會蓋住畫面的視窗都掛了中央 action（豁免逐條列理由）', () => {
  const bad = OVS.filter((o) => !o.hasDrag && !(o.cls in DRAG_EXEMPT));
  assert.strictEqual(bad.length, 0,
    '這些視窗拖不動（玩家沒辦法移開它看下方戰況）：\n      '
    + bad.map((o) => `${o.label}:${o.cls}@${o.index}`).join('\n      '));
});
T('C2. ⭐ 豁免清單不得有死條目（列了卻根本不存在 ⇒ 下次改名就靜默失效）', () => {
  const seen = new Set(OVS.map((o) => o.cls));
  const dead = Object.keys(DRAG_EXEMPT).filter((k) => !seen.has(k));
  assert.strictEqual(dead.length, 0, '豁免清單裡的死條目：' + dead.join('、'));
});
T('C3. ⭐ 掛了 action 的視窗，裡面必須真的有把手（不然 action 永遠不會被觸發）', () => {
  const HANDLES = ['modal-drag-handle', 'sel-header', 'mp-sheet-title', 'tourn-bracket-head', 'forfeit-title'];
  const bad = OVS.filter((o) => o.hasDrag && !HANDLES.some((h) => o.seg.includes(h)));
  assert.strictEqual(bad.length, 0,
    '這些視窗掛了 action 卻沒有把手：\n      ' + bad.map((o) => `${o.label}:${o.cls}@${o.index}`).join('\n      '));
});
T('C5. ⭐⭐⭐【審查者抓到】沒有 overlay 的浮動視窗（勝負／平手視窗）也要走中央 action', () => {
  // 勝負視窗是 position:fixed 直接疊在戰鬥盤上（刻意不加遮罩，好讓玩家看最終盤面），
  //   所以上面的 overlay 掃描器**看不見**它 —— 而它是終局後唯一的出口。
  const hits = [...gameT.matchAll(/<div class="gameover-modal"([^>]*)>/g)];
  assert.ok(hits.length >= 2, `勝負視窗只找到 ${hits.length} 個（應有勝負＋平手兩個）`);
  for (const h of hits) {
    assert.ok(/use:modalDrag/.test(h[1]), '勝負視窗沒有掛中央 action：' + h[0].slice(0, 120));
    const seg = gameT.slice(h.index, h.index + 500);
    assert.ok(/gameover-modal-header modal-drag-handle/.test(seg), '勝負視窗的標題列不是把手');
  }
});
T('C4. ⭐ 把手選擇器與 markup 一致（中央 DEFAULT_HANDLE_SELECTOR 要涵蓋實際用到的 class）', () => {
  const sel = String(MD.DEFAULT_HANDLE_SELECTOR ?? '');
  for (const h of ['modal-drag-handle', 'sel-header', 'mp-sheet-title', 'tourn-bracket-head', 'forfeit-title']) {
    assert.ok(sel.includes('.' + h), `DEFAULT_HANDLE_SELECTOR 少了 .${h}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】資訊類視窗一定要有出口
// ══════════════════════════════════════════════════════════════════════════════
// 「資訊類」＝只是把資料攤開給玩家看、沒有非做不可的決定。這些**一定**要能關掉。
// 決策類（selection-overlay 系）不在此列：它們要玩家做完選擇才會消失，
// 站內另有「放棄（無符合卡）」等出口機制（test-v6125／v6331 在守）。
const INFO_WINDOWS = [
  ['zoom-overlay', '卡牌放大／棄牌區／設定／獎賞卡檢視'],
  ['pv-overlay', '帳號管理／變更密碼'],
  ['hof-modal-backdrop', '錦標賽賽程／戰報'],
];
T('D1. ⭐⭐【站長要求】每一個資訊類視窗都有關閉出口（✕ 或點背景關閉）', () => {
  const bad = [];
  for (const o of OVS) {
    const hit = INFO_WINDOWS.find(([c]) => c === o.cls);
    if (!hit) continue;
    const head = gameT.slice(o.index, gameT.indexOf('>', o.index) + 1);
    const bgClose = /onclick=/.test(head);
    const xBtn = /(zoom-close|pv-close|hof-modal-x|lightbox-close|aria-label="關閉")/.test(o.seg);
    if (!bgClose && !xBtn) bad.push(`${o.cls}@${o.index}`);
  }
  assert.strictEqual(bad.length, 0, '這些資訊類視窗關不掉：' + bad.join('、'));
});
T('D2. ⭐ 正對照：判準抓得到「兩種出口都沒有」的樣本（不是恆真）', () => {
  const head = '<div class="zoom-overlay">';
  const seg = '<div class="zoom-overlay"><div class="zoom-modal">只有內容</div></div>';
  const bgClose = /onclick=/.test(head);
  const xBtn = /(zoom-close|pv-close|hof-modal-x|lightbox-close|aria-label="關閉")/.test(seg);
  assert.ok(!bgClose && !xBtn, 'D1 的判準壞了：沒有出口的樣本竟然算過');
});
T('D3. ⭐⭐ 賽程「載入中…」也要有出口（API 慢／失敗時會永遠蓋在畫面上）', () => {
  const i = gameT.indexOf('載入賽程中…');
  assert.ok(i > 0, 'anchor 失效');
  const blk = gameT.slice(Math.max(0, i - 700), i + 200);
  assert.ok(/hof-modal-x|aria-label="關閉"/.test(blk), '「載入賽程中…」沒有 ✕');
  assert.ok(/tHofClose/.test(blk), '「載入賽程中…」的背景點擊沒有接關閉');
  assert.ok(/function tHofClose\(\) \{ tHofView = null; tHofLoading = false; tHofSeq\+\+; \}/.test(GAME),
    'tHofClose 沒有一併收掉 tHofLoading／作廢在途請求 ⇒ 關了還會再冒出來');
  // ⭐ 審查者抓到：關掉之後 API 才回來，不可以把視窗再彈出來
  const fn = GAME.slice(GAME.indexOf('async function tHofOpen('), GAME.indexOf('function tHofClose('));
  assert.ok(/const seq = \+\+tHofSeq;/.test(fn), 'tHofOpen 沒有取請求序號');
  assert.ok(/if \(seq !== tHofSeq\) return;/.test(fn), 'tHofOpen 沒有丟棄過期回應 ⇒ 關掉的視窗會自己冒回來');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【E】判準只有一份
// ══════════════════════════════════════════════════════════════════════════════
T('E1. ⭐⭐⭐【HEAD-FAIL】兩個檔案都不得再自己寫拖曳（modalOffset／sheetOffset 已收斂）', () => {
  for (const [name, src] of [['game/+page.svelte', GAME], ['MobilePortraitBattle.svelte', MPB]]) {
    const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // ⚠ 只列 **modal 拖曳** 的符號。站內另有三個「不遮擋畫面」的浮動面板
    //   （聊天面板／對手回合面板／聊天 FAB）有自己的拖曳，它們都有關閉鈕、不會蓋住整個畫面，
    //   手機直式也早有自己的夾制（v5.626）⇒ **列管到下一版再收斂**，不在本版範圍。
    for (const tok of ['modalOffset', 'modalDragged', 'sheetOffset', 'sheetDragged', 'gameoverPanelPos', 'onGameoverHeader']) {
      assert.ok(!code.includes(tok), `${name} 還有自己那一份拖曳（${tok}）`);
    }
  }
});
T('E2. ⭐ 兩個檔案都確實 import 中央 action', () => {
  for (const [name, src] of [['game/+page.svelte', GAME], ['MobilePortraitBattle.svelte', MPB]]) {
    assert.ok(/import \{ modalDrag \} from '\$lib\/modal-drag'/.test(src), `${name} 沒有 import 中央 action`);
  }
});
T('E3. ⭐ 中央模組自己就是唯一一份（全站只有它在做 pointer 拖曳數學）', () => {
  assert.ok(MD_EXISTS, '中央模組 src/lib/modal-drag.ts 不存在');
  const md = readFileSync(join(ROOT, 'src/lib/modal-drag.ts'), 'utf8');
  assert.ok(/export function clampModalOffset/.test(md), 'clampModalOffset 不在中央模組');
  assert.ok(/export function modalDrag/.test(md), 'modalDrag action 不在中央模組');
  // 夾制必須真的被 action 用到（不能只是擺著好看 —— 那是最典型的安慰劑）
  const body = md.slice(md.indexOf('export function modalDrag'));
  assert.ok(/clampModalOffset\(/.test(body), 'action 沒有呼叫 clampModalOffset ⇒ 夾制根本沒生效');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【F】獎賞卡背用站內唯一那一份
// ══════════════════════════════════════════════════════════════════════════════
T('F1. ⭐⭐【站長要求】獎賞卡檢視的卡背走站內 `.card-back`（與 setup／觀戰一致）', () => {
  const i = gameT.indexOf('prize-view-back');
  assert.ok(i > 0, 'anchor 失效（prize-view-back 不見了）');
  const seg = gameT.slice(i, i + 320);
  assert.ok(/class="card-back /.test(seg), '卡背沒有用站內的 .card-back');
  assert.ok(/card-back-mark/.test(seg), '卡背沒有用站內的 .card-back-mark');
  assert.ok(!/🂠/.test(seg), '又自己畫了一份卡背（🂠）');
});
T('F2. ⭐ `.card-back` 仍然只有一份定義（紅色圓形那一份）', () => {
  const css = GAME.slice(GAME.indexOf('.card-back{'));
  assert.ok(/^\.card-back\{[^}]*radial-gradient/.test(css.trim().slice(0, 400).replace(/\s+/g, ' ').replace(/^ /, '')) || /radial-gradient/.test(css.slice(0, 400)),
    '.card-back 的定義變了（不再是紅色圓形）');
  const n = (GAME.match(/\n\s*\.card-back\{/g) || []).length;
  assert.strictEqual(n, 1, `.card-back 被定義了 ${n} 次（應為 1）`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【H】CSS：「拖開之後讓出下方畫面」的規則（審查者突變 M8／M12／M17／M20 全部存活過）
// ══════════════════════════════════════════════════════════════════════════════
const gameCss = cssOf(GAME, 'game/+page.svelte').replace(/\/\*[\s\S]*?\*\//g, '');
const mpbCss = cssOf(MPB, 'MobilePortraitBattle.svelte').replace(/\/\*[\s\S]*?\*\//g, '');
/** 找出含某個 selector 的整條規則的宣告區塊（逗號分隔的 selector 清單也算）。 */
function declsFor(css, sel) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' '));
    if (sels.includes(sel)) out.push(m[2]);
  }
  return out.join(';');
}
/** ⭐ 判準只寫一份：H1 正式斷言與 H3 反安慰劑共用。 */
const overlayYields = (css, ov) => {
  const d = declsFor(css, `.${ov}.dragged`);
  return /background:\s*transparent/.test(d) && /pointer-events:\s*none/.test(d);
};
const PAIRS = [
  ['selection-overlay', 'selection-modal'], ['zoom-overlay', 'zoom-modal'], ['zoom-overlay', 'restart-proposal-modal'],
  ['pv-overlay', 'pv-inner'], ['hof-modal-backdrop', 'hof-modal'], ['forfeit-modal-backdrop', 'forfeit-modal'],
  ['modal-overlay', 'notify-prompt-modal'], ['modal-overlay', 'undo-request-modal'],
];
T('H1. ⭐⭐ 每一種 overlay 被拖曳後都讓出下方畫面（背景透明＋不吃事件）', () => {
  for (const [ov] of PAIRS) assert.ok(overlayYields(gameCss, ov), `.${ov}.dragged 沒有讓出畫面（背景仍擋著戰況）`);
  assert.ok(overlayYields(mpbCss, 'mp-sheet-overlay'), '手機直式 .mp-sheet-overlay.dragged 沒有讓出畫面');
});
T('H2. ⭐⭐ 每一種 overlay 裡的視窗本體在拖曳後仍然點得到（pointer-events:auto）', () => {
  for (const [ov, md] of PAIRS) {
    const d = declsFor(gameCss, `.${ov}.dragged .${md}`);
    assert.ok(/pointer-events:\s*auto/.test(d), `.${ov}.dragged .${md} 沒有 pointer-events:auto ⇒ 拖開之後視窗本身點不到`);
  }
});
T('H3. ⭐⭐【反安慰劑＋Svelte 陷阱】不得有「以 .dragged 開頭」的規則（Svelte 會當 unused 整條刪掉）', () => {
  // 實測：寫成 `.dragged > .zoom-modal` 時 vite build 產物裡完全沒有那一條。
  const bad = [...gameCss.matchAll(/(^|[,}\s])\.dragged[\s>+~.:]/g)].map((m) => gameCss.slice(Math.max(0, m.index - 20), m.index + 60));
  assert.strictEqual(bad.length, 0, '有以 .dragged 開頭的規則（會被 Svelte 搖掉）：' + bad.join(' ||| '));
  assert.ok(!overlayYields('.x-overlay.dragged{ background:#000; }', 'x-overlay'), 'H1 的判準壞了：沒有讓出畫面的樣本竟然算過');
  assert.ok(overlayYields('.x-overlay.dragged{ background:transparent; pointer-events:none; }', 'x-overlay'), 'H1 的判準壞了：正確樣本被誤判');
});
T('H4. ⭐ 所有拖曳把手都有 touch-action:none（手機上沒有它，拖一下就被瀏覽器接管成捲動）', () => {
  assert.ok(/touch-action:\s*none/.test(declsFor(gameCss, '.modal-drag-handle')), '.modal-drag-handle 沒有 touch-action:none');
  assert.ok(/touch-action:\s*none/.test(declsFor(gameCss, '.sel-header')), '.sel-header 沒有 touch-action:none');
  assert.ok(/touch-action:\s*none/.test(declsFor(mpbCss, '.mp-sheet-drag-handle')), '.mp-sheet-drag-handle 沒有 touch-action:none');
  // 審查者抓到：這兩個把手原本沒有 touch-action ⇒ 本版給它們掛上 modal-drag-handle
  assert.ok(/class="tourn-bracket-head modal-drag-handle"/.test(gameT), '賽程／戰報的標題列沒有掛 modal-drag-handle');
  assert.ok(/class="forfeit-title modal-drag-handle"/.test(gameT), '棄權確認的標題沒有掛 modal-drag-handle');
});
T('H5. 獎賞卡背的尺寸規則存在（沒有它 .card-back 會縮成 0×0）', () => {
  const d = declsFor(gameCss, '.prize-view-cardback');
  assert.ok(/width:\s*64px/.test(d) && /height:\s*89px/.test(d), '.prize-view-cardback 尺寸不對：' + d);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【G】終局判定（站長裁定，與視窗無關但同屬本版）
//   逐字：「單方取完6張獎賞、而同一瞬間該方自己也沒有寶可夢可上場，如果攻擊方因此沒有能上場的
//   寶可夢，應該判定為雙方平手（一方拿完獎賞卡，但自己卻沒有寶可夢可以上場）」。
//   ⇒ 取完獎賞的那一方**自己**沒有可上場的寶可夢時，雙方各自滿足一個勝利條件 ⇒ 平手。
// ══════════════════════════════════════════════════════════════════════════════
const dirG = mkdtempSync(join(tmpdir(), 'v6420g-'));
writeFileSync(join(dirG, 's.js'), 'export const base="";');
writeFileSync(join(dirG, 'e.ts'),
  `export { judgeEndgameV6361 } from ${JSON.stringify(join(ROOT, 'src/lib/game/engine'))};\n`
  + `import ${JSON.stringify(join(ROOT, 'src/lib/game/effects'))};`);
await esbuild.build({
  entryPoints: [join(dirG, 'e.ts')], outfile: join(dirG, 'o.mjs'), bundle: true, format: 'esm',
  platform: 'node', target: 'node20', absWorkingDir: ROOT, logLevel: 'silent',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': join(dirG, 's.js') },
});
const ENG = await import(pathToFileURL(join(dirG, 'o.mjs')).href);
const judge = typeof ENG.judgeEndgameV6361 === 'function' ? ENG.judgeEndgameV6361 : () => MISSING;
/** 盤面：`pz` 剩餘獎賞、`mon` 有沒有可上場的寶可夢。 */
const board = (pz0, mon0, pz1, mon1) => ({
  players: [
    { name: 'A', prizes: Array.from({ length: pz0 }, (_, i) => ({ iid: 'a' + i })), active: mon0 ? { iid: 'aa' } : null, bench: [] },
    { name: 'B', prizes: Array.from({ length: pz1 }, (_, i) => ({ iid: 'b' + i })), active: mon1 ? { iid: 'bb' } : null, bench: [] },
  ],
});
T('G0. judgeEndgameV6361 取得到（HEAD-FAIL 前置）', () => {
  assert.notStrictEqual(judge(board(1, true, 1, true), true), MISSING, 'judgeEndgameV6361 不存在');
});
T('G1. ⭐⭐⭐【HEAD-FAIL・站長裁定】A 取完獎賞但 A 自己沒有可上場的寶可夢 ⇒ **平手**', () => {
  const v = judge(board(0, false, 3, true), true);
  assert.strictEqual(v.over, true, '沒有判終局');
  assert.strictEqual(v.winner, null, `應該平手，實得 winner=${v.winner}（${v.reason}）`);
  const v2 = judge(board(3, true, 0, false), true);
  assert.strictEqual(v2.winner, null, `反邊也應該平手，實得 winner=${v2.winner}（${v2.reason}）`);
});
T('G2.【零回歸】A 取完獎賞且 A 還有寶可夢 ⇒ A 獲勝（不得被改成平手）', () => {
  const v = judge(board(0, true, 3, true), true);
  assert.strictEqual(v.winner, 0, `應該 A 勝，實得 winner=${v.winner}（${v.reason}）`);
});
T('G3.【零回歸】A 取完獎賞、沒寶可夢的是**對手** ⇒ 兩個條件都指向 A ⇒ 仍是 A 獲勝', () => {
  const v = judge(board(0, true, 3, false), true);
  assert.strictEqual(v.winner, 0, `應該 A 勝，實得 winner=${v.winner}（${v.reason}）`);
});
T('G4.【零回歸】雙方同時取完 ⇒ 仍照 v6.361／v6.419（雙方都有寶可夢 ⇒ 平手）', () => {
  const v = judge(board(0, true, 0, true), true);
  assert.strictEqual(v.winner, null, `應該平手，實得 winner=${v.winner}`);
});
T('G5.【零回歸】沒有人取完 ⇒ 只看放置規則（withPrizeRule 不得誤判）', () => {
  assert.strictEqual(judge(board(2, true, 3, true), true).over, false, '不該終局');
  assert.strictEqual(judge(board(2, false, 3, true), true).winner, 1, 'A 沒寶可夢 ⇒ B 勝');
});
T('G6. ⭐【反安慰劑】判準抓得到「舊寫法」（單方取完就直接判他勝）', () => {
  const oldJudge = (st) => {
    const out = [st.players[0].prizes.length <= 0, st.players[1].prizes.length <= 0];
    if (out[0]) return { over: true, winner: 0, reason: 'old' };
    if (out[1]) return { over: true, winner: 1, reason: 'old' };
    return { over: false };
  };
  assert.strictEqual(oldJudge(board(0, false, 3, true)).winner, 0,
    'G1 的判準壞了：舊寫法竟然也給平手');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【B】Playwright：真的拖一次
// ══════════════════════════════════════════════════════════════════════════════
const chromium = MD_EXISTS ? pwChromium('v6.420 【B】視窗拖到畫面外的夾制實測') : null;
if (!MD_EXISTS) {
  // HEAD-FAIL 路徑：中央模組不存在 ⇒ B 段整段視為紅（不是 ENV-SKIP —— 缺的是本版的程式碼，不是環境）
  T('B0. ⭐【HEAD-FAIL】中央拖曳模組存在（B 段需要它才能實測）', () => { assert.fail('src/lib/modal-drag.ts 不存在'); });
}
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.420 【B】視窗拖到畫面外的夾制實測');
  if (browser) {
    try {
      const bundleDir = mkdtempSync(join(tmpdir(), 'v6420b-'));
      await esbuild.build({
        entryPoints: [join(ROOT, 'src/lib/modal-drag.ts')], bundle: true, format: 'iife',
        globalName: 'MDRAG', outfile: join(bundleDir, 'md.js'), logLevel: 'silent',
      });
      const md = readFileSync(join(bundleDir, 'md.js'), 'utf8');
      const HTML = `<!doctype html><html><head><style>
        html,body{margin:0;height:100%;}
        .selection-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;}
        .selection-overlay.dragged{background:transparent;pointer-events:none;}
        .selection-overlay.dragged .selection-modal{pointer-events:auto;}
        .selection-modal{background:#123;width:300px;height:400px;}
        .sel-header{height:40px;background:#245;color:#fff;touch-action:none;}
        .x{position:absolute;right:4px;top:8px;}
      </style></head><body>
        <div class="selection-overlay"><div class="selection-modal" id="m">
          <div class="sel-header" id="h">把手<button class="x" id="x">✕</button></div>
        </div></div>
      </body></html>`;
      const drag = async (dx, dy) => {
        const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
        const pg = await ctx.newPage();
        await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
        await pg.goto('https://t.local/');
        await pg.addScriptTag({ content: md });
        await pg.evaluate(() => { window.MDRAG.modalDrag(document.getElementById('m'), { clamp: 'contain' }); });
        const h = await pg.locator('#h').boundingBox();
        await pg.mouse.move(h.x + 60, h.y + 20);
        await pg.mouse.down();
        await pg.mouse.move(h.x + 60 + dx, h.y + 20 + dy, { steps: 6 });
        await pg.mouse.up();
        const out = await pg.evaluate(() => {
          const r = document.getElementById('m').getBoundingClientRect();
          const xr = document.getElementById('x').getBoundingClientRect();
          const cx = xr.left + xr.width / 2, cy = xr.top + xr.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          return {
            visW: Math.min(r.right, innerWidth) - Math.max(r.left, 0),
            visH: Math.min(r.bottom, innerHeight) - Math.max(r.top, 0),
            top: r.top,
            xInView: cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight,
            xClickable: !!hit && (hit.id === 'x' || hit.closest('#x') !== null),
            overlayDragged: document.querySelector('.selection-overlay').classList.contains('dragged'),
          };
        });
        await ctx.close();
        return out;
      };
      for (const [dx, dy, dir] of [[-2000, -2000, '左上'], [2000, 2000, '右下'], [2000, -2000, '右上'], [-2000, 2000, '左下']]) {
        // eslint-disable-next-line no-await-in-loop
        const r = await drag(dx, dy);
        // eslint-disable-next-line no-await-in-loop
        await TA(`B1 往${dir}拖 2000px：視窗**完整**留在畫面內（${r.visW.toFixed(0)}×${r.visH.toFixed(0)}）`, () => {
          assert.ok(r.visW >= 300 - 1, `水平只剩 ${r.visW.toFixed(1)}（視窗寬 300）`);
          assert.ok(r.visH >= 400 - 1, `垂直只剩 ${r.visH.toFixed(1)}（視窗高 400）`);
        });
        // eslint-disable-next-line no-await-in-loop
        await TA(`B2 往${dir}拖 2000px：⭐ 關閉鈕仍在畫面內而且**點得到**`, () => {
          assert.ok(r.xInView, '關閉鈕跑出畫面了');
          assert.ok(r.xClickable, '關閉鈕被別的東西蓋住／點不到');
        });
        // eslint-disable-next-line no-await-in-loop
        await TA(`B3 往${dir}拖：overlay 讓出下方畫面（加上 dragged）`, () => {
          assert.ok(r.overlayDragged, 'overlay 沒有加上 dragged ⇒ 背景仍蓋著、玩家看不到戰況');
        });
      }
      // ── B4～B9：action 的行為面（審查者突變 M9／M10／M13／M14／M18 都存活過）──────
      const openPg = async (html, vw = 375, vh = 667) => {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
        const pg = await ctx.newPage();
        await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: html }));
        await pg.goto('https://t.local/');
        await pg.addScriptTag({ content: md });
        return { ctx, pg };
      };
      const box = async (pg, sel) => pg.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
      {
        const { ctx, pg } = await openPg(HTML);
        await pg.evaluate(() => { window.__clicked = 0; document.getElementById('x').onclick = () => { window.__clicked++; }; window.MDRAG.modalDrag(document.getElementById('m'), { clamp: 'contain' }); });
        const before = await box(pg, '#m');
        const xb = await pg.locator('#x').boundingBox();
        await pg.mouse.move(xb.x + 5, xb.y + 5); await pg.mouse.down();
        await pg.mouse.move(xb.x - 120, xb.y + 150, { steps: 5 }); await pg.mouse.up();
        const after = await box(pg, '#m');
        await pg.mouse.click(xb.x + 5, xb.y + 5);
        const clicked = await pg.evaluate(() => window.__clicked);
        await ctx.close();
        await TA('B4 ⭐【M9】從把手裡的 ✕ 起拖 ⇒ 視窗不動（按鈕不會變成拖曳起點），✕ 照樣按得到', () => {
          assert.ok(Math.abs(after.l - before.l) < 1 && Math.abs(after.t - before.t) < 1,
            `從 ✕ 起拖竟然把視窗拖走了（${before.l},${before.t} → ${after.l},${after.t}）`);
          assert.ok(clicked >= 1, '✕ 按不到');
        });
      }
      {
        const { ctx, pg } = await openPg(HTML, 900, 700);
        await pg.evaluate(() => { window.MDRAG.modalDrag(document.getElementById('m'), { clamp: 'contain' }); });
        const h = await pg.locator('#h').boundingBox();
        await pg.mouse.move(h.x + 60, h.y + 20); await pg.mouse.down();
        await pg.mouse.move(h.x + 60 + 3000, h.y + 20 + 3000, { steps: 6 }); await pg.mouse.up();
        await pg.setViewportSize({ width: 375, height: 667 });
        await pg.waitForTimeout(150);
        const b = await box(pg, '#m');
        await ctx.close();
        await TA('B5 ⭐【M10】拖到右下角之後畫面縮小（轉向）⇒ 自動拉回、仍完整在畫面內', () => {
          assert.ok(b.r <= 375 + 1 && b.b <= 667 + 1 && b.l >= -1 && b.t >= -1, `轉向後視窗跑出畫面：${JSON.stringify(b)}`);
        });
      }
      {
        const { ctx, pg } = await openPg(HTML);
        const out = await pg.evaluate(async () => {
          const m = document.getElementById('m');
          const a = window.MDRAG.modalDrag(m, { resetKey: 'A', clamp: 'contain' });
          const h = document.getElementById('h');
          const r = h.getBoundingClientRect();
          const ev = (t, x, y) => h.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
          ev('pointerdown', r.left + 60, r.top + 20); ev('pointermove', r.left + 20, r.top + 5); ev('pointerup', r.left + 20, r.top + 5);
          const moved = m.style.translate;
          const draggedA = document.querySelector('.selection-overlay').classList.contains('dragged');
          a.update({ resetKey: 'A' });
          const keepSame = m.style.translate;
          a.update({ resetKey: 'B' });
          const afterReset = m.style.translate;
          const draggedB = document.querySelector('.selection-overlay').classList.contains('dragged');
          ev('pointerdown', r.left + 60, r.top + 20); ev('pointermove', r.left + 20, r.top + 5); ev('pointerup', r.left + 20, r.top + 5);
          a.destroy();
          const draggedAfterDestroy = document.querySelector('.selection-overlay').classList.contains('dragged');
          return { moved, draggedA, keepSame, afterReset, draggedB, draggedAfterDestroy };
        });
        await ctx.close();
        await TA('B6 ⭐【M13】resetKey 同值不歸零、換值歸零並收掉 dragged（換 picker 不會出現在上一個被拖走的位置）', () => {
          assert.ok(out.moved !== '', '前置：沒有拖動成功');
          assert.ok(out.draggedA, '前置：沒有加上 dragged');
          assert.strictEqual(out.keepSame, out.moved, '同一個 resetKey 竟然也歸零了');
          assert.strictEqual(out.afterReset, '', `換 resetKey 之後沒有歸零（${out.afterReset}）`);
          assert.ok(!out.draggedB, '換 resetKey 之後 dragged 沒有收掉 ⇒ 背景一直是透明的');
        });
        await TA('B7 ⭐【M14】action 銷毀時一定把 dragged 收掉（不留一個永遠透明、點不到的 overlay）', () => {
          assert.ok(!out.draggedAfterDestroy, 'destroy 之後 dragged 還在');
        });
      }
      {
        // B8：勝負視窗／進化選單都靠 CSS transform 定位 —— action 不得把它蓋掉
        const H2 = HTML.replace('.selection-modal{background:#123;width:300px;height:400px;}',
          '.selection-modal{background:#123;width:300px;height:400px;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);}');
        const { ctx, pg } = await openPg(H2);
        await pg.evaluate(() => { window.MDRAG.modalDrag(document.getElementById('m'), { clamp: 'contain' }); });
        const b0 = await box(pg, '#m');
        const h = await pg.locator('#h').boundingBox();
        await pg.mouse.move(h.x + 60, h.y + 20); await pg.mouse.down();
        await pg.mouse.move(h.x + 61, h.y + 21, { steps: 2 }); await pg.mouse.up();
        const b1 = await box(pg, '#m');
        const tf = await pg.evaluate(() => getComputedStyle(document.getElementById('m')).transform);
        await ctx.close();
        await TA('B8 ⭐⭐【審查者 probe】元素本身靠 transform 置中時，拖 1px 只會移 1px（不會跳位）', () => {
          assert.ok(Math.abs(b1.l - b0.l) <= 2 && Math.abs(b1.t - b0.t) <= 2,
            `拖 1px 就跳位了（${b0.l.toFixed(0)},${b0.t.toFixed(0)} → ${b1.l.toFixed(0)},${b1.t.toFixed(0)}）⇒ action 把原本的 transform 蓋掉了`);
          assert.ok(tf && tf !== 'none', `元素原本的 transform 被清掉了（${tf}）`);
        });
      }
      {
        const { ctx, pg } = await openPg(HTML);
        const out = await pg.evaluate(() => {
          const m = document.getElementById('m');
          m.setPointerCapture = () => { throw new Error('不支援'); };   // 模擬 capture 失敗
          window.MDRAG.modalDrag(m, { clamp: 'contain' });
          const h = document.getElementById('h');
          const r = h.getBoundingClientRect();
          h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 60, clientY: r.top + 20, pointerId: 7 }));
          h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20, pointerId: 7 }));
          // 在視窗**外**放開（node 收不到，只有 window 收得到）
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5, pointerId: 7 }));
          const t1 = m.style.translate;
          // 之後滑鼠只是「滑過」視窗
          h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 10, clientY: r.top + 30, pointerId: 7 }));
          return { t1, t2: m.style.translate };
        });
        await ctx.close();
        await TA('B9 ⭐【M18】pointer capture 失敗、在視窗外放開 ⇒ 之後滑過視窗不會被拖著走', () => {
          assert.strictEqual(out.t2, out.t1, `放開之後視窗還跟著游標走（${out.t1} → ${out.t2}）`);
        });
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.420 視窗拖曳中央管線：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
