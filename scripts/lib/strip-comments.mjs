// ⭐ 中央 helper：「先剝註解、再做字串計數」—— 給所有用
//   `text.split(token).length - 1` 當守衛的腳本共用，別再各自重刻。
//
// ── 為什麼需要它（三起實證事故）────────────────────────────────────────────
//  (1) 假紅：test-v6277【Gc】把 game/+page.svelte 裡一行**註解**提到的
//      `loadDecksFromCloud` 算成 Firestore 呼叫點（2 → 3），在完整 git 歷史下誤紅。
//  (2) 假綠（更危險）：第 13 種守衛安慰劑 —— 用 `/\/\*[\s\S]*?\*\//g` 剝區塊註解，
//      `//` 註解裡的 `/api/tournament/*` 被當成區塊開頭，**一路吃掉 176 行真程式碼**
//      （v6.310 的 game/+page.svelte :208～:384；server_admin_patch.js 更有一段吃 543 行；
//      oracle-admin/admin.html :829 起也有一段 511 行）。吃掉之後什麼都數不到 ⇒
//      「恰一處」「零引用」這類斷言全變恆真。
//  (3) 假綠（v6.311 自己留下的）：v6.311 的第一版只看「行首是不是 //、/*、*、<!--」就丟整行，
//      所以下面四種**合法程式碼**會被整行吃掉（獨立審查者用突變實證，每一種都對表假綠）：
//        B1 `/* 註解 */ const again = await loadDecksFromCloud(u.uid);`   （單行區塊後接程式碼）
//        B2 `  * (await loadDecksFromCloud(u.uid)).length;`               （乘法運算式續行）
//        B3 `<!-- x --> {await loadDecksFromCloud(u.uid)}`               （模板註解後接運算式）
//        B4 `  */ const again = await loadDecksFromCloud(u.uid);`         （區塊收尾行接程式碼）
//      ⚠ v6.311 檔頭寫「絕不會少算程式碼」是**錯的**，v6.312 訂正。
//
// ── v6.312 的做法：行級**狀態機**，所有含糊處一律「保留」（假紅方向）─────────────
//   規則（逐行）：
//     a. 不在區塊內、trim 後以 `//` 開頭 ⇒ 丟整行。
//        （⚠ 這是唯一「信任行首」的規則。JS/TS/CSS 裡行首 `//` 必是註解；Svelte 模板文字行
//          以 `//` 開頭且夾帶 `{運算式}` 極罕見，接受此殘餘風險並在此明寫。）
//     b. 不在區塊內、trim 後以 `/*` 或 `<!--` 開頭：
//        - 同一行找得到對應的 `*/`／`-->` ⇒ 只丟到收尾符為止，**收尾後的尾巴保留**（B1、B3）。
//        - 找不到 ⇒ 進入區塊，本行丟。
//     c. 在區塊內：找不到收尾符 ⇒ 整行丟；找得到 ⇒ 關閉區塊，**尾巴保留**（B4）。
//     d. 其餘一律保留 —— 包含行尾註解、以 `*` 開頭但不在區塊內的行（B2 與「區塊在行中開啟」的
//        續行都算這類；前者是程式碼，後者是註解但方向是保守的假紅）。
//   ⚠⚠ 區塊只在行首開啟，不會被 `// … /api/x/*` 這種行中的 `/*` 觸發（事故 2 的根因）——
//       這一句由 test-v6277 H22（OPEN_MIDLINE 突變）與 test-lib-strip-comments【4】撐著，不是口頭宣稱。
//   ⚠⚠ 千萬不要在這裡加回 block regex —— 1.4MB 的 svelte 檔裡滿是網址、正則、字串。
//
// ── v6.323：同一次掃描、兩種輸出 ───────────────────────────────────────────
//   狀態機只跑一次，產出 `keepFrom[i]`（每行從第幾個字元起保留；-1 ＝ 整行丟）這份**唯一真相**，
//   再由兩個純渲染函式各自輸出：
//     · stripCommentLines()／stripCommentsChecked()      —— 刪行（原 v6.312 行為，長度變短）
//     · stripCommentsBlank()／stripCommentsBlankChecked() —— 等長留白（丟掉的字元換成空格、
//       `\n`／`\r` 與總長度不變）—— 給靠**行號／位移**回報的守衛用（v6146／v6246 那一類）。
//   ⚠ 沒有第二台狀態機。兩種輸出「去掉空白後逐位相同」由 scripts/test-lib-strip-comments.mjs
//     在內嵌樣本與全站實檔上實跑斷言，不是靠這段文字。
//
// ── v6.324：兩處訂正（每一處都有行為端證據，不是重寫檔頭宣稱）─────────────
//   (a) `renderDropped` 用 `tail.trim()` 判「尾巴是不是空的」，但等價性比對用的 `WS_RE` 是 **ASCII**。
//       JS 的 `trim()`／`\s` 還吃 `\u00A0 \u1680 \u2000-\u200A \u2028 \u2029 \u202F \u205F \u3000 \uFEFF`。
//       ⇒ 只要某行 `*/`／`-->` 之後的尾巴**只含非 ASCII 空白**，刪行版丟掉、留白版留著、`nonWs` 又不當它是空白
//       ⇒ 兩種渲染不再逐位相同（實證：game 頁 :384 行尾補一個全形空格 ⇒ test-lib-strip-comments 兩條紅）。
//       ⚠ 這站註解全是中文，行尾誤打全形空格／NBSP 是高機率事件 —— 全站已經有 199 個 U+3000、25 個 U+FEFF，
//         只是目前沒有一個剛好落在「收尾符之後」。修法：`tail.trim()` → `nonWs(tail)`（與 WS_RE 同一個定義）。
//   (b) 護欄①（留存率）**攔不到「洞」型事故** —— 見下面護欄段的實話。
//
// ── 護欄（Rule 25：掃描器自身要先驗）───────────────────────────────────────
//   stripCommentsChecked()／stripCommentsBlankChecked() 每次都會：
//     ① 留存率地板：剝完（以非空白字元數計）必須 ≥ minRatio（**預設 0.02**）的原量。
//        ⚠⚠ v6.324 實話：這一條**沒有擋到過任何一起實證事故**，也擋不到「洞」型事故 ——
//           把事故 2 的區塊正則套在 game 頁，留存率 93.2%（連同行尾 `//` 一起剝的 v6210 版是 77.0%），
//           因為那個洞只有 176 行／19,148 行 ≈ 0.9%，全檔平均對局部異常不敏感。
//        ⚠ 而且預設不能訂高：全站 1,026 支的**正常**留存率下限是 8.5%
//           （`effects/cards/v2997_g4_wave3.ts`），59 支 < 50%、8 支 < 20% ——
//           v6.323 的預設 0.5 只要拿去做多檔掃描就當場誤紅（⛔2 的 v6210 B 段正是這種）。
//        ⇒ 它現在的定位只有一個：**「剝除器整份吐空」偵測器**（`s => ''`、狀態機把每行都判 -1）。
//           預設 0.02 對實測下限 8.5% 有 4.2 倍餘裕；單檔守衛可以自己明寫更嚴的值。
//     ② 正對照：mustKeep 裡的每個字串剝完必須還在（例如真呼叫點 'loadDecksFromCloud('）；
//        ⭐v6.323 反對照：mustDrop 裡的每個字串剝完必須**不在**；
//        ⚠ 兩者都先斷言「在原檔存在」—— 對照字串打錯字時紅在「打錯字」，而不是靜默恆真（v6.320 教訓）。
//        ⚠v6.324：那句話要連「**或被守的程式碼改名了**」一起講 —— 原意突變（把真呼叫點改名）
//           會先撞到這一條，訊息不講清楚就會讓人以為是對照字串打錯字。
//     ③ 區塊長度護欄：任何一個行首開啟的區塊 > maxBlockLines（預設 150）就炸 —— 全站量測
//        （v6.312，src/**＋oracle-admin＋scripts）最長的合法區塊是 91 行、且無未收尾者；
//        事故 2 的 176／543／511 行全部落在護欄之外。未收尾的區塊（吃到檔尾）同樣炸。
//     ⑤ ⭐v6.324 連續丟棄行數護欄：最長一段「連續整行被丟掉」的行數 > maxDropRun（預設 200）就炸。
//        ⚠ 它與 ③ 的差別是**資料來源**：③ 看 `blocks[]`（狀態機的**自報**），⑤ 看 `keepFrom[]`（**實際輸出**）。
//        ⇒ 若有人把狀態機換回「區塊正則圈出範圍、範圍內整行丟」，`blocks[]` 會是空的 ⇒ ③ 全綠，只有 ⑤ 抓得到。
//        全站 1,026 支實測最長 140 行（`server_admin_patch.js` 一段連續 `//`）⇒ 200 有 43% 餘裕；
//        事故 2 的 543 行（server_admin_patch.js）與 511 行（admin.html）版本被 ⑤ 擋下，
//        176 行（game 頁）版本被 ③ 擋下 —— 兩條合起來才覆蓋三起實證事故，單獨任何一條都不夠。
//     ④ 空輸入／非字串直接炸（AssertionError）。
//   ⇒ 真正有辨識力的是 ②③⑤；① 只是吐空偵測器。這句話由 test-lib-strip-comments【3】的突變撐著。
//   呼叫端另外要有**已知答案表**（剝完後每個 token 的確切數字寫死在斷言裡，
//   不是拿新碼算期望值 —— 那是恆真斷言）。
import assert from 'node:assert';

/** 行首（trim 後）`//` ⇒ 整行註解。⚠ 只看行首，不解析字串／正則／網址。 */
export const LINE_COMMENT_RE = /^\s*\/\//;
/** 行首可以開啟的兩種區塊註解：[開頭, 收尾] */
export const BLOCK_PAIRS = [['/*', '*/'], ['<!--', '-->']];

/**
 * ⭐ 唯一的一台行級狀態機。純函式、無護欄；回傳每一行「從第幾個字元起保留」與區塊統計。
 * @param {string} src
 * @returns {{ lines: string[], keepFrom: number[], blocks: Array<{ line: number, lines: number, closed: boolean }>, maxBlockLines: number, maxDropRun: number, maxDropRunAt: number }}
 *   keepFrom[i]  —— -1 ＝ 整行丟；0 ＝ 整行保留；n>0 ＝ 只保留 lines[i].slice(n)（收尾符之後的尾巴）
 *   blocks[].line —— 區塊開始的行號（1-based）；lines —— 佔幾行（含開頭與收尾）；closed —— 有沒有收尾
 */
export function scanCommentLines(src) {
  const lines = String(src).split('\n');
  const keepFrom = new Array(lines.length);
  const blocks = [];
  let close = null;      // 目前區塊的收尾符（null ＝ 不在區塊內）
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (close) {
      const k = line.indexOf(close);
      if (k < 0) { keepFrom[i] = -1; continue; }             // c. 整行在區塊內 ⇒ 丟
      blocks.push({ line: blockStart + 1, lines: i - blockStart + 1, closed: true });
      const from = k + close.length;
      close = null;
      keepFrom[i] = from;                                    // c. 收尾後的尾巴保留（B4）
      continue;
    }
    const t = line.trimStart();
    if (LINE_COMMENT_RE.test(t)) { keepFrom[i] = -1; continue; }   // a. 行首 // ⇒ 丟整行
    let handled = false;
    for (const [open, cl] of BLOCK_PAIRS) {
      if (!t.startsWith(open)) continue;
      handled = true;
      const from = line.indexOf(open) + open.length;
      const k = line.indexOf(cl, from);
      if (k < 0) { close = cl; blockStart = i; keepFrom[i] = -1; break; }   // b. 開區塊，本行丟
      keepFrom[i] = k + cl.length;                           // b. 單行區塊，尾巴保留（B1、B3）
      break;
    }
    if (handled) continue;
    keepFrom[i] = 0;                                         // d. 其餘一律保留
  }
  if (close) blocks.push({ line: blockStart + 1, lines: lines.length - blockStart, closed: false });
  const maxBlockLines = blocks.reduce((m, b) => Math.max(m, b.lines), 0);
  // ⭐v6.324 護欄⑤的原料：最長一段「連續整行被丟掉」（keepFrom === -1）有幾行、從第幾行起。
  //   ⚠ 這是從 keepFrom（實際輸出）算的，不是從 blocks（狀態機自報）算的 —— 兩者的差別正是 ⑤ 存在的理由。
  let run = 0, runAt = 0, maxDropRun = 0, maxDropRunAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keepFrom[i] < 0) { if (run === 0) runAt = i + 1; run++; if (run > maxDropRun) { maxDropRun = run; maxDropRunAt = runAt; } }
    else run = 0;
  }
  return { lines, keepFrom, blocks, maxBlockLines, maxDropRun, maxDropRunAt };
}

/** 「空白」的唯一定義：ASCII 空白（空格／tab／CR／LF／FF／VT）。⚠ 不用 `\s`（JS 與 Python 對 Unicode 空白的集合不同，獨立量測會對不上）。
 *  ⚠v6.324：`renderDropped` 判「尾巴是不是空的」也一律用它 —— 用 `trim()` 會多吃全形空格／NBSP，
 *  刪行版與留白版就對不起來（(a) 事故）。 */
export const WS_RE = /[ \t\r\n\f\v]/g;
/** 非空白字元數（UTF-16 code unit；護欄①與等價性斷言都用它，避免被留白版的空格灌水）。 */
export function nonWs(s) { return String(s).replace(WS_RE, '').length; }

/** 渲染①：刪行。整行丟的行不輸出；只留尾巴的行，尾巴全是空白時也不輸出（與 v6.312 輸出逐位相同）。 */
function renderDropped({ lines, keepFrom }) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const kf = keepFrom[i];
    if (kf < 0) continue;
    if (kf === 0) { out.push(lines[i]); continue; }
    const tail = lines[i].slice(kf);
    // ⚠v6.324：這裡**必須**用 nonWs（＝WS_RE，ASCII 空白）而不是 `tail.trim()`。
    //   `trim()` 連全形空格／NBSP／BOM 都當空白丟掉，但 nonWs 不當它是空白
    //   ⇒ 留白版留著、刪行版丟掉 ⇒ 兩種渲染的等價性斷言當場炸（(a) 事故）。
    if (nonWs(tail)) out.push(tail);
  }
  return out.join('\n');                                   // 渲染①（刪行）的唯一出口
}

/** 渲染②：等長留白。丟掉的字元換成空格；`\r`、`\n` 與每一行的長度都不變 ⇒ 行號／位移可直接對回原檔。 */
function renderBlanked({ lines, keepFrom }) {
  const out = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const kf = keepFrom[i], line = lines[i];
    if (kf === 0) { out[i] = line; continue; }
    const cut = kf < 0 ? line.length : kf;
    out[i] = line.slice(0, cut).replace(/[^\r]/g, ' ') + line.slice(cut);
  }
  return out.join('\n');
}

/**
 * 行級狀態機剝註解（純函式、無護欄），回傳統計給護欄用。
 * @param {string} src
 * @returns {{ out: string, blocks: Array<{ line: number, lines: number, closed: boolean }>, maxBlockLines: number, maxDropRun: number }}
 */
export function stripCommentLinesWithStats(src) {
  const scan = scanCommentLines(src);
  const { blocks, maxBlockLines, maxDropRun } = scan;   // ⚠v6.324：拆掉 v6.312 遺留的 [out].join('\n') 無用包裝
  return { out: renderDropped(scan), blocks, maxBlockLines, maxDropRun };
}

/**
 * 行級剝註解：純函式、無護欄 —— 守衛請改用 stripCommentsChecked()。
 * @param {string} src
 * @returns {string}
 */
export function stripCommentLines(src) {
  return stripCommentLinesWithStats(src).out;
}

/**
 * ⭐v6.323 等長留白版（純函式、無護欄）—— 守衛請改用 stripCommentsBlankChecked()。
 * @param {string} src
 * @returns {string} 與 src 等長、行數相同
 */
export function stripCommentsBlank(src) {
  return renderBlanked(scanCommentLines(src));
}

/**
 * ⭐v6.324 護欄①的預設值。**不是 0.5** ——
 *   全站 1,026 支的正常留存率下限是 8.5%（59 支 < 50%、8 支 < 20%），0.5 拿去做多檔掃描就當場誤紅。
 *   它只是「剝除器整份吐空」偵測器，辨識力在 ②③⑤。要嚴一點的**單檔**守衛請自己明寫 minRatio。
 */
export const DEFAULT_MIN_RATIO = 0.02;
/** ⭐v6.324 護欄⑤的預設值：最長「連續整行被丟掉」的行數。全站實測最長 140（server_admin_patch.js 的一段連續 `//`）。 */
export const DEFAULT_MAX_DROP_RUN = 200;

/** 護欄（兩種輸出共用）。回傳剝完的字串。 */
function checkedCore(src, mode, { label = '', minRatio = DEFAULT_MIN_RATIO, mustKeep = [], mustDrop = [], maxBlockLines = 150, maxDropRun = DEFAULT_MAX_DROP_RUN } = {}) {
  const tag = label ? label + '：' : '';
  assert.ok(typeof src === 'string' && src.length > 0, tag + '剝註解的輸入不是非空字串（讀錯檔？）');
  assert.ok(minRatio > 0 && minRatio <= 1, tag + 'minRatio 必須在 (0, 1]，實得 ' + minRatio);
  assert.ok(Number.isInteger(maxBlockLines) && maxBlockLines > 0, tag + 'maxBlockLines 必須是正整數，實得 ' + maxBlockLines);
  assert.ok(Number.isInteger(maxDropRun) && maxDropRun > 0, tag + 'maxDropRun 必須是正整數，實得 ' + maxDropRun);
  assert.ok(Array.isArray(mustKeep) && Array.isArray(mustDrop), tag + 'mustKeep／mustDrop 必須是陣列');
  const scan = scanCommentLines(src);
  const { blocks } = scan;
  const bad = blocks.find((b) => !b.closed || b.lines > maxBlockLines);
  assert.ok(!bad,
    tag + '第 ' + (bad && bad.line) + ' 行開的區塊註解' + (bad && !bad.closed ? '沒有收尾（吃到檔尾）' : '長達 ' + (bad && bad.lines) + ' 行（護欄 ≤ ' + maxBlockLines + '）')
    + ' ⇒ 疑似「一路吃掉」事故（第 13 種安慰劑）；若真是合法的超長註解，請呼叫端明寫 maxBlockLines');
  // ⑤ ⭐v6.324：看 keepFrom（實際輸出），不是 blocks（狀態機自報）—— 「區塊正則圈範圍」型的回歸只有這條抓得到。
  assert.ok(scan.maxDropRun <= maxDropRun,
    tag + '第 ' + scan.maxDropRunAt + ' 行起連續 ' + scan.maxDropRun + ' 行被整行剝掉（護欄 ≤ ' + maxDropRun
    + '）⇒ 疑似「一路吃掉」事故（第 13 種安慰劑）；這一條看的是**實際輸出**不是 blocks[] 自報'
    + '；若真是合法的超長註解區，請呼叫端明寫 maxDropRun');
  const out = mode === 'blank' ? renderBlanked(scan) : renderDropped(scan);
  const ratio = nonWs(out) / Math.max(1, nonWs(src));
  assert.ok(ratio >= minRatio,
    tag + '剝註解後只剩 ' + (ratio * 100).toFixed(1) + '%（護欄 ≥ ' + (minRatio * 100) + '%）⇒ 剝除器把整份吐空了'
    + '（⚠ 這條只擋「吐空」；「洞」型事故攔不到，那是 ③⑤ 的工作）');
  for (const k of mustKeep) {
    assert.ok(typeof k === 'string' && k.length > 0, tag + 'mustKeep 裡有空字串／非字串');
    assert.ok(src.includes(k), tag + '正對照「' + k + '」在原檔根本不存在 ⇒ 對照字串打錯字，**或被守的程式碼改名了**（v6.320 教訓：先斷言在原檔存在）');
    assert.ok(out.includes(k), tag + '剝註解後正對照「' + k + '」不見了 ⇒ 剝除器吃到真程式碼');
  }
  for (const k of mustDrop) {
    assert.ok(typeof k === 'string' && k.length > 0, tag + 'mustDrop 裡有空字串／非字串');
    assert.ok(src.includes(k), tag + '反對照「' + k + '」在原檔根本不存在 ⇒ 這條反對照恆真，**或被守的註解改字了**（v6.320 教訓）');
    assert.ok(!out.includes(k), tag + '剝註解後反對照「' + k + '」還在 ⇒ 剝除器沒有剝到它（它不是註解？或剝除器壞了）');
  }
  return out;
}

/**
 * 帶護欄的剝註解（刪行）。
 * @param {string} src
 * @param {{ label?: string, minRatio?: number, mustKeep?: string[], mustDrop?: string[], maxBlockLines?: number, maxDropRun?: number }} [opt]
 *   label         —— 錯誤訊息用（哪個檔）
 *   minRatio      —— 剝完非空白字元數 / 原非空白字元數 的下限（**預設 0.02**，只擋「整份吐空」；全站正常下限 8.5%）
 *   mustKeep      —— 正對照：剝完之後這些字串必須還在（放「真呼叫點」的樣子）；先斷言在原檔存在
 *   mustDrop      —— 反對照：剝完之後這些字串必須不在（放「只出現在註解裡」的字樣）；先斷言在原檔存在
 *   maxBlockLines —— 單一區塊註解的行數上限（預設 150；全站實測最長 91）
 *   maxDropRun    —— ⭐v6.324 最長「連續整行被丟掉」的行數上限（預設 200；全站實測最長 140）
 * @returns {string}
 */
export function stripCommentsChecked(src, opt = {}) {
  return checkedCore(src, 'drop', opt);
}

/**
 * ⭐v6.323 帶護欄的剝註解（**等長留白**）：與 src 等長、行數相同，行號／位移可直接對回原檔。
 * 選項同 stripCommentsChecked()。
 * @returns {string}
 */
export function stripCommentsBlankChecked(src, opt = {}) {
  const out = checkedCore(src, 'blank', opt);
  assert.strictEqual(out.length, src.length, (opt.label ? opt.label + '：' : '') + '等長留白版長度變了（渲染器壞了）');
  return out;
}

/**
 * 剝註解之後逐 token 計數：{ [token]: 出現次數 }。
 * 計數本身仍是純字串 split（跟原本守衛一樣），只是輸入先過 stripCommentsChecked()。
 */
export function countTokensStripped(src, tokens, opt) {
  assert.ok(Array.isArray(tokens) && tokens.length > 0, 'countTokensStripped：tokens 是空的');
  const t = stripCommentsChecked(src, opt);
  const o = {};
  for (const k of tokens) o[k] = t.split(k).length - 1;
  return o;
}
