#!/usr/bin/env node
/**
 * v6.441 守衛：桌機第四種對戰版面「藍桌墊」（battleLayout === 'blue'）
 *
 * 站長交辦（2026-09-29）：參考其他玩家自製模擬器的深藍桌面＋白框格線，新增一種對戰版面；
 *   經典版、Fable 版都保留；手機版維持現況。站長定稿：
 *   ① 以第一版示意圖為底 ② HP 條放戰鬥寶可夢下方 ③ 備戰卡不顯示名稱（滑鼠移上才顯示）
 *   ④ 能量「同屬性合併 圖示×N」，特殊能量只顯示「特」 ⑤ 寶可夢道具以白框縮圖貼卡片右下（備戰也要）
 *
 * 設計：藍桌墊沿用 Fable 版的幾何（playmat 同時掛 layout-fable 與 layout-blue），
 *   外觀與格線另套 .layout-blue；傷害／能量／道具只在藍桌墊時 render（snippet blueDeco）。
 *
 * 這支守衛怎麼避免自己說謊
 * ──────────────────────────────────────────────────────────────────────────
 *   [A 零回歸・剝除器] 把本版所有改動還原（哨兵區塊整段剝掉＋逐條把替換改回去），
 *        結果必須與 BASE 的 +page.svelte **逐位元相同** ⇒ 證明經典版／桌墊版／Fable 版／手機版
 *        沒有任何一個位元組被動到。並斷言「剝除前後確實不同」（剝除器過期會靜默 no-op）。
 *   [B 接線] 藍桌墊能被選到、會被記住、吃 Fable 幾何（縮放鎖、平板絕緣、卡牌大小滑桿）。
 *   [C 範圍] 藍桌墊的每一條 CSS 選擇器都必須 scope 在 .layout-blue 底下（不外洩到其他版面）；
 *        blueDeco 的四個呼叫點都包在 battleLayout === 'blue' 裡；CSS 區塊在樣式最尾端。
 *   [D 卡面規則] 特殊能量一律顯示「特」、基本能量依屬性合併；裝飾不吃滑鼠（不擋點擊與拖放落點）。
 *   [E 衛生] 雲端截圖用的暫時掛鉤不可以進 commit。
 *   ⭐ HEAD-FAIL：B／C／D 在 BASE 上必紅（BASE 沒有藍桌墊）。
 *
 * ⭐v6.442 藍桌墊重製（IRON_RULES Rule 40：守的意圖不變 —— 其他版面零位元組變動、CSS 不外洩、卡面裁定）：
 *   新增 ① blueDiscTop snippet（同一組哨兵內）＋兩個棄牌堆呼叫點 ② <1024 後備排版內的 v6442-blue-fallback 哨兵區塊
 *   ③ HP 條位置改成固定 px（站長要求「版面永久固定」）。本版的新要求另由 test-v6442-blue-fixed-mat 守。
 *
 * Run: node scripts/test-v6441-blue-layout.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleEndIndex } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）；驗法：git branch -a --contains <sha> 要印得出 main。
const BASE_SHA = '3532ad45551b222da9f22385b50b6c98476e00a6'; // v6.440

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const count = (s, sub) => s.split(sub).length - 1;

console.log('0) 前提');
ok('[前提] 讀得到對戰頁', SRC.length > 900000, String(SRC.length));

// ══════════════════════════════════════════════════════════════════════════
// A. 剝除器：本版改動全部還原後必須逐位元等於 BASE
// ══════════════════════════════════════════════════════════════════════════
console.log('\nA) 零回歸：剝除本版改動後與 BASE 逐位元相同');
// 逐條把「本版的寫法」改回「BASE 的寫法」。每一條都必須恰好命中 1 次（命中 0 次＝剝除器過期）。
const REVERT = [
  ["  let battleLayout = $state<'classic' | 'tabletop' | 'fable' | 'blue'>('classic');\n", "  let battleLayout = $state<'classic' | 'tabletop' | 'fable'>('classic');\n"],
  ["  function setBattleLayout(v: 'classic' | 'tabletop' | 'fable' | 'blue'): void {", "  function setBattleLayout(v: 'classic' | 'tabletop' | 'fable'): void {"],
  ["    if (battleLayout === 'fable' || battleLayout === 'blue') { gameZoom = 1; return; }  // fable／藍桌墊自帶 clamp/vw/vh 尺寸,鎖 gameZoom=1 避免雙重縮放",
   "    if (battleLayout === 'fable') { gameZoom = 1; return; }  // fable 版自帶 clamp/vw/vh 尺寸,鎖 gameZoom=1 避免雙重縮放"],
  ["savedLayout === 'fable' || savedLayout === 'blue') battleLayout = savedLayout;", "savedLayout === 'fable') battleLayout = savedLayout;"],
  ["class:tablet-layout={isTabletLayout && !isFableGeom}", "class:tablet-layout={isTabletLayout && battleLayout !== 'fable'}"],
  ["class:layout-fable={isFableGeom} class:layout-blue={battleLayout === 'blue'}", "class:layout-fable={battleLayout === 'fable'}"],
  ["setBattleLayout(e.currentTarget.value as 'classic' | 'tabletop' | 'fable' | 'blue')}>", "setBattleLayout(e.currentTarget.value as 'classic' | 'tabletop' | 'fable')}>"],
  ["              <option value=\"blue\">🟦 新版桌墊（預設 — 固定格線、能量合併顯示）</option>\n", ""],  // v6.446 正名「新版桌墊」
  // v6.446 站長裁定：桌機預設版面改為新版桌墊（說明註解在 v6446-default-blue 哨兵內，由剝除器拿掉）
  ["      else if (typeof window !== 'undefined' && window.innerWidth >= 1024) battleLayout = 'blue';\n", "      else if (typeof window !== 'undefined' && window.innerWidth >= 1024) battleLayout = 'fable';\n"],
  ["          {#if isFableGeom}\n            <div class=\"setting-row\">\n              <label for=\"fable-card-scale\">", "          {#if battleLayout === 'fable'}\n            <div class=\"setting-row\">\n              <label for=\"fable-card-scale\">"],
];
function strip(src) {
  let s = src;
  const bad = [];
  // ① 哨兵區塊（helper／snippet／CSS）與 isFableGeom 宣告
  const blocks = [
    /\n  \/\/ >>> v6441-blue-helper\n[\s\S]*?\n  \/\/ <<< v6441-blue-helper/,
    /<!-- >>> v6441-blue-snippet -->\n[\s\S]*?<!-- <<< v6441-blue-snippet -->\n/,
    /  \/\* >>> v6441-blue-css \*\/[\s\S]*?  \/\* <<< v6441-blue-css \*\/\n/,
    /  \/\* >>> v6441-blue-geom \*\/[\s\S]*?  \/\* <<< v6441-blue-geom \*\/\n/,
    /    \/\* >>> v6442-blue-fallback \*\/[\s\S]*?    \/\* <<< v6442-blue-fallback \*\/\n/,
    // v6.443：場上卡片放大預覽改放卡片旁邊（只在藍桌墊生效的一段 script，內容由 test-v6443 鎖）
    /    \/\/ >>> v6443-blue-peek\n[\s\S]*?    \/\/ <<< v6443-blue-peek\n/,
    // v6.446：預設版面改新版桌墊的說明註解（哨兵內只准註解，下方另驗）
    /      \/\/ >>> v6446-default-blue\n[\s\S]*?      \/\/ <<< v6446-default-blue\n/,
    /  \/\/ ⭐v6\.441 藍桌墊（blue）＝[\s\S]*?  const isFableGeom = \$derived\(battleLayout === 'fable' \|\| battleLayout === 'blue'\);\n/,
  ];
  for (const re of blocks) { if (!re.test(s)) bad.push(String(re).slice(0, 40)); s = s.replace(re, ''); }
  // ② 四個呼叫點
  const call = /\{#if battleLayout === 'blue'\}\{@render blueDeco\([^)]*\)\}\{\/if\}/g;
  const nCalls = (s.match(call) || []).length;
  s = s.replace(call, '');
  // ②b v6.442 兩個棄牌堆呼叫點
  const dcall = /\{#if battleLayout === 'blue'\}\{@render blueDiscTop\((?:oppPlayer|myPlayer)\?\.discard\)\}\{\/if\}/g;
  const nDisc = (s.match(dcall) || []).length;
  s = s.replace(dcall, '');
  // ③ 逐條還原
  for (const [a, b] of REVERT) { const c = count(s, a); if (c !== 1) bad.push(`還原條目命中 ${c} 次：${a.slice(0, 50)}`); s = s.split(a).join(b); }
  return { s, bad, nCalls, nDisc };
}
const st = strip(SRC);
ok('[剝除器] 每一個哨兵區塊與還原條目都恰好命中（剝除器沒有過期）', st.bad.length === 0, st.bad.join(' ｜ '));
ok('[剝除器] blueDeco 呼叫點恰好 4 個（對手備戰／對手戰鬥／我方戰鬥／我方備戰）', st.nCalls === 4, String(st.nCalls));
ok('[剝除器] blueDiscTop 呼叫點恰好 2 個（對手棄牌／我方棄牌）', st.nDisc === 2, String(st.nDisc));
ok('[剝除器] 剝除後真的有變（否則是靜默 no-op）', st.s !== SRC);
{
  // ⭐ 剝除器只證明「哨兵外面」沒變 ⇒ 哨兵「裡面」要另外鎖內容，否則在哨兵裡夾帶任何東西都會全綠（fable 審查 M7／M8 實證）。
  const hb = /\n  \/\/ >>> v6441-blue-helper\n([\s\S]*?)\n  \/\/ <<< v6441-blue-helper/.exec(SRC);
  const code = hb ? hb[1].split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n') : '';
  const topLevel = [...code.matchAll(/^  (?:const|let|function|\$effect|\$derived)\b[^\n]*/gm)].map((x) => x[0].trim().split(/[\s(<:=]/).slice(0, 2).join(' '));
  ok('★★[哨兵內容] helper 區塊只宣告 BLUE_ZH_TYPE 與 blueEnergyChips 兩個頂層識別字，沒有夾帶其他程式',
    !!hb && JSON.stringify(topLevel) === JSON.stringify(['const BLUE_ZH_TYPE', 'function blueEnergyChips']), JSON.stringify(topLevel));
  ok('★★[哨兵內容] helper 區塊不讀寫任何版面／狀態（無 $effect、$state、battleLayout、fableCardScale、game 寫入）',
    !!hb && !/\$effect|\$state|battleLayout|fableCardScale|setBattleLayout|\bgame\s*=/.test(code));
  const sb = /<!-- >>> v6441-blue-snippet -->\n([\s\S]*?)<!-- <<< v6441-blue-snippet -->/.exec(SRC);
  const sn = sb ? sb[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
  // v6.442：哨兵內恰好兩個 snippet（blueDeco、blueDiscTop），snippet 與 snippet 之間沒有夾帶任何 markup
  const between = sn.replace(/\{#snippet [\s\S]*?\{\/snippet\}/g, '').trim();
  ok('★★[哨兵內容] snippet 區塊只有 blueDeco 與 blueDiscTop 兩個 snippet，外面沒有夾帶任何 markup',
    sn.startsWith('{#snippet blueDeco(') && sn.endsWith('{/snippet}') && count(sn, '{#snippet') === 2 && count(sn, '{/snippet}') === 2
      && sn.includes('{#snippet blueDiscTop(') && between === '', sn.slice(0, 60) + ' … ' + JSON.stringify(between.slice(0, 60)));
  const gb = /  \/\/ ⭐v6\.441 藍桌墊（blue）＝([\s\S]*?)  const isFableGeom = /.exec(SRC);
  ok('★[哨兵內容] isFableGeom 宣告前面只有註解行', !!gb && gb[1].split('\n').slice(1).filter((l) => l.trim()).every((l) => /^\s*\/\//.test(l)));
}
let BASE_SRC = null;
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6441 A：剝除後與 BASE 逐位元比對', '需要 BASE commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 BASE 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    BASE_SRC = r.out.replace(/\r\n/g, '\n');
    ok('★★★[零回歸] 剝除本版改動後，對戰頁與 BASE（v6.440）逐位元相同 ⇒ 經典／桌墊／Fable／手機版面零位元組變動', st.s === BASE_SRC,
      (() => { let i = 0; while (i < st.s.length && st.s[i] === BASE_SRC[i]) i++; return `第一個差異在字元 ${i}：${JSON.stringify(st.s.slice(i, i + 80))} vs ${JSON.stringify(BASE_SRC.slice(i, i + 80))}`; })());
    ok('★★★[HEAD-FAIL] BASE 沒有藍桌墊', !BASE_SRC.includes("'blue'") && !BASE_SRC.includes('layout-blue'));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// B. 接線
// ══════════════════════════════════════════════════════════════════════════
console.log('\nB) 接線');
ok('★★[HEAD-FAIL] 設定面板有「藍桌墊」選項', SRC.includes('<option value="blue">'));
ok('★★[HEAD-FAIL] 重新整理後記得藍桌墊（localStorage 讀回接受 blue）', SRC.includes("savedLayout === 'blue') battleLayout = savedLayout;"));
ok('★★[HEAD-FAIL] 藍桌墊吃 Fable 幾何：playmat 同時掛 layout-fable 與 layout-blue', SRC.includes('class:layout-fable={isFableGeom} class:layout-blue={battleLayout === \'blue\'}'));
ok('★★[HEAD-FAIL] 藍桌墊鎖 gameZoom=1（避免與 --card-w 雙重縮放）', SRC.includes("if (battleLayout === 'fable' || battleLayout === 'blue') { gameZoom = 1; return; }"));
ok('★[HEAD-FAIL] 藍桌墊與平板縮放絕緣', SRC.includes('class:tablet-layout={isTabletLayout && !isFableGeom}'));
ok('★[HEAD-FAIL] 藍桌墊也有卡牌大小滑桿', SRC.includes('{#if isFableGeom}\n            <div class="setting-row">\n              <label for="fable-card-scale">'));
// ⭐v6.446 站長裁定（Rule 40：原本守「預設仍是 Fable」，站長改判預設＝新版桌墊）：只影響從未選過版面的桌機玩家（行為另由 test-v6223【C】實跑）。
ok('★[站長裁定 v6.446] 桌機新玩家的預設版面是新版桌墊（blue），而且只寫在「從未選過」的分支', SRC.includes("      else if (typeof window !== 'undefined' && window.innerWidth >= 1024) battleLayout = 'blue';\n") && !SRC.includes("battleLayout = 'fable';"));
{
  const db = /      \/\/ >>> v6446-default-blue\n([\s\S]*?)      \/\/ <<< v6446-default-blue\n/.exec(SRC);
  ok('★[哨兵內容] v6446-default-blue 哨兵內只有註解', !!db && db[1].split('\n').filter((l) => l.trim()).every((l) => /^\s*\/\//.test(l)));
}
ok('[正名] 設定選項顯示「新版桌墊」，不再出現「藍桌墊」字樣', SRC.includes('<option value="blue">🟦 新版桌墊') && !/<option[^>]*>[^<]*藍桌墊/.test(SRC));
ok('[正對照] 手機直式元件不讀 battleLayout（手機版面維持現況）',
  !readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8').includes('battleLayout'));

// ══════════════════════════════════════════════════════════════════════════
// C. 範圍
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC) 範圍：藍桌墊的 CSS 不外洩');
const m0 = /  \/\* >>> v6441-blue-css \*\/([\s\S]*?)  \/\* <<< v6441-blue-css \*\//.exec(SRC);
const mg = /  \/\* >>> v6441-blue-geom \*\/([\s\S]*?)  \/\* <<< v6441-blue-geom \*\//.exec(SRC);
const mf = /    \/\* >>> v6442-blue-fallback \*\/([\s\S]*?)    \/\* <<< v6442-blue-fallback \*\//.exec(SRC);
const m = m0 && mg && mf ? [null, m0[1] + '\n' + mg[1] + '\n' + mf[1]] : null;
ok('★★[HEAD-FAIL] 找得到藍桌墊 CSS 區塊（外觀＋幾何＋<1024 後備三塊）', !!m);
if (m) {
  ok('★★[媒體查詢] 藍桌墊的兩塊 CSS 一個 @media 都沒有（本頁 @media 數量被 v6187／v6195／v6199 釘住：不准新增媒體查詢當手機開關）', !/@media/.test(m[1]));
  const iG = SRC.indexOf('/* >>> v6441-blue-geom */');
  const iFb = SRC.indexOf('  @media (max-width: 1023px){\n    .playmat.layout-fable{ --card-w-cap:9999px;');
  ok('★★[順序] 幾何區塊在 Fable 基礎規則之後、Fable 後備排版（<1024）之前 ⇒ 桌機吃藍桌墊 grid、窄視窗由後備排版蓋回',
    iG > SRC.indexOf('.playmat.layout-fable{') && iFb > iG && SRC.slice(SRC.indexOf('/* <<< v6441-blue-geom */') + 26, iFb).trim() === '', `${iG} ${iFb}`);
}
if (m) {
  const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
  // 取出所有規則的選擇器（跳過 @media／@keyframes 這種 at-rule 開頭）
  const sels = [];
  let i = 0, buf = '';
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const pre = buf.trim(); buf = '';
      if (!pre.startsWith('@')) {
        for (const x of pre.split(',')) sels.push(x.trim());
        let d = 1; i++; while (i < css.length && d > 0) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; }
        continue;
      }
      i++; continue;
    }
    if (ch === '}') { buf = ''; i++; continue; }
    buf += ch; i++;
  }
  ok('[自我驗證] 解析得出大量選擇器', sels.length > 60, String(sels.length));
  const leak = sels.filter((x) => !/^\.playmat\.layout-blue(?![\w-])/.test(x) && !/^\.battle-root:has\(\.playmat\.layout-blue\)/.test(x));
  ok('★★★[範圍] 每一條選擇器都 scope 在 .playmat.layout-blue 或 .battle-root:has(.playmat.layout-blue) 底下', leak.length === 0, leak.slice(0, 5).join(' ｜ '));
  const iBlue = SRC.indexOf('/* >>> v6441-blue-css */');
  const iEnd = styleEndIndex(SRC, REL);
  ok('★[順序] 藍桌墊 CSS 在 Fable 規則之後、樣式區塊最尾端（同特異度後者勝）',
    iBlue > SRC.indexOf('.playmat.layout-fable{') && SRC.slice(SRC.indexOf('/* <<< v6441-blue-css */'), iEnd).trim() === '/* <<< v6441-blue-css */');
}
const calls = SRC.match(/\{@render blueDeco\([^)]*\)\}/g) || [];
const guarded = SRC.match(/\{#if battleLayout === 'blue'\}\{@render blueDeco\([^)]*\)\}\{\/if\}/g) || [];
ok('★★[HEAD-FAIL／範圍] blueDeco 四個呼叫點全部包在 battleLayout === \'blue\' 裡（其他版面不 render）', calls.length === 4 && guarded.length === 4, `${calls.length}/${guarded.length}`);

// ══════════════════════════════════════════════════════════════════════════
// D. 卡面規則（站長裁定）
// ══════════════════════════════════════════════════════════════════════════
console.log('\nD) 卡面規則');
const h = /\/\/ >>> v6441-blue-helper\n([\s\S]*?)\/\/ <<< v6441-blue-helper/.exec(SRC);
ok('★★[HEAD-FAIL] 找得到藍桌墊能量分組 helper', !!h);
if (h) {
  const body = h[1];
  ok('★★[裁定] 特殊能量一律只顯示「特」（不依卡名折算屬性）', /else special\+\+;/.test(body) && /label: '特'/.test(body) && !/Rainbow/.test(body));
  ok('★[裁定] 基本能量依屬性合併計數（圖示×N）', /basic\.set\(t, \(basic\.get\(t\) \?\? 0\) \+ 1\)/.test(body));
}
if (m) {
  const css = m[1];
  const noPtr = (cls) => new RegExp('\\.playmat\\.layout-blue \\.' + cls + '\\{[^}]*pointer-events:none').test(css);
  // v6.445（fable 審查語意漂移）：v6.444 起道具縮圖的 <img> 本身吃滑鼠（hover 預覽／點開），外框 .bl-tool 仍不吃；拖放判定走 closest(data-drop-type) 不受影響。
  ok('★★[不擋操作] 傷害黃圓／能量列／道具縮圖外框不吃滑鼠事件（縮圖 img 本身例外：v6.444 hover 預覽）', noPtr('bl-dmg') && noPtr('bl-tool') && noPtr('bl-chips'));
  ok('★[裁定] 備戰卡名稱平常不顯示、滑鼠移上才顯示',
    /\.playmat\.layout-blue \.bench-slot \.bench-name,\s*\n\s*\.playmat\.layout-blue \.bench-slot \.bench-stat,[^{]*\{ display:none; \}/.test(css) && /\.bench-slot:hover \.bench-name\{/.test(css));
  ok('★[裁定] 戰鬥寶可夢 HP 條在卡片下方（固定 px 間距）', /\.active-card \.active-hpbar-bottom\{\s*\n\s*top:calc\(100% \+ \d+px\)/.test(css));
}
ok('★[圖片重試] 道具縮圖的動態 <img> 有掛 use:retryImg', /<span class="bl-tool"[\s\S]{0,300}?<img use:retryImg=\{_tc\?\.imageUrl\}/.test(SRC));
ok('★[圖片重試] 棄牌堆最上面那張的動態 <img> 有掛 use:retryImg', /<img class="bl-disc" use:retryImg=\{_dc\.imageUrl\}/.test(SRC));

// ══════════════════════════════════════════════════════════════════════════
// E. 衛生
// ══════════════════════════════════════════════════════════════════════════
console.log('\nE) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot'));

console.log(`\n=== v6.441 藍桌墊版面: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6441-blue-layout ===');
process.exit(fail ? 1 : 0);
