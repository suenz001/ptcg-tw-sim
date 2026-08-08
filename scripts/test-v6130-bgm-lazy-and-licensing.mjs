/**
 * v6.130 守衛：BGM 曲目上架（站長原創曲）的三條不變式。
 *
 * ① 版權：static/music/ 只准放站長自有的曲目 —— v3.84「為避免版權風險」當初只拿掉了選單
 *    option，三首官方 BGM 的 mp3 檔案還躺在 static/ 裡、仍會被部署，任何人打網址就能下載。
 *    這條網釘住「檔案本身不得復活」，而不只是「選單看不到」。
 * ② 延遲載入：玩家沒選曲目就不得有任何下載 —— <audio> 必須被 {#if bgmTrack !== 'none'} 包住，
 *    且 SW 的 HEAVY_MEDIA 必須仍把 /music/ 排除在安裝預快取外。
 * ③ autoplay：不得使用 <audio autoplay> 屬性 —— 被瀏覽器 autoplay policy 擋下時是**靜默**的，
 *    玩家重整回訪會以為「設定沒存住」。必須改用程式呼叫 play() 才 catch 得到 NotAllowedError。
 *
 * ⚠ 掃描器自身防假綠：每段都有「掃到的東西必須存在」的下限斷言（檔案讀得到、關鍵字找得到），
 *   否則檔案改名/區塊被搬走時，這張網會安靜地全部通過。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// ── ① 版權：static/music/ 白名單 ────────────────────────────────────────────
const MUSIC_DIR = join(ROOT, 'static/music');
const ALLOWED = new Set(['last-card.mp3']);
// 站長沒有授權的官方曲目（v3.84 想移除、v6.130 才真的從檔案層移除）。名稱寫死當黑名單，
// 就算未來白名單被放寬，這三個也不准回來。
const FORBIDDEN = ['Aim to Be a Pokemon Master.mp3', 'Pokemon XYZ Opening.mp3', 'We Go.mp3'];
{
  ok(existsSync(MUSIC_DIR), 'static/music/ 必須存在（掃描器前提）');
  const files = existsSync(MUSIC_DIR) ? readdirSync(MUSIC_DIR).filter(f => !f.startsWith('.')) : [];
  ok(files.length > 0, 'static/music/ 掃到 0 個檔案 → 掃描器壞了或曲目遺失，不是「乾淨」');
  for (const f of files) {
    ok(ALLOWED.has(f),
      `static/music/${f} 不在白名單。這個資料夾會被完整部署上線，任何人打網址就能下載 —— `
      + `只准放站長擁有權利的曲目。要新增請同時更新本守衛的 ALLOWED。`);
  }
  for (const f of FORBIDDEN) {
    ok(!files.includes(f), `static/music/${f} 復活了 —— 這是無授權的官方曲目，不得放進會部署的目錄`);
  }
  ok(files.includes('last-card.mp3'), '站長原創曲 last-card.mp3 必須存在（選單指向它）');
}

// ── ② 延遲載入 ──────────────────────────────────────────────────────────────
const PAGE_RAW = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SW = readFileSync(join(ROOT, 'src/service-worker.ts'), 'utf8');
/**
 * ⚠ 掃描前先剝註解 —— 否定型判定（「不得出現 autoplay」）碰到說明註解必然誤判：
 *   本檔的註解就寫著「⚠ <audio autoplay> 屬性被擋是靜默的…」，第一版守衛的
 *   indexOf('<audio') 正是抓到那行註解、而不是真標籤，三條斷言全部假 FAIL。
 *   （同型教訓：v6.112 的「舊寫法不得復活」守衛被修正說明裡引用的舊寫法抓到。）
 */
const stripComments = (src) => src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const PAGE = stripComments(PAGE_RAW);
{
  ok(PAGE_RAW.length > 500000, `+page.svelte 只讀到 ${PAGE_RAW.length} bytes → 疑似被 mount 截斷，掃描結果不可信`);

  // <audio> 必須在 {#if bgmTrack !== 'none'} 區塊內：取 audio 標籤位置，往回找最近的 {#if
  const audioTags = [...PAGE.matchAll(/<audio\b[\s\S]*?<\/audio>/g)];
  ok(audioTags.length === 1,
    `剝註解後應剛好掃到 1 個 <audio> 元素，實得 ${audioTags.length} → 掃描器錨點失效或多了播放器`);
  const ai = audioTags.length ? audioTags[0].index : -1;
  ok(ai > 0, '找不到 <audio> 元素 → 掃描器錨點失效');
  const before = PAGE.slice(Math.max(0, ai - 600), ai);
  ok(/\{#if\s+bgmTrack\s*!==\s*'none'\}/.test(before),
    '<audio> 必須被 {#if bgmTrack !== \'none\'} 包住 —— 這是「玩家沒選就零下載」的唯一保證；'
    + '一旦改成永遠渲染、只切換 src，所有玩家進站就會吃掉整首歌的流量');

  // SW 預快取排除
  ok(/HEAVY_MEDIA\s*=\s*\(u: string\)\s*=>[^;]*\/music\//.test(SW),
    'service-worker 的 HEAVY_MEDIA 必須仍包含 /music/（把音樂排除在安裝預快取外）');
  ok(/files\.filter\(f\s*=>\s*!HEAVY_MEDIA\(f\)\)/.test(SW),
    'PRECACHE 必須用 HEAVY_MEDIA 過濾 static 檔案，否則音樂會回到安裝預快取');

  // fetch handler 早退（音樂不進 SW 快取；理由見該處註解）
  ok(/if \(event\.request\.url\.includes\('\/music\/'\)\) return;/.test(SW),
    'service-worker 的 fetch handler 必須讓 /music/ 早退（不 respondWith）—— '
    + 'CACHE_NAME 含 version 且只保留兩版，音樂走 SW 快取會隨每次出版蒸發、反覆重抓 5.5MB');
}

// ── ③ autoplay 與曲目白名單一致性 ──────────────────────────────────────────
{
  const tagM = PAGE.match(/<audio\b[\s\S]*?<\/audio>/);
  ok(!!tagM, '找不到 <audio> 元素 → 掃描器錨點失效');
  const tag = tagM ? tagM[0] : '';
  ok(!/^\s*autoplay\s*$/m.test(tag) && !/\sautoplay[\s>]/.test(tag),
    '<audio> 不得帶 autoplay 屬性 —— 被 autoplay policy 擋下時是靜默的（拿不到 promise），'
    + '玩家重整回訪會以為設定沒存住。必須改用 tryPlayBgm() 呼叫 play() 才能 catch NotAllowedError');
  ok(/preload="auto"/.test(tag), '<audio> 應明寫 preload（各瀏覽器缺省值不一致）');
  ok(/\.play\(\)\s*\.then\([\s\S]{0,120}?\)\s*\.catch\(/.test(PAGE),
    '必須有 play().then().catch() —— catch 分支是 autoplay 被擋時的唯一偵測點');
  ok(/pointerdown['"]\s*,\s*unlockBgmOnGesture/.test(PAGE),
    '必須掛 pointerdown 手勢解鎖，否則被擋之後永遠不會補播');
  ok(/removeEventListener\('pointerdown', unlockBgmOnGesture\)/.test(PAGE),
    'onDestroy 必須移除 pointerdown listener（避免 listener leak）');

  // 白名單 ⟺ option ⟺ 實體檔案 三方一致（少任何一邊都會變成 404 或選不到）
  const wl = PAGE.match(/const BGM_TRACKS = \[([^\]]+)\]/);
  ok(!!wl, '找不到 BGM_TRACKS 白名單 → 掃描器錨點失效');
  if (wl) {
    const tracks = [...wl[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(t => t !== 'none');
    ok(tracks.length > 0, 'BGM_TRACKS 除了 none 之外掃到 0 個曲目 → 掃描器壞了');
    for (const t of tracks) {
      ok(new RegExp(`<option value="${t}"`).test(PAGE), `曲目 '${t}' 在白名單卻沒有對應的 <option> → 玩家選不到`);
      ok(existsSync(join(MUSIC_DIR, `${t}.mp3`)), `曲目 '${t}' 在白名單卻沒有 static/music/${t}.mp3 → 選了會 404`);
    }
    // 反向：option 有的也必須在白名單（否則 onMount 的 fallback 會把它退回 none，玩家「選了沒反應」）
    for (const m of PAGE.matchAll(/<option value="([^"]+)"/g)) {
      const v = m[1];
      if (v === 'none' || !/^[a-z0-9-]+$/.test(v)) continue;
      if (existsSync(join(MUSIC_DIR, `${v}.mp3`))) {
        ok(tracks.includes(v), `<option value="${v}"> 有對應 mp3 卻不在 BGM_TRACKS 白名單 → 重整後會被 fallback 退回 none`);
      }
    }
  }
  // 預設必須是關閉
  ok(/let bgmTrack = \$state\('none'\)/.test(PAGE), 'BGM 預設值必須是 none（關閉）');
  const st = readFileSync(join(ROOT, 'src/lib/audio/settings.ts'), 'utf8');
  ok(/localStorage\.getItem\(KEY_BGM_TRACK\) \?\? 'none'/.test(st), 'getBgmTrack 的預設值必須是 none');
}

// ── ④ 掃描器自我驗證：判準必須抓得到刻意植入的違規（防安慰劑）──────────────
{
  const bad = `{#if true}<audio src="x" loop autoplay></audio>{/if}`;
  const badTag = bad.match(/<audio\b[\s\S]*?<\/audio>/)[0];
  ok(/\sautoplay[\s>]/.test(badTag), '正對照：autoplay 判準必須抓得到帶 autoplay 的樣本');
  const good = `<audio src="x" loop preload="auto"></audio>`;
  ok(!/\sautoplay[\s>]/.test(good.match(/<audio\b[\s\S]*?<\/audio>/)[0]),
    '反向對照：合法寫法不得被誤判成帶 autoplay');
  // 剝註解器本身
  ok(stripComments('a <!-- <audio autoplay> --> b').includes('autoplay') === false,
    '正對照：stripComments 必須剝掉 HTML 註解（第一版守衛就是敗在這）');
  ok(stripComments('  // <audio autoplay>\nreal').includes('autoplay') === false,
    '正對照：stripComments 必須剝掉 // 行註解');
}

console.log(`\nv6130 BGM 延遲載入與版權守衛：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
