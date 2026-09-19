#!/usr/bin/env node
/**
 * ⭐ v6.378 守衛：C-7（把 48 支本機紅燈的 harness 修好）＋ C-8（拆掉會短路的 T(...)）。
 *
 * ⚠⚠ 本版**出貨碼一行都沒改**（src/ 零變更）—— 以下每一條守的都是守衛／工具層。
 *
 * 設計原則（#26 不准用 || 放寬、#27 不准恆真、#28 旗標層只能當補充）：
 *   - 被守的東西一律**當子行程真的跑起來**，比 exit code 與輸出，不比原始碼字串。
 *   - 每一條「修好了」的斷言，旁邊都有一條「把它守的東西改壞 ⇒ 必紅」的正對照。
 *   - 需要歷史的段落一律 hasBaseCommit 保護、拿不到時 shallowSkip。
 *   - 只在 CRLF 工作樹（或只在沒有 grep 的平台）才成立的段落，要偵測環境並**大聲跳過**，
 *     不可以假裝有在守（v6.377 的教訓）。
 *
 * ── 本版四種修法（每一種都有 HEAD-FAIL 代表）──────────────────────────────
 *   ① 讀檔處收斂 normEol（多行錨點／sha 比對／突變錨點在 CRLF 工作樹全部定位失敗）
 *   ② 「admin.html 必須維持 LF」改問 git index（committedEolIsLf）
 *   ③ 「玩家端零改動」「static/music 白名單」改用 git 的口徑（diff／ls-files）
 *   ④ 平台／路徑：grep(1) 換成 Node 掃描器；tmpdir 副本的相對匯入改寫成絕對 file URL
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol, committedEolIsLf, indexEol } from './lib/eol-agnostic.mjs';
import { SRC as SRM_SRC } from './lib/setup-room-model.mjs';
import { scanSource } from './lint-eol-anchors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = process.env.V6378_BASE || '991ba70a';

let pass = 0, fail = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { console.log('  PASS ' + name); pass++; return true; }
  console.log('  FAIL ' + name + (detail ? '\n        ' + detail : ''));
  fail++; return false;
};
const notes = [];
const loudSkip = (what, why) => {
  notes.push(what);
  console.log('  ⚠⚠ ENV-SKIP  ' + what + '　—— ' + why);
  console.log('  ⚠⚠ 這一段在本次執行【沒有在守】。');
};

// 臨時檔一律放在 scripts/ 底下（守衛用 import.meta.url 推 ROOT，放別處會推錯根），跑完刪掉。
const temps = [];
function tempScript(name, content) {
  const p = join(ROOT, 'scripts', '.v6378-tmp-' + name);
  writeFileSync(p, content);
  temps.push(p);
  return p;
}
process.on('exit', () => { for (const p of temps) { try { unlinkSync(p); } catch { /* */ } } });
const runNode = (file) => {
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
};
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const CHAIN = String((PKG.scripts && PKG.scripts.test) || '');

/** 這個 checkout 的工作樹是不是 CRLF。 */
const crlfWorktree = () => readFileSync(join(ROOT, 'scripts/test-v6156-still-here.mjs'), 'utf8').includes('\r\n');
/** 這台機器有沒有 grep(1)（v6.269 的舊 harness 依賴它）。 */
const hasGrep = () => {
  const r = spawnSync('grep', ['--version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
};
const gitLines = (args) => {
  const r = spawnSync('git', ['-C', ROOT, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) return [];
  return String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
};
const load = (rel) => readFileSync(join(ROOT, rel), 'utf8');


// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】C-7②：中央述詞 committedEolIsLf —— 「會被部署的那份位元組是不是 LF」');
// ══════════════════════════════════════════════════════════════════════════════
{
  const adm = committedEolIsLf(ROOT, 'oracle-admin/admin.html');
  chk('★★★ A1 admin.html 在 git index 是 LF（這就是 GitHub Actions checkout 出來、真的會被部署的那份）',
    adm.ok === true && adm.how === 'index', JSON.stringify(adm));

  // ⚠ 負對照：本 repo 現在就有 12 個 i/crlf 的追蹤檔（.bat 那一批）。
  //   少了這一條，A1 會退化成「git 回什麼都算 LF」的恆真式。
  const bat = committedEolIsLf(ROOT, 'oracle-admin/dump-monitor.bat');
  chk('★★★ A2 負對照：i/crlf 的追蹤檔必須被判成**不是** LF（證明 A1 不是恆真式）',
    bat.ok === false && bat.how === 'index' && /i\/crlf/.test(bat.detail), JSON.stringify(bat));
  chk('★★ A2b indexEol 直接回報 git 的標記（lf / crlf 各一）',
    indexEol(ROOT, 'oracle-admin/admin.html') === 'lf' && indexEol(ROOT, 'oracle-admin/dump-monitor.bat') === 'crlf',
    indexEol(ROOT, 'oracle-admin/admin.html') + ' / ' + indexEol(ROOT, 'oracle-admin/dump-monitor.bat'));

  // ⚠ 退路：拿不到 git index（未追蹤檔）時必須**據實**改判工作樹位元組，不可以靜默回 ok。
  const uCrlf = tempScript('eol-crlf.txt', 'a\r\nb\r\n');
  const uLf = tempScript('eol-lf.txt', 'a\nb\n');
  const rc = committedEolIsLf(ROOT, 'scripts/.v6378-tmp-eol-crlf.txt');
  const rl = committedEolIsLf(ROOT, 'scripts/.v6378-tmp-eol-lf.txt');
  chk('★★★ A3 未追蹤檔 ⇒ 退回工作樹位元組判定，而且 CRLF 必須判 false、LF 必須判 true（退路不是恆真）',
    existsSync(uCrlf) && existsSync(uLf)
    && rc.how === 'worktree' && rc.ok === false && rl.how === 'worktree' && rl.ok === true,
    JSON.stringify(rc) + ' / ' + JSON.stringify(rl));
  chk('★★ A4 檔案不存在 ⇒ ok=false（fail-closed，不可以「讀不到就算過」）',
    committedEolIsLf(ROOT, 'oracle-admin/__v6378_not_exist.html').ok === false);

  // 11 支守衛真的改走中央述詞了（旗標層，只當補充 —— 行為層由【B】【C】負責）
  const MOVED = [
    'scripts/test-v6227-colo-telemetry.mjs', 'scripts/test-v6241-zeraora-text-and-archetype-fullscan.mjs',
    'scripts/test-v6242-casual-fullscan-eventloop.mjs', 'scripts/test-v6243-player-detail-scope.mjs',
    'scripts/test-v6244-tournament-date-basis.mjs', 'scripts/test-v6266-deck-stats-server.mjs',
    'scripts/test-v6272-firestore-read-reduction.mjs', 'scripts/test-v6276-deck-tournament-stats.mjs',
    'scripts/test-v6278-delta-put-deep-path.mjs', 'scripts/test-v6279-delta-put-deep-client.mjs',
    'scripts/test-v6287-friends-dm.mjs',
  ];
  const notMoved = MOVED.filter((f) => !load(f).includes('committedEolIsLf(ROOT'));
  chk('★ A5（補充）11 支「admin.html 維持 LF」的守衛都改走中央述詞', notMoved.length === 0, notMoved.join(', '));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】HEAD-FAIL：BASE(' + BASE_SHA.slice(0, 8) + ') 版的守衛在這台機器上必須紅，HEAD 版必須綠');
// ══════════════════════════════════════════════════════════════════════════════
{
  const CRLF = crlfWorktree();
  const GREP = hasGrep();
  const strayMusic = gitLines(['ls-files', '--others', '--exclude-standard', '--', 'static/music']).length > 0;
  const PRE = {
    crlf: [CRLF, '本機工作樹是 LF ⇒ BASE 版在 LF 上本來就是綠的（這正是 normEol／git 口徑對 CI 零風險的原因）'],
    'no-grep': [!GREP, '這台機器有 grep(1) ⇒ BASE 版的 grep harness 在這裡本來就會動'],
    'stray-music': [strayMusic, 'static/music 底下沒有未追蹤檔 ⇒ BASE 版的 readdir 掃描在這裡本來就是綠的'],
  };
  const HEADFAIL = [
    ['scripts/test-v6161-lobby-poll-downshift.mjs', '①讀檔處 normEol（區塊抽取器在 CRLF 切不出區塊）', 'crlf'],
    ['scripts/test-v6313-tablet-mobile-ui.mjs', '①讀檔處 normEol（突變錨點在 CRLF 定位失敗）', 'crlf'],
    ['scripts/test-v6244-tournament-date-basis.mjs', '②admin.html 行尾改問 git index', 'crlf'],
    ['scripts/test-v6272-firestore-read-reduction.mjs', '③玩家端零改動改用 git diff 的口徑', 'crlf'],
    ['scripts/test-v6246-oracle-timeout-followups.mjs', '④tmpdir 副本的相對匯入改寫成絕對 file URL', 'crlf'],
    ['scripts/test-v6276-deck-tournament-stats.mjs', '①normEol ＋ C-8 拆 B4', 'crlf'],
    ['scripts/test-v6130-bgm-lazy-and-licensing.mjs', '③static/music 改掃 git 追蹤集', 'stray-music'],
    ['scripts/test-v6269-casual-monitor-tab.mjs', '④grep(1) 換成 Node 掃描器', 'no-grep'],
  ];
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('【B】HEAD-FAIL（BASE=' + BASE_SHA.slice(0, 8) + ' 的 8 支守衛必須紅）',
      '【A】【C】【D】【E】都不需要歷史，仍在守');
  } else {
    for (const [rel, why, pre] of HEADFAIL) {
      const [okPre, whyNot] = PRE[pre];
      if (!okPre) { loudSkip('B/HEAD-FAIL ' + rel + '（' + why + '）', whyNot); continue; }
      const b = readBaseBlob(ROOT, BASE_SHA, rel);
      if (!chk('★ 前提：讀得到 BASE 的 ' + rel, b.ok)) continue;
      const m = runNode(tempScript('base-' + rel.split('/').pop(), b.out));
      const now = runNode(join(ROOT, rel));
      chk('★★★ B/HEAD-FAIL ' + rel + '：BASE 必紅、HEAD 必綠（' + why + '）',
        m.code !== 0 && now.code === 0,
        'BASE exit=' + m.code + ' / HEAD exit=' + now.code + '\n        HEAD 尾巴：'
        + now.out.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300));
    }
  }
}


// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐ 修完之後它們**真的還在守**（把它們守的東西改壞 ⇒ 必紅）');
// ══════════════════════════════════════════════════════════════════════════════
{
  /** 對某一支守衛做逐字突變後跑起來，必須紅（突變錨點不唯一 ⇒ 本條直接紅，不准默默跳過）。 */
  const mutMustRed = (name, rel, from, to, label) => {
    const src = load(rel);
    const n = src.split(from).length - 1;
    if (n !== 1) { chk(name, false, '突變錨點命中 ' + n + ' 次（需要恰 1）：' + JSON.stringify(from.slice(0, 80))); return; }
    const m = runNode(tempScript('mut-' + label + '-' + rel.split('/').pop(), src.split(from).join(to)));
    chk(name, m.code !== 0, 'exit=' + m.code + '\n        ' + m.out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400));
  };

  mutMustRed('★★★ C1 test-v6130：白名單清空 ⇒ 必紅（證明它真的在對 git 追蹤集做版權白名單，不是改成不掃）',
    'scripts/test-v6130-bgm-lazy-and-licensing.mjs',
    "const ALLOWED = new Set(['last-card.mp3']);", 'const ALLOWED = new Set([]);', 'allow');

  mutMustRed('★★★ C2 test-v6244：把行尾判定的目標換成 i/crlf 的 .bat ⇒ 必紅（證明 ADMIN_EOL 真的在判行尾）',
    'scripts/test-v6244-tournament-date-basis.mjs',
    "committedEolIsLf(ROOT, 'oracle-admin/admin.html');", "committedEolIsLf(ROOT, 'oracle-admin/dump-monitor.bat');", 'eol');

  mutMustRed('★★★ C3 test-v6269：Node 掃描器改成永遠掃不到 ⇒ 必紅（它自己的「不是恆真式」正對照還在）',
    'scripts/test-v6269-casual-monitor-tab.mjs',
    '      if (txt.includes(needle)) hits.push(p);', '      if (false && txt.includes(needle)) hits.push(p);', 'scan');

  {
    const V72 = 'scripts/test-v6272-firestore-read-reduction.mjs';
    const v72 = load(V72);
    // ⚠⚠ 這一條**需要歷史**：test-v6272 的那條斷言自己有 hasBaseCommit(PREV_SHA) 保護，
    //   淺複製（fetch-depth:1）時它會 shallowSkip ⇒ 把 PREV_ALLOWED 清空也不會紅，
    //   本條就會誤報成「守衛壞了」（v6.371 的教訓：本機全綠 ≠ CI 全綠）。⇒ 一樣要 shallowSkip。
    const mSha = /const PREV_SHA = '([0-9a-f]{7,40})'/.exec(v72);
    if (!mSha) {
      chk('★★★ C4 test-v6272：預期差異清單清空 ⇒ 必紅', false, '抓不到 test-v6272 的 PREV_SHA 常數（寫法改了？）');
    } else if (!hasBaseCommit(ROOT, mSha[1])) {
      shallowSkip('C4（test-v6272 的 git diff 口徑真的在比）',
        '物件庫沒有 test-v6272 的 PREV_SHA(' + mSha[1].slice(0, 8) + ') ⇒ 它自己就會 shallowSkip');
    } else {
      // ⭐v6.380：突變錨點改成**從 test-v6272 自己動態抓**，不再手抄清單內容。
      //   手抄版每次 PREV_ALLOWED 一變就失配（v6.380 bump 改單筆時就踩到）。判準逐字未變：
      //   把預期差異清單清空 ⇒ test-v6272 的那條斷言必須紅。
      const mAllow = /const PREV_ALLOWED = \[[\s\S]*?\];/.exec(v72);
      if (!mAllow) {
        chk('★★★ C4 test-v6272：預期差異清單清空 ⇒ 必紅', false, '抓不到 PREV_ALLOWED 區塊（寫法改了？）');
      } else if (mAllow[0].split('\n').filter((l) => !l.trim().startsWith('//')).join('').replace(/\s+/g, '')
                 === 'constPREV_ALLOWED=[];') {
        // ⭐⭐v6.408a（IRON_RULES Rule 40：意圖沒被破壞，只是突變手段失效了）——
        //   純工具版會把 PREV_SHA 前移、清單清空（見 test-v6272 裡那段註解）⇒「清空」這個突變
        //   在清單本來就空的時候是 no-op，test-v6272 照樣綠，本條就會誤報成「守衛壞了」。
        //   ⚠ 判斷「實質為空」必須**先剝掉註解**：前移那一版在清單裡留了六行說明，
        //     不剝的話 `replace(/\s+/g,'')` 永遠不等於 'constPREV_ALLOWED=[];'（v6.408a 當場踩到）。
        //   ⇒ 換一個**等價**的突變：塞一個不存在的條目。deepStrictEqual 是雙向的，
        //     少列一個紅、多列一個也紅 ⇒ 同樣證明「git diff 真的有在比」。
        mutMustRed('★★★ C4 test-v6272：預期差異清單塞一個假條目 ⇒ 必紅（證明 git diff 真的有在比，不是恆真）',
          V72, mAllow[0], "const PREV_ALLOWED = ['src/lib/__v6408a_not_a_real_file__.ts'];", 'prev');
      } else {
        mutMustRed('★★★ C4 test-v6272：預期差異清單清空 ⇒ 必紅（證明 git diff 真的有在比，不是恆真）',
          V72, mAllow[0], 'const PREV_ALLOWED = [];', 'prev');
      }
    }
  }

  mutMustRed('★★★ C5 test-v6276：把 C-8 拆出來的重釘複驗指向一支沒有那個 sha 的守衛 ⇒ 必紅',
    'scripts/test-v6276-deck-tournament-stats.mjs',
    "'scripts/test-v6265-phantom-start-race.mjs'", "'scripts/test-v6156-still-here.mjs'", 'repin');

  // ⭐ C6：只在 CRLF 工作樹才成立 —— 把 normEol 拿掉，那一支必須紅（證明修法是承重的）
  if (!crlfWorktree()) {
    loudSkip('C6「拿掉 normEol 必紅」', '本機工作樹是 LF ⇒ normEol 在這裡是 no-op，拿掉不會紅（這正是它對 CI 零風險的原因）');
  } else {
    mutMustRed('★★★ C6 test-v6161：把讀檔處的 normEol 拿掉 ⇒ CRLF 工作樹必紅（修法是承重的，不是裝飾）',
      'scripts/test-v6161-lobby-poll-downshift.mjs',
      "normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'))",
      "readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8')", 'nonorm');
  }

  // ⭐ C7：setup-room-model（v6.309／v6.310 的共享模型）—— 行為層，不必跑那兩支很慢的守衛
  {
    const RAW = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
    const ANCHOR = "  return mergeSetupSeats(local, incoming, me, 'receive');\n";
    chk('★★★ C7a 共享模型交給 esbuild 的 sync-guards 內容是 LF（v6.310 的突變錨點才定位得到）',
      !SRM_SRC.guards.includes('\r\n') && SRM_SRC.guards.split(ANCHOR).length - 1 === 1,
      'crlf=' + SRM_SRC.guards.includes('\r\n') + ' anchor=' + (SRM_SRC.guards.split(ANCHOR).length - 1));
    if (!crlfWorktree()) {
      loudSkip('C7b 負對照（原始工作樹內容定位不到）', '本機工作樹是 LF ⇒ 原始內容本來就定位得到');
    } else {
      chk('★★★ C7b 負對照：同一個錨點對**未正規化**的工作樹內容是 0 次（證明 C7a 不是恆真式）',
        RAW.includes('\r\n') && RAW.split(ANCHOR).length - 1 === 0,
        'raw crlf=' + RAW.includes('\r\n') + ' anchor=' + (RAW.split(ANCHOR).length - 1));
    }
    chk('★★ C7c 正規化沒有改變內容本身（只換行尾）：normEol(工作樹) 與模型拿到的內容逐字相同',
      normEol(RAW) === SRM_SRC.guards);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】C-8：拆完之後「第一項失敗，後面仍各自判定」（行為層正對照 ＋ BASE 短路對照）');
// ══════════════════════════════════════════════════════════════════════════════
{
  const FIRST = "'scripts/test-v6265-phantom-start-race.mjs'";
  const OTHER = "'scripts/test-v6156-still-here.mjs'";   // 真的存在、但不含那些 sha ⇒ AssertionError（不是 ENOENT）
  const SPLITS = [
    // ⭐v6.379：8 → 11（v6.291／v6.292 的 TAIL_LOCKS 補上三支漏網的鎖）。這個數字是
    //   「拆成 N 個 T 之後真的逐項判定」的**期望條數**，跟著清單長度走，不是判準放寬。
    ['scripts/test-v6291-tourn-verified-gate.mjs', 'B4-tail ', 11, /\bB4\b/],
    ['scripts/test-v6292-tourn-verified-gate2.mjs', 'B5-tail ', 11, /\bB5\b/],
    ['scripts/test-v6276-deck-tournament-stats.mjs', 'B4-repin ', 5, /\bB4\b/],
  ];
  const baseOk = hasBaseCommit(ROOT, BASE_SHA);
  if (!baseOk) shallowSkip('【D】BASE 短路對照（未拆版只會判 1 條）', 'HEAD 側的「N 條各自判定」仍然在守');
  for (const [rel, tag, n, baseRe] of SPLITS) {
    const src = load(rel);
    if (!chk('★ 前提：' + rel + ' 的第一項錨點唯一', src.split(FIRST).length - 1 === 1)) continue;
    const r = runNode(tempScript('split-' + rel.split('/').pop(), src.split(FIRST).join(OTHER)));
    const lines = r.out.split('\n').filter((l) => l.includes(tag));
    const fails = lines.filter((l) => l.includes('FAIL'));
    chk('★★★ D ' + rel + '：第一項故意失敗 ⇒ 仍然逐項判定（' + n + ' 條 ' + tag.trim() + '，恰 1 條紅）',
      lines.length === n && fails.length === 1,
      '看到 ' + lines.length + ' 條（期望 ' + n + '），紅 ' + fails.length + ' 條\n        '
      + lines.map((l) => l.trim().slice(0, 60)).join(' | ').slice(0, 400));
    if (!baseOk) continue;
    const b = readBaseBlob(ROOT, BASE_SHA, rel);
    if (!chk('★ 前提：讀得到 BASE 的 ' + rel + ' 且第一項錨點唯一', b.ok && b.out.split(FIRST).length - 1 === 1)) continue;
    const rb = runNode(tempScript('splitbase-' + rel.split('/').pop(), b.out.split(FIRST).join(OTHER)));
    const bl = rb.out.split('\n').filter((l) => baseRe.test(l) && /PASS|FAIL/.test(l));
    chk('★★★ D-base ' + rel + '：BASE（未拆版）同一個突變只判得到 **1** 條 ⇒ 短路真的存在（不是為了拆而拆）',
      bl.length === 1 && bl[0].includes('FAIL'),
      'BASE 看到 ' + bl.length + ' 條：' + bl.map((l) => l.trim().slice(0, 70)).join(' | ').slice(0, 300));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】零意外：行尾錨點 lint 仍 0 違規 ＋ 本守衛接進 chain ＋ src/ 零改動');
// ══════════════════════════════════════════════════════════════════════════════
{
  const r = runNode(join(ROOT, 'scripts/lint-eol-anchors.mjs'));
  chk('★★★ E1 lint-eol-anchors 仍然 exit=0、0 處違規（本版新增的 normEol 沒有製造新的違規）',
    r.code === 0 && /0 處違規/.test(r.out), 'exit=' + r.code + '\n' + r.out.slice(-500));
  // ⭐ E1b HEAD-FAIL（**環境無關**，CI／LF 上一樣在守）：v6.377 commit 之後手刻的雙行尾錨點
  //   讓 lint 判出 1 處違規 ⇒ `node scripts/lint-eol-anchors.mjs` 與 test-v6377 自己的 A1
  //   從那一刻起就恆紅（在 LF clone 實測確認，不是只有 CRLF 本機）。本版把它改走中央 helper。
  //   ⚠ 不能用「把 BASE 版寫成暫存檔再跑 lint」來證明：lint 掃的是 **git 追蹤集**，暫存檔不在裡面
  //     ⇒ 那樣會假綠。改成把兩份原始碼餵給**真的**偵測函式 scanSource（行為層）。
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('E1b HEAD-FAIL（BASE 版 test-v6377 的手刻雙行尾錨點必須被偵測函式抓到）', 'E1 本身仍在守');
  } else {
    const V77 = 'scripts/test-v6377-eol-anchors-and-orphan-harness.mjs';
    const b77 = readBaseBlob(ROOT, BASE_SHA, V77);
    if (chk('★ 前提：讀得到 BASE 的 ' + V77, b77.ok)) {
      const rb = scanSource(V77, b77.out), rh = scanSource(V77, load(V77));
      chk('★★★ E1b HEAD-FAIL：BASE 版 test-v6377 被真的偵測函式抓到 1 處違規、HEAD 版 0 處'
        + '（⇒ lint 這一步與 test-v6377 從 v6.377 commit 起就恆紅，LF／CI 也一樣）',
        rb.rows.length === 1 && rh.rows.length === 0,
        'BASE=' + JSON.stringify(rb.rows) + ' HEAD=' + JSON.stringify(rh.rows));
    }
  }
  chk('★★ E2 本守衛在 package.json 的 test chain 裡（只加進 iron-rules-audit 等於沒加）',
    CHAIN.includes('node scripts/test-v6378-eol-harness-and-t-split.mjs'));
  // ⭐v6.379：E3 原本比的是「工作樹 vs HEAD 的 src/ 差異必須是空的」—— 那不是「v6.378 沒動
  //   出貨碼」這個**歷史事實**，而是「以後誰都不准動 src/」（第九種安慰劑：pin 死版本；
  //   test-v6272 ⑩ 在 v6.275、test-v6278 I4 在 v6.279 都為同一個病灶留下過修法）。
  //   而且它在「工作樹乾淨」時恆真 —— 任何人只要先 commit 就能讓它變綠 ⇒ 沒有在守。
  //   ⇒ 改成 commit vs commit：v6.377(BASE_SHA) → v6.378(SELF_SHA) 在 src/ 底下的差異清單
  //     必須逐項等於 ['src/lib/version.ts']（deepStrictEqual 口徑：少一個、多一個都紅）。
  //   ⚠ 這不是放寬：舊寫法完全不看 v6.378 到底改了什麼，新寫法把它釘死成一份具名清單。
  const SELF_SHA = 'b2649b46';   // v6.378 自己的 commit
  if (!hasBaseCommit(ROOT, BASE_SHA) || !hasBaseCommit(ROOT, SELF_SHA)) {
    shallowSkip('E3 v6.377 → v6.378 的 src/ 逐檔差異', '需要歷史 commit；「這一版動了什麼」由 test-v6272 ⑩ 的 PREV_ALLOWED 接手守');
  } else {
    const srcDiff = gitLines(['diff', '--name-only', BASE_SHA, SELF_SHA, '--', 'src']);
    chk('★★ E3 v6.378 出貨碼零改動：v6.377 → v6.378 在 src/ 底下只有 version.ts',
      srcDiff.length === 1 && srcDiff[0] === 'src/lib/version.ts', srcDiff.join(', ') || '(空)');
  }
}

console.log('\n' + (fail === 0 ? '✅ 全部通過' : '❌ 有失敗') + '（PASS ' + pass + ' / FAIL ' + fail + '）');
if (notes.length) {
  console.log('⚠⚠⚠ 本次有 ' + notes.length + ' 段因為環境（工作樹行尾／平台／未追蹤檔）沒有在守：');
  for (const s of notes) console.log('⚠⚠⚠   - ' + s);
}
process.exit(fail === 0 ? 0 : 1);
