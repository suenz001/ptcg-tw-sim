#!/usr/bin/env node
/**
 * v6.599 守衛：牌組編輯器可設定「先後攻偏好」，選這副牌組時自動帶入（玩家建議）
 *
 * 站長 2026-10-24 裁定：
 *   ①牌組編輯器設定先攻／後攻／隨機；一般對戰（本機／AI、線上房間）與錦標賽選牌組時自動帶入；
 *   ②錦標賽只有新報名才帶入（已報名不回溯）⇒ 只接在報名表的牌組選單上；
 *   ③手動改的偏好不反存回牌組。
 *   另：沒設定過的牌組（舊牌組、內建預組）完全不改動入口原本的選擇（本機／線上會記住上次選的）。
 *
 * 【U】coin-pref.ts：消毒只收三個值；沒設定 ⇒ 回傳入口目前的值（含 'opponent'）；選項清單
 * 【S】接線：本機 P1／P2、線上座位、錦標賽兩個報名表選單都呼叫中央函式；
 *      線上座位不寫「上次選的偏好」、已準備不改；牌組編輯器用獨立元件、'' ＝ 刪欄位、複製／匯入經消毒；
 *      沒有任何地方把偏好寫回牌組（反存）
 * 【B】真瀏覽器（build/）：/decks 桌機與手機，選單顯示牌組的值、改了寫進 localStorage、選「不設定」刪欄位；
 *      手機觸控高度 ≥44px、字級 16px、不撐出橫向捲動
 * 【H】HEAD-FAIL：BASE（v6.598）上 U、S 逐條紅
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = 'a337fea7';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));

async function loadMod(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/decks/coin-pref.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6599-'));
  const O = join(tmp, 'o.mjs');
  try {
    await build({ entryPoints: [join(srcRoot, 'src/lib/decks/coin-pref.ts')], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent' });
    return { ...(await import(pathToFileURL(O).href)) };
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function unitChecks(M) {
  const r = {};
  if (!M) return r;
  const N = M.normalizeDeckCoinPref, O = M.deckCoinPrefOr;
  // U1 消毒：只收 random／first／second；'opponent'（只在一般對戰入口）、大小寫不同、空字串、非字串一律不收
  r.U1 = N('random') === 'random' && N('first') === 'first' && N('second') === 'second'
    && [undefined, null, '', 'opponent', 'First', ' first', 1, {}, ['first']].every((x) => N(x) === undefined);
  // U2 帶入：牌組有設定 ⇒ 用牌組的；沒設定／亂值／沒有牌組 ⇒ 原封回傳目前的值（含 'opponent'，不是一律變隨機）
  r.U2 = O({ coinPref: 'second' }, 'first') === 'second' && O({ coinPref: 'first' }, 'opponent') === 'first'
    && O({ coinPref: 'random' }, 'second') === 'random'
    && O({}, 'opponent') === 'opponent' && O({ coinPref: 'opponent' }, 'first') === 'first' && O({ coinPref: 'x' }, 'second') === 'second'
    && O(undefined, 'first') === 'first' && O(null, 'second') === 'second';
  // U3 選項清單：第一個是「不設定」（''），其餘恰好是三個合法值
  const vals = (M.DECK_COIN_PREF_OPTIONS || []).map((o) => o.value);
  r.U3 = vals.join('|') === '|random|first|second' && JSON.stringify([...(M.DECK_COIN_PREF_VALUES || [])]) === '["random","first","second"]';
  return r;
}

function staticChecks(GAME, DECKS, COMP) {
  const r = {};
  const g = stripCommentsBlank(GAME), d = stripCommentsBlank(DECKS), c = COMP ? stripCommentsBlank(COMP) : '';
  // S1 本機 P1／P2：選單 onchange 解完隨機牌組後，用「這副牌組」帶入「這一位」的偏好
  r.S1 = /bind:value=\{p1DeckId\} onchange=\{\(\) => \{ p1DeckId = resolveDeckSelection\(p1DeckId\); p1FirstPref = deckCoinPrefOr\(allDecks\.find\(\(d\) => d\.id === p1DeckId\), p1FirstPref\); \}\}>/.test(g)
    && /bind:value=\{p2DeckId\} onchange=\{\(\) => \{ p2DeckId = resolveDeckSelection\(p2DeckId\); p2FirstPref = deckCoinPrefOr\(allDecks\.find\(\(d\) => d\.id === p2DeckId\), p2FirstPref\); \}\}>/.test(g);
  // S2 錦標賽：兩個報名表選單（發起社群賽、報名／補報名共用的 regForm）都接、只有這兩處；函式只改 tCoinPref
  const tsel = g.match(/<select class="deck-select" bind:value=\{tDeckId\}[^\n]*/g) || [];
  r.S2 = tsel.length === 2 && tsel.every((x) => x.includes('onchange={(e) => tApplyDeckCoinPref((e.target as HTMLSelectElement).value)}'))
    && /function tApplyDeckCoinPref\(deckId: string\): void \{\s*tCoinPref = deckCoinPrefOr\(allDecks\.find\(\(d\) => d\.id === deckId\), tCoinPref\);\s*\}/.test(g)
    && (g.match(/tApplyDeckCoinPref\(/g) || []).length === 3;
  // S3 線上座位：在 handleDeckChange（玩家這一刻選牌組）裡；牌組有設定、沒準備、跟座位不同才送；不呼叫 _saveFirstPref
  const hdc = g.slice(g.indexOf('async function handleDeckChange('), g.indexOf('async function handleToggleReady('));
  r.S3 = hdc.length > 200 && hdc.length < 2500
    && /const _cp = myDeckId \? normalizeDeckCoinPref\(allDecks\.find\(\(d\) => d\.id === myDeckId\)\?\.coinPref\) : undefined;/.test(hdc)
    && /if \(_deckSet && roomCode && _cp && _seat && !_seat\.ready && \(_seat\.firstChoicePreference \?\? 'random'\) !== _cp\) \{\s*setSeatFirstChoice\(roomCode, _cp\)/.test(hdc)
    && /const _deckSet = myDeckId \? await handleSetDeck\(\) : false;/.test(hdc) 
    && hdc.indexOf('await handleSetDeck()') < hdc.indexOf('setSeatFirstChoice(roomCode, _cp)')
    && !hdc.includes('_saveFirstPref')
    // 牌組沒套上座位 ⇒ handleSetDeck 回 false（審查 P3-1）
    && /async function handleSetDeck\(\): Promise<boolean> \{/.test(g) && /setSeatDeck\(roomCode, deck\.entries, deck\.id\); return true; \}/.test(g)
    && (() => { const hs = g.slice(g.indexOf('async function handleSetDeck('), g.indexOf('function resolveDeckSelection('));
      // 除了套上座位成功那一個 return true，其他每個 return 都是 false（複審 P3-a）
      const rets = hs.match(/return\b[^;]*;/g) || [];
      return hs.length > 200 && rets.length >= 5 && rets.filter((x) => x === 'return true;').length === 1 && rets.filter((x) => x !== 'return true;').every((x) => x === 'return false;'); })();
  // S7 本機「上次選的偏好」只在手動按單選鈕時存（審查 P2-1）：沒有跟著 p1FirstPref 存的 $effect；四個單選鈕各自存
  // 任何 $effect 的同一行都不可以呼叫 _saveFirstPref（寫法換了也抓得到；複審 P3-b）
  r.S7 = !g.split('\n').some((ln) => /\$effect\(/.test(ln) && /_saveFirstPref\(/.test(ln))
    && (g.match(/bind:group=\{p1FirstPref\} onchange=\{\(\) => _saveFirstPref\(p1FirstPref\)\} \/>/g) || []).length === 4
    && (g.match(/bind:group=\{p1FirstPref\}/g) || []).length === 4;
  // S8 對戰頁真的 import 中央函式（少了 import ⇒ 執行時 ReferenceError，test-ts2304-scan 只掃 src/lib 抓不到；審查 P3-3）
  r.S8 = /import \{ deckCoinPrefOr, normalizeDeckCoinPref \} from '\$lib\/decks\/coin-pref';/.test(g)
    && /import \{ normalizeDeckCoinPref \} from '\$lib\/decks\/coin-pref';/.test(d) && /import DeckCoinPref from '\$lib\/decks\/DeckCoinPref\.svelte';/.test(d);
  // S4 不反存：對戰頁沒有任何地方寫牌組的 coinPref（只讀）
  r.S4 = !/coinPref\s*[:=][^=]/.test(g.replace(/coinPref: tCoinPref/g, '').replace(/tCoinPref\s*=/g, '').replace(/myCoinPref/g, ''))
    && !/upsertDeck|syncDeckToCloud/.test(g);
  // S5 牌組編輯器：獨立元件；'' ＝ 刪欄位；預組不顯示；複製與匯入 JSON 都經消毒
  r.S5 = /\{#if !isPresetActive\}\s*\{#key active\.id\}<DeckCoinPref value=\{active\.coinPref\} onchange=\{setActiveCoinPref\} \/>\{\/key\}\s*\{\/if\}/.test(d)
    && /function setActiveCoinPref\(v: string\) \{\s*if \(!active \|\| isPresetActive\) return;\s*const p = normalizeDeckCoinPref\(v\);\s*const updated: Deck = \{ \.\.\.active \};\s*if \(p\) updated\.coinPref = p; else delete updated\.coinPref;\s*decks = upsertDeck\(updated\);\s*setDirty\(updated\.id\);/.test(d)
    && /notes: active\.notes,\s*\.\.\.\(normalizeDeckCoinPref\(active\.coinPref\) \? \{ coinPref: normalizeDeckCoinPref\(active\.coinPref\) \} : \{\}\),/.test(d)
    && /notes: parsed\.notes,\s*\.\.\.\(normalizeDeckCoinPref\(parsed\.coinPref\) \? \{ coinPref: normalizeDeckCoinPref\(parsed\.coinPref\) \} : \{\}\),/.test(d)
    && !/coin-pref-row|dcp-select/.test(d);
  // S6 元件：選項與消毒都讀中央（沒有第二份選項清單）
  r.S6 = /import \{ DECK_COIN_PREF_OPTIONS, normalizeDeckCoinPref \} from '\.\/coin-pref';/.test(c)
    && /\{#each DECK_COIN_PREF_OPTIONS as o \(o\.value\)\}/.test(c) && !/value="first"|value="second"/.test(c)
    && /onchange=\{\(e\) => onchange\(\(e\.target as HTMLSelectElement\)\.value\)\}/.test(c);   // 傳出的是選到的值（審查 P3-3）
  return r;
}

const M = await loadMod(ROOT);
const U = unitChecks(M);
ok('★★★ U1 消毒只收 random／first／second（「對手決定」、亂值一律不收）', U.U1 === true);
ok('★★★ U2 牌組有設定才帶入；沒設定／亂值 ⇒ 入口原本的選擇不變（含「對手決定」）', U.U2 === true);
ok('★★ U3 選項：不設定／隨機／先攻／後攻', U.U3 === true);
const COMP_P = 'src/lib/decks/DeckCoinPref.svelte';
const S = staticChecks(R('src/routes/game/+page.svelte'), R('src/routes/decks/+page.svelte'), existsSync(join(ROOT, COMP_P)) ? R(COMP_P) : '');
ok('★★★ S1 本機／AI：P1、P2 選牌組時各自帶入自己那副牌組的偏好', S.S1 === true);
ok('★★★ S2 錦標賽：只接在兩個報名表的牌組選單（已報名不回溯）', S.S2 === true);
ok('★★★ S3 線上房間：選牌組後才送偏好；已準備不改；不寫「上次選的偏好」', S.S3 === true);
ok('★★ S4 對戰頁不把偏好寫回牌組', S.S4 === true);
ok('★★★ S5 牌組編輯器：獨立元件、「不設定」刪欄位、預組不顯示、複製與匯入經消毒', S.S5 === true);
ok('★★ S6 選單元件的選項與消毒只讀中央、傳出選到的值', S.S6 === true);
ok('★★★ S7 本機「上次選的偏好」只在手動按單選鈕時存（牌組帶入的值不會被記成上次選的）', S.S7 === true);
ok('★★ S8 對戰頁與牌組編輯器真的 import 中央函式與元件', S.S8 === true);

// ── S 的正對照：判準不是恆真（餵一份「線上座位會寫上次偏好」與「錦標賽多一個入口」的突變） ──
{
  const G = R('src/routes/game/+page.svelte');
  const m1 = G.replace("setSeatFirstChoice(roomCode, _cp).catch(console.error);", "_saveFirstPref(_cp); setSeatFirstChoice(roomCode, _cp).catch(console.error);");
  const m2 = G.replace('function tApplyDeckCoinPref(deckId: string): void {', 'function tApplyDeckCoinPref(deckId: string): void { tApplyDeckCoinPref; ');
  const m3 = G.replace("p2FirstPref = deckCoinPrefOr(allDecks.find((d) => d.id === p2DeckId), p2FirstPref);", "p2FirstPref = deckCoinPrefOr(allDecks.find((d) => d.id === p1DeckId), p2FirstPref);");
  const D = R('src/routes/decks/+page.svelte'), C = existsSync(join(ROOT, COMP_P)) ? R(COMP_P) : '';
  ok('★ 正對照：三個接線突變（寫上次偏好／多一個呼叫點／P2 讀 P1 的牌組）各自讓 S 紅',
    m1 !== G && m2 !== G && m3 !== G && staticChecks(m1, D, C).S3 === false && staticChecks(m2, D, C).S2 === false && staticChecks(m3, D, C).S1 === false);
}

// ── B：真瀏覽器 ──
const BUILD = join(ROOT, 'build');
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const chromium = pwChromium('v6.599');
  const browser = chromium ? await pwLaunchWith(chromium, 'v6.599') : null;
  if (!browser) shallowSkip('B（沒有可用的 Chromium）');
  else {
    const now = '2026-10-24T00:00:00.000Z';
    // 對戰頁用的牌組（本機 vs AI 選牌組時帶入）：一副設定後攻、一副沒設定
    const DECKS = [
      { id: 'dk_a', name: '設定後攻的牌組', entries: [], createdAt: now, updatedAt: now, order: 0, coinPref: 'second' },
      { id: 'dk_b', name: '沒設定的牌組', entries: [], createdAt: now, updatedAt: now, order: 1 },
    ];
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
      let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((rs) => srv.listen(0, rs));
    const port = srv.address().port;
    const res = {};
    const mkCtx = async (vp, theme, seed) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp });
      await ctx.addInitScript(([d, t]) => { try { if (d) localStorage.setItem('ptcg-tw-sim:decks', d); localStorage.setItem('ptcg_ui_theme', t); localStorage.setItem('ptcg-tw-sim:lastFirstPref', 'opponent'); } catch { /* */ } }, [seed, theme]);
      await ctx.route(/asia\.pokemon-card\.com|ptcg-tw-sim-img|weserv/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"/>' }));
      await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
      return ctx;
    };
    try {
      // ── /decks：新增兩副牌組（不需要登入），各自設定、切換、清除 ──
      for (const [tag, theme, vp] of [['desk', 'light', { width: 1280, height: 900 }], ['mob', 'dark', { width: 390, height: 844 }]]) {
        const ctx = await mkCtx(vp, theme, null);
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/decks`, { waitUntil: 'load' });
        const add = pg.locator('button', { hasText: '+ 新增' }).first();
        await add.waitFor({ timeout: 30000 }); await add.click(); await pg.waitForTimeout(200); await add.click();
        await pg.waitForSelector('.dcp-select', { timeout: 15000 }); await pg.waitForTimeout(300);
        const stored = () => pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('ptcg-tw-sim:decks') || '[]'); } catch { return []; } });
        const out = { errs };
        out.title = await pg.$eval('.deck-title', (x) => x.value);
        out.v0 = await pg.$eval('.dcp-select', (x) => x.value);
        await pg.selectOption('.dcp-select', 'second'); await pg.waitForTimeout(200);
        out.afterSet = (await stored()).find((x) => x.name === '牌組 2')?.coinPref;
        out.other = (await stored()).find((x) => x.name === '牌組 1')?.coinPref ?? null;
        // 換到另一副：顯示那副牌組自己的值（不沿用上一副）；再換回來：仍是剛才設的值
        await pg.locator('.deck-pick', { hasText: '牌組 1' }).first().click(); await pg.waitForTimeout(300);
        out.v1 = await pg.$eval('.dcp-select', (x) => x.value);
        await pg.locator('.deck-pick', { hasText: '牌組 2' }).first().click(); await pg.waitForTimeout(300);
        out.v2 = await pg.$eval('.dcp-select', (x) => x.value);
        await pg.selectOption('.dcp-select', ''); await pg.waitForTimeout(200);
        out.afterNone = 'coinPref' in ((await stored()).find((x) => x.name === '牌組 2') || { coinPref: 'missing-deck' });
        out.geo = await pg.evaluate(() => {
          const s = document.querySelector('.dcp-select'); const r = s.getBoundingClientRect(); const cs = getComputedStyle(s);
          const box = document.querySelector('.dcp').getBoundingClientRect();
          return { h: Math.round(r.height), fs: cs.fontSize, right: Math.round(Math.max(r.right, box.right)), vw: innerWidth, sw: document.documentElement.scrollWidth };
        });
        res[tag] = out;
        await ctx.close();
      }
      // ── /game 本機 vs AI：選牌組時帶入 ──
      {
        const ctx = await mkCtx({ width: 390, height: 844 }, 'light', JSON.stringify(DECKS));
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
        await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
        await pg.click('.mode-card'); await pg.waitForSelector('select[aria-label="玩家 1 牌組"]', { timeout: 15000 });
        const p1 = () => pg.evaluate(() => { const card = document.querySelector('select[aria-label="玩家 1 牌組"]').closest('.setup-card'); return card?.querySelector('input[type=radio]:checked')?.value ?? null; });
        const out = { errs };
        out.start = await p1();
        await pg.selectOption('select[aria-label="玩家 1 牌組"]', 'dk_b'); await pg.waitForTimeout(200);
        out.noSetting = await p1();
        await pg.selectOption('select[aria-label="玩家 1 牌組"]', 'dk_a'); await pg.waitForTimeout(200);
        out.withSetting = await p1();
        out.lastAfterAuto = await pg.evaluate(() => localStorage.getItem('ptcg-tw-sim:lastFirstPref'));
        // 手動改 ⇒ 以手動為準，且不反存回牌組
        await pg.locator('.setup-card').first().locator('input[type=radio][value="first"]').check(); await pg.waitForTimeout(200);
        out.manual = await p1();
        out.deckAfter = await pg.evaluate(() => JSON.parse(localStorage.getItem('ptcg-tw-sim:decks') || '[]').find((x) => x.id === 'dk_a')?.coinPref);
        out.lastAfterManual = await pg.evaluate(() => localStorage.getItem('ptcg-tw-sim:lastFirstPref'));
        res.game = out;
        await ctx.close();
      }
    } finally { await browser.close(); srv.close(); }
    const good = (x) => x && x.title === '牌組 2' && x.v0 === '' && x.afterSet === 'second' && x.other === null
      && x.v1 === '' && x.v2 === 'second' && x.afterNone === false && x.errs.length === 0;
    ok('★★★ B1 桌機（淺色）：新牌組預設「不設定」；改了寫進那副牌組；換牌組顯示各自的值；「不設定」刪掉欄位', good(res.desk), JSON.stringify(res.desk));
    ok('★★★ B2 手機（深色）：同樣行為', good(res.mob), JSON.stringify(res.mob));
    const gm = res.mob?.geo;
    ok('★★★ B3 手機排版：選單觸控高度 ≥44px、字級 16px（iOS 不放大）、不撐出橫向捲動', !!gm && gm.h >= 44 && gm.fs === '16px' && gm.right <= gm.vw && gm.sw <= gm.vw, JSON.stringify(gm));
    const gg = res.game;
    ok('★★★ B4 對戰頁（本機）：沒設定的牌組不動原本的選擇（對手決定）；設定後攻的牌組帶入後攻且不記成「上次選的」；手動改以手動為準、記成上次選的、不反存',
      !!gg && gg.start === 'opponent' && gg.noSetting === 'opponent' && gg.withSetting === 'second' && gg.manual === 'first' && gg.deckAfter === 'second'
      && gg.lastAfterAuto === 'opponent' && gg.lastAfterManual === 'first' && gg.errs.length === 0, JSON.stringify(gg));
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6599b-'));
  try {
    const { execFileSync } = await import('node:child_process');
    extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
    const bU = unitChecks(await loadMod(tmp));
    const bg = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte'), bd = readBaseBlob(ROOT, BASE_SHA, 'src/routes/decks/+page.svelte');
    const bS = staticChecks(normEol(bg.out), normEol(bd.out), '');
    const red = [...['U1', 'U2', 'U3'].filter((k) => bU[k] !== true), ...['S1', 'S2', 'S3', 'S5', 'S6', 'S7', 'S8'].filter((k) => bS[k] !== true)];
    ok('★★★ HEAD-FAIL：BASE（v6.598）上 U1～U3、S1～S3、S5～S8 逐條紅', red.length === 10, red.join(','));
    ok('★ HEAD-FAIL 正對照：BASE 上 S4（對戰頁不寫回牌組）本來就成立', bS.S4 === true);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.599 牌組先後攻偏好：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
