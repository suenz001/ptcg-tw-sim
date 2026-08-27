/**
 * audit-card-data-vs-official.mjs — 卡片資料 vs 官方卡面 稽核工具（只比對、絕不寫入）
 *
 * 背景：v6.231 後發現 19536（M-P-J 菊草葉 155/M-P）整筆從 14084（M-P-I 012/M-P）
 * 錯誤 clone —— 招式記成「飛葉快刀 20」，官方卡面實為「叫聲＋種子炸彈 30」，
 * 連 illustrator 都抄錯（官方是 Kariya，DB 記成 Makura Tami）。
 * 這種「被抄成同名別版」的汙染無法從 DB 內部交叉比對抓出來，只能重抓官方卡面逐欄比對。
 *
 * 行為：
 *   1. 讀 static/cards/{SET}.json（唯讀），對每張卡的官方 detail 頁重新抓取，
 *      沿用既有的 scripts/scrape/parse-card.js 解析（絕不另寫一份解析器，兩份必然漂移）。
 *   2. 逐欄比對，輸出差異報告到 tournament-dumps/card-audit/。
 *   3. ⭐ 開跑前先跑「19536 試金石」自我檢測：
 *      抓到「叫聲＋種子炸彈」⇒ 解析器可信，稽核結果可信；
 *      抓到「飛葉快刀」⇒ 解析器本身有 bug，稽核結果不可信，要先修 parse-card.js。
 *   4. ⚠ 絕不寫入 static/cards/*.json，也絕不重生 index.json。
 *
 * 用法（在 repo 根目錄）：
 *   node scripts/audit-card-data-vs-official.mjs                       # 預設 M-P-H M-P-I M-P-J
 *   node scripts/audit-card-data-vs-official.mjs M-P-J                 # 指定卡包
 *   node scripts/audit-card-data-vs-official.mjs --delay 800 --resume  # 客製 delay／續跑
 *
 * 輸出：
 *   tournament-dumps/card-audit/card-audit-report.md    — 給站長看的差異報告
 *   tournament-dumps/card-audit/card-audit-report.json  — 機器可讀版
 *   tournament-dumps/card-audit/official-cache-{SET}.json — 抓取快取（--resume 用）
 *
 * 禮貌抓取：沿用 scrape-set.js 的 delay（預設 600ms）與 User-Agent。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard } from './scrape/parse-card.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CARDS_DIR = path.join(REPO_ROOT, 'static', 'cards');
const OUT_DIR = path.join(REPO_ROOT, 'tournament-dumps', 'card-audit');

const BASE = 'https://asia.pokemon-card.com';
// 與 scrape-set.js 相同的 UA（禮貌抓取，表明身分）
const UA = 'Mozilla/5.0 (PTCG-TW-Sim scraper; contact: github.com/suenz001/ptcg-tw-sim)';

// ⭐ 試金石：19536 = M-P-J 菊草葉 155/M-P。
// 站長已對照官方卡面：真實招式是「叫聲」＋「種子炸彈 30」；
// 我們 DB 被錯誤 clone 成「飛葉快刀 20」（抄自 14084）。
// 解析器若抓到種子炸彈 ⇒ 解析器可信；若抓到飛葉快刀 ⇒ 解析器有 bug。
const TOUCHSTONE_ID = '19536';
const TOUCHSTONE_EXPECT = ['叫聲', '種子炸彈'];
const TOUCHSTONE_WRONG = '飛葉快刀';

// ⭐ 已知的「刻意偏離官方」白名單（站長裁定）—— 這些差異**不再**列為遊戲性差異。
// ⚠ 每筆都要求 ours／official 兩側的值逐字匹配；任一側改變（官方又改名／我們的資料被動到）
//    就不再匹配 ⇒ 自動回到差異報告（fail-open），不會靜默吞掉新的變化。
const KNOWN_INTENTIONAL_DIVERGENCES = [
  {
    id: '19630', field: 'name',
    ours: '老大的指令', official: '老大的指令（烏羽）',
    reason: '站長 v6.193 裁定沿用「老大的指令」：引擎以卡名查效果實作，改名會連動一大串；'
      + '守衛＝test-v6193-hk-dup-and-boss-rename.mjs'
  },
  {
    id: '13145', field: 'attacks',
    ours: '[{"name":"麻麻關節","cost":"Colorless","damage":"20","effect":"擲1次硬幣若為正面，則將對手的戰鬥寶可夢【麻痺】。"},{"name":"強力伏特","cost":"Colorless+Lightning+Lightning","damage":"120","effect":"選擇1個這隻寶可夢身上附加的能量，將其丟棄。"}]',
    official: '[{"name":"麻麻關節","cost":"Colorless","damage":"20","effect":"擲1次硬幣若為正面，則可將對手的戰鬥寶可夢【麻痺】。"},{"name":"強力伏特","cost":"Colorless+Lightning+Lightning","damage":"120","effect":"選擇1個這隻寶可夢身上附加的能量，將其丟棄。"}]',
    reason: '站長 v6.241 裁定：**官方頁面自身的文字有誤** —— SVQP 捷拉奧拉｜麻麻關節寫成'
      + '「則【可】將對手的戰鬥寶可夢【麻痺】」，多一個「可」字（讀起來像「可以選擇要不要麻痺」）。'
      + '同名同招式的另外兩個印刷（MC 16737、SV5M 9870）以及站內同型的擲幣附加狀態招式一律是「則將」，'
      + '實作端本來就是「正面＝必定麻痺」⇒ 我方以正確卡面為準，不跟著官方頁面的錯字。'
      + '⚠ 這筆豁免是 fail-open：只要官方哪天把錯字修掉（或我們的資料被改動），兩側值就不再逐字匹配，'
      + '這張卡會自動回到差異報告。守衛＝test-v6241-zeraora-text-and-archetype-fullscan.mjs'
  },
];
// ⭐ 官方頁已下架、但本站已依站長裁定處理完畢的卡（v6.194 對玩家隱藏、資料保留供舊牌組／回放）。
const KNOWN_PAGE_GONE_HIDDEN = {
  '18965': '已於 v6.194 對玩家隱藏（HIDDEN_FROM_PLAYERS，台版為 18560），資料保留供舊牌組與回放',
  '18969': '已於 v6.194 對玩家隱藏（HIDDEN_FROM_PLAYERS，台版為 18564），資料保留供舊牌組與回放',
};

// 遊戲性欄位（差異 = 真 bug，會影響對局）
const GAME_FIELDS = [
  'name', 'supertype', 'subtype', 'stage', 'hp', 'pokemonType',
  'evolvesFrom', 'attacks', 'abilities', 'weakness', 'resistance',
  'retreatCost', 'rulesText', 'regulationMark', 'collectorNumber'
];
// 非遊戲性欄位（分開列示，避免淹沒真正重要的差異）
// scrapedAt 每次必不同，直接跳過不比。
const INFO_FIELDS = ['illustrator', 'imageUrl', 'setCode', 'tags'];

function parseArgs(argv) {
  const args = { sets: [], delayMs: 600, resume: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--delay') args.delayMs = parseInt(argv[++i], 10);
    else if (a === '--resume') args.resume = true;
    else args.sets.push(a);
  }
  if (args.sets.length === 0) args.sets = ['M-P-H', 'M-P-I', 'M-P-J'];
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  // 官方已下架的卡片 detail 頁會被 302 導回搜尋列表頁 —— 那不是卡片資料，
  // 不可拿來比對（會產生整排「(無)」的假差異）。
  if (res.url && !res.url.includes('/detail/')) {
    const err = new Error(`官方頁面不存在（被導回 ${res.url}）`);
    err.pageGone = true;
    throw err;
  }
  return html;
}

/** 文字正規化：去零寬字元、摺疊空白（避免排版差異被誤報成差異） */
function normText(s) {
  if (s == null) return '';
  return String(s).replace(/[\u200B\u200C\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

/** 能量陣列比對用：排序後 join（cost/retreatCost 顯示順序不影響遊戲性） */
function normEnergyArr(arr) {
  return Array.isArray(arr) ? [...arr].sort().join('+') : '';
}

/** 招式陣列 → 可比對的正規化形狀 */
function normAttacks(arr) {
  return (arr || []).map((a) => ({
    name: normText(a.name),
    cost: normEnergyArr(a.cost),
    damage: normText(a.damage),
    effect: normText(a.effect)
  }));
}

/** 特性陣列 → 可比對的正規化形狀 */
function normAbilities(arr) {
  return (arr || []).map((a) => ({
    label: normText(a.label),
    name: normText(a.name),
    effect: normText(a.effect)
  }));
}

/** 單欄比對 → 差異物件或 null */
function diffField(field, ours, official) {
  let a, b;
  switch (field) {
    case 'attacks':
      a = JSON.stringify(normAttacks(ours));
      b = JSON.stringify(normAttacks(official));
      break;
    case 'abilities':
      a = JSON.stringify(normAbilities(ours));
      b = JSON.stringify(normAbilities(official));
      break;
    case 'retreatCost':
      a = normEnergyArr(ours);
      b = normEnergyArr(official);
      break;
    case 'weakness':
    case 'resistance':
      a = ours ? `${ours.type} ${normText(ours.value)}` : '(無)';
      b = official ? `${official.type} ${normText(official.value)}` : '(無)';
      break;
    case 'hp':
      a = ours == null ? '(無)' : String(ours);
      b = official == null ? '(無)' : String(official);
      break;
    case 'tags':
      a = Array.isArray(ours) ? [...ours].sort().join('、') : '(無)';
      b = Array.isArray(official) ? [...official].sort().join('、') : '(無)';
      break;
    default:
      a = normText(ours) || '(無)';
      b = normText(official) || '(無)';
  }
  if (a === b) return null;
  return { field, ours: a, official: b };
}

/** 把差異渲染成人看的 Markdown 區塊 */
function renderCardDiff(card, gameDiffs, infoDiffs) {
  const lines = [];
  lines.push(`### ${card.name}（cardId ${card.id}，${card.collectorNumber || '?'}，${card.regulationMark || '?'} 標）`);
  if (gameDiffs.length) {
    lines.push('');
    lines.push('| 欄位 | 我們的值 | 官方卡面 |');
    lines.push('|---|---|---|');
    for (const d of gameDiffs) {
      lines.push(`| **${d.field}** | ${mdEscape(d.ours)} | ${mdEscape(d.official)}${d.note ? '（' + mdEscape(d.note) + '）' : ''} |`);
    }
  }
  if (infoDiffs.length) {
    lines.push('');
    lines.push('非遊戲性欄位差異（參考用，不影響對局）：');
    lines.push('');
    lines.push('| 欄位 | 我們的值 | 官方卡面 |');
    lines.push('|---|---|---|');
    for (const d of infoDiffs) {
      lines.push(`| ${d.field} | ${mdEscape(d.ours)} | ${mdEscape(d.official)}${d.note ? '（' + mdEscape(d.note) + '）' : ''} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function loadJsonOrNull(fp) {
  try {
    return JSON.parse(await fs.readFile(fp, 'utf8'));
  } catch {
    return null;
  }
}

async function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

/** ⭐ 試金石自我檢測：回傳 { verdict: 'PASS'|'FAIL'|'NETWORK_ERROR', detail } */
async function runTouchstone() {
  const url = `${BASE}/tw/card-search/detail/${TOUCHSTONE_ID}/`;
  let html;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    return { verdict: 'NETWORK_ERROR', detail: `無法連到官網：${e.message}` };
  }
  const card = parseCard(html, TOUCHSTONE_ID, url, 'M-P');
  const names = (card.attacks || []).map((a) => normText(a.name));
  const hasExpected = TOUCHSTONE_EXPECT.every((n) => names.includes(n));
  const hasWrong = names.includes(TOUCHSTONE_WRONG);
  if (hasExpected && !hasWrong) {
    return {
      verdict: 'PASS',
      detail: `19536 菊草葉重新解析出招式：${names.join('、')}（含「種子炸彈」）` +
        ` ⇒ 解析器沒問題，DB 的「飛葉快刀」是錯誤 clone 汙染 ⇒ 本稽核結果可信。`
    };
  }
  return {
    verdict: 'FAIL',
    detail: `19536 菊草葉重新解析出招式：${names.join('、') || '(空)'}` +
      `，未同時包含「${TOUCHSTONE_EXPECT.join('」「')}」` +
      (hasWrong ? '（且出現了錯誤的「飛葉快刀」）' : '') +
      ` ⇒ ⚠ parse-card.js 解析器本身可能有 bug，本稽核結果【不可信】，請先修解析器再跑。`
  };
}

async function main() {
  const args = parseArgs(process.argv);
  console.error(`卡片資料稽核（只比對、不寫入）— 卡包：${args.sets.join(', ')}，delay=${args.delayMs}ms，resume=${args.resume}`);

  await fs.mkdir(OUT_DIR, { recursive: true });

  // ── 步驟 1：試金石自我檢測 ──
  console.error('\n[1/3] ⭐ 試金石自我檢測（19536 菊草葉）...');
  const touchstone = await runTouchstone();
  if (touchstone.verdict === 'NETWORK_ERROR') {
    console.error(`  ❌ ${touchstone.detail}`);
    console.error('  （這台機器連不到 asia.pokemon-card.com，請換能連到官網的機器跑。）');
    process.exit(2);
  }
  const tsBanner = touchstone.verdict === 'PASS'
    ? `✅ 試金石通過 — ${touchstone.detail}`
    : `❌ 試金石失敗 — ${touchstone.detail}`;
  console.error(`  ${tsBanner}`);
  if (touchstone.verdict === 'FAIL') {
    // 解析器不可信仍照跑（讓站長看到全貌），但報告最上方會用大字警告。
    console.error('  ⚠ 繼續執行，但報告會標示「結果不可信」。');
  }

  // ── 步驟 2：逐卡抓取 + 比對 ──
  const report = {
    generatedAt: new Date().toISOString(),
    touchstone,
    sets: {},
    totals: { cards: 0, fetched: 0, fetchFailed: 0, gameDiffCards: 0, waivedCards: 0, evoOnlyDiffCards: 0, pageGone: 0, infoOnlyDiffCards: 0 }
  };
  const mdCards = []; // 各卡差異的 Markdown 區塊
  const mdWaived = []; // 白名單（刻意偏離官方）
  const mdEvo = [];
  const mdInfoOnly = [];

  for (const setCode of args.sets) {
    const localPath = path.join(CARDS_DIR, `${setCode}.json`);
    const local = await loadJsonOrNull(localPath);
    if (!Array.isArray(local)) {
      console.error(`\n[2/3] ⚠ 讀不到 ${localPath}，跳過此卡包`);
      report.sets[setCode] = { error: `讀不到 static/cards/${setCode}.json` };
      continue;
    }
    console.error(`\n[2/3] ${setCode}：${local.length} 張卡`);
    report.totals.cards += local.length;

    // 抓取快取（--resume 用）：id → 官方解析結果
    const cachePath = path.join(OUT_DIR, `official-cache-${setCode}.json`);
    const cache = (args.resume ? await loadJsonOrNull(cachePath) : null) || {};

    const setResult = { cards: local.length, gameDiff: [], waived: [], evoDiff: [], pageGone: [], infoOnlyDiff: [], fetchFailed: [] };
    let done = 0;
    for (const ours of local) {
      const id = String(ours.id);
      let official = cache[id];
      if (!official) {
        const url = `${BASE}/tw/card-search/detail/${id}/`;
        try {
          await sleep(args.delayMs); // 禮貌抓取
          const html = await fetchHtml(url);
          official = parseCard(html, id, url, ours.setCode || null);
          // 官方頁若沒有 alpha 標記（基本能量 promo 常見），parse-card 會用
          // SET_REGULATION_MARK fallback 補值（M-P → 'J'）—— 那不是卡面上的
          // 標記，比對時要降級為參考資訊，避免誤報。
          if (!/class="alpha"/.test(html)) official._regFallback = true;
          cache[id] = official;
          report.totals.fetched++;
          // 每 10 張存一次快取，斷線可 --resume 續跑
          if (report.totals.fetched % 10 === 0) {
            await writeAtomic(cachePath, JSON.stringify(cache, null, 1));
          }
        } catch (e) {
          if (e.pageGone) {
            report.totals.pageGone++;
            setResult.pageGone.push({ id, name: ours.name, collectorNumber: ours.collectorNumber, error: e.message, note: KNOWN_PAGE_GONE_HIDDEN[id] || null });
            console.error(`  [${++done}/${local.length}] ${id} ${ours.name} ⚠ 官方頁面不存在：${e.message}`);
          } else {
            report.totals.fetchFailed++;
            setResult.fetchFailed.push({ id, name: ours.name, error: e.message });
            console.error(`  [${++done}/${local.length}] ${id} ${ours.name} 抓取失敗：${e.message}`);
          }
          continue;
        }
      }
      done++;

      const gameDiffs = [];
      const waivedDiffs = [];
      const evoDiffs = [];
      const infoDiffs = [];
      for (const f of GAME_FIELDS) {
        const d = diffField(f, ours[f], official[f]);
        if (!d) continue;
        // ⭐ 白名單：站長已裁定的刻意偏離 —— 兩側值都逐字匹配才豁免（fail-open）
        const waiver = KNOWN_INTENTIONAL_DIVERGENCES.find((w) =>
          w.id === id && w.field === f && normText(w.ours) === d.ours && normText(w.official) === d.official);
        if (waiver) { d.note = waiver.reason; waivedDiffs.push(d); continue; }
        if (f === 'regulationMark' && official._regFallback) {
          // 官方頁沒有 alpha 標記，official 值是 fallback 補的 —— 降級為參考資訊
          d.note = '官方頁無標記，此值為 SET_REGULATION_MARK fallback 補值，多半是誤報';
          infoDiffs.push(d);
        } else if (f === 'evolvesFrom') {
          // scraper 已知限制（Mega 鏈／分支進化常誤判），另列一區請人工判讀
          evoDiffs.push(d);
        } else {
          gameDiffs.push(d);
        }
      }
      for (const f of INFO_FIELDS) {
        const d = diffField(f, ours[f], official[f]);
        if (d) infoDiffs.push(d);
      }

      if (gameDiffs.length) {
        // 有硬差異的卡：evolvesFrom 差異也一併列出（同一張卡整筆看）
        setResult.gameDiff.push({ id, name: ours.name, collectorNumber: ours.collectorNumber, gameDiffs, evoDiffs, infoDiffs });
        mdCards.push(renderCardDiff(ours, [...gameDiffs, ...evoDiffs], infoDiffs));
        console.error(`  [${done}/${local.length}] ${id} ${ours.name} ⚠ 遊戲性差異 ${gameDiffs.length} 欄（${gameDiffs.map((d) => d.field).join('、')}）`);
      } else if (waivedDiffs.length) {
        setResult.waived.push({ id, name: ours.name, collectorNumber: ours.collectorNumber, waivedDiffs, infoDiffs });
        mdWaived.push(renderCardDiff(ours, waivedDiffs, []));
        console.error(`  [${done}/${local.length}] ${id} ${ours.name} ⚪ 白名單：刻意偏離官方（${waivedDiffs.map((d) => d.field).join('、')}）`);
      } else if (evoDiffs.length) {
        setResult.evoDiff.push({ id, name: ours.name, collectorNumber: ours.collectorNumber, evoDiffs, infoDiffs });
        mdEvo.push(renderCardDiff(ours, evoDiffs, []));
      } else if (infoDiffs.length) {
        setResult.infoOnlyDiff.push({ id, name: ours.name, collectorNumber: ours.collectorNumber, infoDiffs });
        mdInfoOnly.push(renderCardDiff(ours, [], infoDiffs));
      }
      if (done % 20 === 0) console.error(`  ...進度 ${done}/${local.length}`);
    }
    await writeAtomic(cachePath, JSON.stringify(cache, null, 1));
    report.totals.gameDiffCards += setResult.gameDiff.length;
    report.totals.waivedCards += setResult.waived.length;
    report.totals.evoOnlyDiffCards += setResult.evoDiff.length;
    report.totals.infoOnlyDiffCards += setResult.infoOnlyDiff.length;
    report.sets[setCode] = setResult;
    console.error(`  ${setCode} 完成：遊戲性差異 ${setResult.gameDiff.length} 張、evolvesFrom 疑義 ${setResult.evoDiff.length} 張、官方頁不存在 ${setResult.pageGone.length} 張、僅非遊戲性差異 ${setResult.infoOnlyDiff.length} 張、抓取失敗 ${setResult.fetchFailed.length} 張`);
  }

  // ── 步驟 3：輸出報告 ──
  console.error('\n[3/3] 寫報告...');
  const md = [];
  md.push('# 卡片資料 vs 官方卡面 稽核報告');
  md.push('');
  md.push(`- 產生時間：${report.generatedAt}`);
  md.push(`- 稽核卡包：${args.sets.join(', ')}`);
  md.push(`- 本工具**只比對、不寫入** —— \`static/cards/\` 完全未被修改。`);
  md.push('');
  md.push('## ⭐ 解析器自我檢測（19536 試金石）');
  md.push('');
  md.push(touchstone.verdict === 'PASS' ? `✅ **通過** — ${touchstone.detail}` : `❌ **失敗** — ${touchstone.detail}`);
  md.push('');
  md.push('## 總結');
  md.push('');
  md.push(`| 項目 | 數量 |`);
  md.push(`|---|---|`);
  md.push(`| 稽核卡片總數 | ${report.totals.cards} |`);
  md.push(`| 本次實際抓取 | ${report.totals.fetched} |`);
  md.push(`| 抓取失敗 | ${report.totals.fetchFailed} |`);
  md.push(`| ⚠ **有遊戲性差異的卡** | **${report.totals.gameDiffCards}** |`);
  md.push(`| 已知刻意偏離官方（白名單，站長已裁定） | ${report.totals.waivedCards} |`);
  md.push(`| evolvesFrom 疑義（scraper 已知限制，多為誤報） | ${report.totals.evoOnlyDiffCards} |`);
  md.push(`| ⚠ 官方頁面已不存在的卡 | ${report.totals.pageGone} |`);
  md.push(`| 僅非遊戲性差異的卡 | ${report.totals.infoOnlyDiffCards} |`);
  md.push('');
  for (const [setCode, r] of Object.entries(report.sets)) {
    if (r.error) { md.push(`- ${setCode}：${r.error}`); continue; }
    md.push(`- ${setCode}：${r.cards} 張，遊戲性差異 **${r.gameDiff.length}** 張，evolvesFrom 疑義 ${r.evoDiff.length} 張，官方頁不存在 ${r.pageGone.length} 張，僅非遊戲性差異 ${r.infoOnlyDiff.length} 張，抓取失敗 ${r.fetchFailed.length} 張`);
  }
  md.push('');
  md.push('> 註：`evolvesFrom` 的差異可能是 scraper 已知限制（化石進化鏈／分支進化，' );
  md.push('> 靠 migration 腳本補回），不一定是 DB 錯，請個案判讀。');
  md.push('> `tags` 列在非遊戲性區，因為官方單卡頁抓不到 古代/未來/ACE SPEC 等 tag（需另走 list filter）。');
  md.push('> `regulationMark` 差異請注意：官方 promo 頁的 alpha 標記可能隨「最新再印」更新');
  md.push('> （同一 detail 頁改顯示新標，實測 14102 基本【草】能量頁面現在印 J，我們抓的當時是 I），');
  md.push('> 且基本能量卡不受輪替限制 —— 這類差異屬低優先，請對照實體卡面判讀。');
  md.push('');
  md.push('## ⚠ 遊戲性差異（會影響對局，需逐張人工確認）');
  md.push('');
  md.push(mdCards.length ? mdCards.join('\n') : '（無 — 所有卡的遊戲性欄位都與官方一致）');
  md.push('');
  md.push('## 已知的刻意偏離官方（站長已裁定的白名單 —— 不列為差異；兩側值任一改變會自動回到上面的差異區）');
  md.push('');
  md.push(mdWaived.length ? mdWaived.join('\n') : '（無）');
  md.push('');
  md.push('## evolvesFrom 疑義（scraper 已知限制：Mega 進化鏈／分支進化常誤判，多半是我們手修過的值才正確，請個案判讀）');
  md.push('');
  md.push(mdEvo.length ? mdEvo.join('\n') : '（無）');
  md.push('');
  md.push('## ⚠ 官方頁面已不存在的卡（detail 頁被導回搜尋頁，官方可能已下架/合併，需人工確認）');
  md.push('');
  const goneList = Object.entries(report.sets).flatMap(([s, r]) => (r.pageGone || []).map((g) => `- ${s} ${g.id} ${g.name}（${g.collectorNumber || '?'}）：${g.error}${g.note ? '（' + g.note + '）' : ''}`));
  md.push(goneList.length ? goneList.join('\n') : '（無）');
  md.push('');
  md.push('## 僅非遊戲性差異（illustrator / imageUrl / setCode / tags）');
  md.push('');
  md.push(mdInfoOnly.length ? mdInfoOnly.join('\n') : '（無）');
  md.push('');
  const failList = Object.entries(report.sets).flatMap(([s, r]) => (r.fetchFailed || []).map((f) => `- ${s} ${f.id} ${f.name}：${f.error}`));
  if (failList.length) {
    md.push('## 抓取失敗（可用 --resume 重跑補齊）');
    md.push('');
    md.push(failList.join('\n'));
    md.push('');
  }

  const mdPath = path.join(OUT_DIR, 'card-audit-report.md');
  const jsonPath = path.join(OUT_DIR, 'card-audit-report.json');
  await writeAtomic(mdPath, md.join('\n'));
  await writeAtomic(jsonPath, JSON.stringify(report, null, 2));
  console.error(`完成。報告：`);
  console.error(`  ${mdPath}`);
  console.error(`  ${jsonPath}`);
  console.error(`遊戲性差異 ${report.totals.gameDiffCards} 張、evolvesFrom 疑義 ${report.totals.evoOnlyDiffCards} 張、官方頁不存在 ${report.totals.pageGone} 張、僅非遊戲性差異 ${report.totals.infoOnlyDiffCards} 張、抓取失敗 ${report.totals.fetchFailed} 張。`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
