// ⭐ v6.323 守衛：中央 helper scripts/lib/strip-comments.mjs 自身先驗（Rule 25）
//
// ── 這支在守什麼 ────────────────────────────────────────────────────────────
//   「一台行級狀態機、兩種渲染（刪行／等長留白）」這個形狀。v6.310～v6.322 同一族剝除器連續七版
//   在檔頭寫了方向保證、又連續被突變推翻，所以本檔**不信任檔頭的任何宣稱**，只信下面的突變有沒有紅：
//   【0】內嵌樣本＋**手算**已知答案（history-free，永不過期）：刪行版的非空白數、留白版的長度／行數／每一行的位置
//   【1】固定 blob（v6.322＝5e00e1ee）的已知答案表：由獨立的 Python 行級掃描（/tmp/h/indep.py，re.sub(r'\s','')）量出後**手抄**；
//        ⚠ 不可以拿 helper 算出來再寫回去（那是恆真）。淺複製時大聲 SKIP（不 fail-open）。
//   【2】⭐ 主證明：刪行版與留白版「去掉所有空白後逐位相同」—— 內嵌樣本、固定 blob、工作樹三層都跑；
//        留白版長度＝原長、行數＝原行數（行號／位移可直接對回原檔）。
//   【3】護欄突變：mustKeep／mustDrop 在原檔不存在 ⇒ 紅在「打錯字／恆真」（v6.320 教訓）；比例／超長區塊／未收尾／空輸入各紅在指定訊息；
//        反面對照：留白版若拿 out.length/src.length 當比例會恆 100% ⇒ 證明比例護欄必須改用非空白字元數。
//   【4】反面對照（第 13 種安慰劑）：固定 blob 的 game/+page.svelte 用 `/\/\*[\s\S]*?\*\//g` 剝，:208～:384 被吃掉；
//        兩種渲染都留住 :342 的 `let _rtSegN = 0;`、留白版把它留在**同一行號**；洞內探針（:209 之後塞一行）留白版仍在 :210。
//   【5】全站實掃（git ls-tree HEAD 的 .ts/.js/.mjs/.cjs/.svelte/.html）：兩種渲染逐檔等價、留白版長度行數不變、零未收尾、最長區塊 ≤ 150。
// ⚠⚠ 只捕捉 assert.AssertionError —— 其他例外必須直接炸掉。
// Run: node scripts/test-lib-strip-comments.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import {
  scanCommentLines, stripCommentLines, stripCommentLinesWithStats, stripCommentsBlank,
  stripCommentsChecked, stripCommentsBlankChecked, countTokensStripped, nonWs, WS_RE,
} from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⭐ 固定 blob（v6.322）。這不是「pin 版本」—— blob 內容永不變，表也永不過期；淺複製時大聲 SKIP。
const FIXED_SHA = '5e00e1ee928ba7397faae1ab5a7db997246ece4f';
const P_GAME = 'src/routes/game/+page.svelte';
// 已知答案表：v6.323 由獨立 Python 實作量出後手抄（dropNonWs＝刪行版非空白字元數；dropLines＝刪行版行數；srcLines＝原行數）
//   ⚠ 「空白」＝ ASCII 空白（與 helper 的 WS_RE 同定義）、長度以 UTF-16 code unit 計 —— Python 端 re.sub(r'[ \t\r\n\f\v]','') 後 encode('utf-16-le')//2。
const KNOWN = {
  [P_GAME]:                              { srcNonWs: 789685, dropNonWs: 598381, dropLines: 14933, srcLines: 19148, blocks: 239, maxBlock: 17 },
  'oracle-admin/server_admin_patch.js': { srcNonWs: 485624, dropNonWs: 314111, dropLines: 7797,  srcLines: 10506, blocks: 29,  maxBlock: 43 },
  'oracle-admin/admin.html':            { srcNonWs: 339468, dropNonWs: 296358, dropLines: 6597,  srcLines: 7644,  blocks: 24,  maxBlock: 14 },
  'src/lib/game/engine.ts':             { srcNonWs: 385884, dropNonWs: 252028, dropLines: 7736,  srcLines: 10899, blocks: 66,  maxBlock: 27 },
  'src/lib/game/effects.ts':            { srcNonWs: 676037, dropNonWs: 475226, dropLines: 14800, srcLines: 19604, blocks: 102, maxBlock: 31 },
};

let pass = 0, fail = 0;
const T = (n, f) => {
  try { f(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const throwsRe = (fn, re, why) => assert.throws(fn, (e) => e instanceof assert.AssertionError && re.test(e.message), why);
const squash = (s) => s.replace(WS_RE, '');
const lineCount = (s) => s.split('\n').length;
/** 兩種渲染的等價性（主證明）：去空白後逐位相同；留白版長度／行數不變。回傳 { drop, blank }。 */
function assertEquivalent(src, label) {
  const drop = stripCommentLines(src), blank = stripCommentsBlank(src);
  assert.strictEqual(blank.length, src.length, label + '：留白版長度變了');
  assert.strictEqual(lineCount(blank), lineCount(src), label + '：留白版行數變了');
  assert.strictEqual(squash(blank), squash(drop), label + '：兩種渲染去空白後不是逐位相同 ⇒ 不是同一台狀態機');
  return { drop, blank };
}
// 第 13 種安慰劑的形狀（只當反面對照，不可拿去守東西）
const BLOCK_RE = new RegExp('\\/\\*[\\s\\S]*?\\*\\/', 'g');
const blockRegexStrip = (s) => s.replace(BLOCK_RE, (m) => m.replace(/[^\n]/g, ' '));

console.log('【0】內嵌樣本＋手算答案');
// 每一行右邊標的是「刪行版留下的非空白字元數」
const FX = [
  'const a = 1;',                                              // 'consta=1;' ＝ 9
  '// 行首註解 loadX(1)',                                        // 0
  '  /* 單行區塊 */ const b1 = loadX(2);',                      // 'constb1=loadX(2);' ＝ 17
  'const n = 1',                                               // 8
  '  * (loadX(3)).length;',                                    // '*(loadX(3)).length;' ＝ 19
  '<!-- x --> {loadX(4)}',                                     // '{loadX(4)}' ＝ 10
  '/* 多行',                                                    // 0
  ' * 區塊 loadX(5)',                                            // 0
  ' */ const b4 = loadX(6);',                                  // 'constb4=loadX(6);' ＝ 17
  '// 每個 /api/tournament/* 回應',                             // 0（行中 /* 不開區塊）
  'const c = 2; /* 行尾 */',                                   // 'constc=2;/*行尾*/' ＝ 15（規則 d 保留）
  '<!--',                                                      // 0
  '  模板註解 loadX(7)',                                         // 0
  '-->',                                                       // 0
  'x();',                                                      // 4
].join('\n');
const FX_DROP_NONWS = 9 + 17 + 8 + 19 + 10 + 17 + 15 + 4;   // ＝ 99
T('0-1 刪行版：手算非空白 99、行數 8、blocks 2（第 7 行 3 行／第 12 行 3 行）、loadX( 計 4（B1～B4 各一）', () => {
  const st = stripCommentLinesWithStats(FX);
  assert.strictEqual(nonWs(st.out), FX_DROP_NONWS, '非空白 ' + nonWs(st.out));
  assert.strictEqual(lineCount(st.out), 8);
  assert.deepStrictEqual(st.blocks, [{ line: 7, lines: 3, closed: true }, { line: 12, lines: 3, closed: true }]);
  assert.strictEqual(st.out.split('loadX(').length - 1, 4, 'B1～B4 各留一個、註解裡的三個（1、5、7）剔掉');
  assert.strictEqual(countTokensStripped(FX, ['loadX('], { minRatio: 0.3 })['loadX('], 4);
  assert.strictEqual(FX.split('loadX(').length - 1, 7, '樣本自己就不對');
});
T('0-2 留白版：長度＝原長、行數 15、非空白也是 99、每一行的內容留在**同一行號**', () => {
  const b = stripCommentsBlank(FX);
  assert.strictEqual(b.length, FX.length);
  assert.strictEqual(lineCount(b), 15);
  assert.strictEqual(nonWs(b), FX_DROP_NONWS);
  const L = b.split('\n');
  assert.strictEqual(L[0], 'const a = 1;');
  assert.strictEqual(L[1].trim(), '', '行首 // 那一行應全空白');
  assert.strictEqual(L[2], '             const b1 = loadX(2);', 'B1 的尾巴留在原位、前段 12 個字元等長留白');
  assert.strictEqual(L[4], '  * (loadX(3)).length;', 'B2 整行保留');
  assert.strictEqual(L[5], '           {loadX(4)}', 'B3');
  assert.strictEqual(L[8], '    const b4 = loadX(6);', 'B4 收尾行的尾巴');
  assert.strictEqual(L[9].trim(), '', '`// … /api/x/*` 那一行整行是空白、且沒有開區塊吃掉下一行');
  assert.strictEqual(L[10], 'const c = 2; /* 行尾 */', '行尾區塊（規則 d）保留');
  assert.strictEqual(L[12].trim(), '');
  assert.strictEqual(L[14], 'x();');
  for (let i = 0; i < L.length; i++) assert.strictEqual(L[i].length, FX.split('\n')[i].length, '第 ' + (i + 1) + ' 行長度變了');
});
T('0-3 ⭐ 兩種渲染去空白後逐位相同（內嵌樣本）', () => { assertEquivalent(FX, 'FX'); });
T('0-4 CRLF：留白版保留每一行的 \\r、長度行數不變；刪行版與 LF 版去空白後相同', () => {
  const crlf = FX.replace(/\n/g, '\r\n');
  const { drop, blank } = assertEquivalent(crlf, 'FX-CRLF');
  assert.strictEqual((blank.match(/\r\n/g) || []).length, 14, '\\r\\n 對數變了');
  assert.strictEqual(blank.split('\r\n')[1], ' '.repeat(FX.split('\n')[1].length), '行首 // 那一行應為等長空白（不含 \\r 以外的字元）');
  assert.strictEqual(squash(drop), squash(stripCommentLines(FX)));
});
T('0-5 scanCommentLines 是唯一真相：keepFrom 手算 [0,-1,12,0,0,10,-1,-1,3,-1,0,-1,-1,3,0]', () => {
  const sc = scanCommentLines(FX);
  assert.deepStrictEqual(sc.keepFrom, [0, -1, 12, 0, 0, 10, -1, -1, 3, -1, 0, -1, -1, 3, 0]);
  assert.strictEqual(sc.maxBlockLines, 3);
});
T('0-6 未收尾的區塊：scan 記成 closed:false；checked 兩種入口都紅在「沒有收尾」', () => {
  const fx = 'const a = 1;\n/* 沒收尾\nconst b = 2;\n';
  assert.deepStrictEqual(scanCommentLines(fx).blocks, [{ line: 2, lines: 3, closed: false }]);
  throwsRe(() => stripCommentsChecked(fx, { label: 'p' }), /第 2 行開的區塊註解沒有收尾/);
  throwsRe(() => stripCommentsBlankChecked(fx, { label: 'p' }), /第 2 行開的區塊註解沒有收尾/);
});

console.log('【3】護欄突變（兩種入口各紅在指定訊息）');
const PAD = 'const pad = 1;\n'.repeat(30);
const FX3 = PAD + '// 註解裡的 onlyInComment(1)\nconst real = realCall(1);\n';
for (const [name, fn] of [['drop', stripCommentsChecked], ['blank', stripCommentsBlankChecked]]) {
  T('3-1 ' + name + '：mustKeep 在原檔不存在 ⇒ 紅在「打錯字」（不是靜默恆真，也不是紅在「不見了」）', () => {
    throwsRe(() => fn(FX3, { label: 'p', mustKeep: ['NOT_THERE('] }), /正對照「NOT_THERE\(」在原檔根本不存在/);
    throwsRe(() => fn(FX3, { label: 'p', mustKeep: ['realCall (1)'] }), /正對照「realCall \(1\)」在原檔根本不存在/, '空一格的打錯字');
  });
  T('3-2 ' + name + '：mustKeep 只在註解裡 ⇒ 紅在「不見了」；真呼叫點 ⇒ 綠', () => {
    throwsRe(() => fn(FX3, { label: 'p', mustKeep: ['onlyInComment('] }), /正對照「onlyInComment\(」不見了/);
    assert.ok(fn(FX3, { label: 'p', mustKeep: ['realCall('] }).includes('realCall('));
  });
  T('3-3 ' + name + '：mustDrop 在原檔不存在 ⇒ 紅在「恆真」；mustDrop 是真程式碼 ⇒ 紅在「還在」；只在註解裡 ⇒ 綠', () => {
    throwsRe(() => fn(FX3, { label: 'p', mustDrop: ['NEVER_EXISTED'] }), /反對照「NEVER_EXISTED」在原檔根本不存在 ⇒ 這條反對照恆真/);
    throwsRe(() => fn(FX3, { label: 'p', mustDrop: ['realCall('] }), /反對照「realCall\(」還在/);
    assert.ok(!fn(FX3, { label: 'p', mustDrop: ['onlyInComment('] }).includes('onlyInComment('));
    throwsRe(() => fn(FX3, { label: 'p', mustDrop: [''] }), /mustDrop 裡有空字串/);
    throwsRe(() => fn(FX3, { label: 'p', mustKeep: 'realCall(' }), /必須是陣列/);
  });
  T('3-4 ' + name + '：比例護欄（以非空白字元數計）⇒ 紅在「只剩」；明寫 minRatio 放行', () => {
    const mostlyComment = '// ' + 'x'.repeat(200) + '\nconst y = 1;\n';
    throwsRe(() => fn(mostlyComment, { label: 'p' }), /剝註解後只剩 \d+\.\d%/);
    assert.ok(fn(mostlyComment, { label: 'p', minRatio: 0.01 }).includes('const y = 1;'));
  });
  T('3-5 ' + name + '：超長區塊（>150 行）⇒ 紅在「長達 202 行」；明寫 maxBlockLines 放行；空輸入 ⇒ 紅', () => {
    const longBlock = '/*\n' + ' x\n'.repeat(200) + '*/\n' + 'const y = 1;\n'.repeat(300);
    throwsRe(() => fn(longBlock, { label: 'p' }), /第 1 行開的區塊註解長達 202 行/);
    assert.ok(fn(longBlock, { label: 'p', maxBlockLines: 300 }).includes('const y = 1;'));
    throwsRe(() => fn('', { label: 'p' }), /非空字串/);
  });
}
T('3-6 ⭐ 反面對照：留白版若拿 out.length/src.length 當比例，對「幾乎全是註解」的輸入也是 100% ⇒ 比例護欄必須用非空白字元數（3-4 才紅得出來）', () => {
  const mostlyComment = '// ' + 'x'.repeat(200) + '\nconst y = 1;\n';
  const b = stripCommentsBlank(mostlyComment);
  assert.strictEqual(b.length / mostlyComment.length, 1, '留白版長度比例不是 1？那反面對照的前提就變了');
  assert.ok(nonWs(b) / nonWs(mostlyComment) < 0.1, '非空白比例應該很低');
});
T('3-7 留白版護欄：長度不變是硬斷言（渲染器壞了就紅）', () => {
  const out = stripCommentsBlankChecked(FX3, { label: 'p' });
  assert.strictEqual(out.length, FX3.length);
  assert.strictEqual(lineCount(out), lineCount(FX3));
});

console.log('【1】固定 blob 已知答案表（獨立量測、手抄）＋【2】等價性＋【4】反面對照');
const blobs = {};
for (const p of Object.keys(KNOWN)) blobs[p] = readBaseBlob(ROOT, FIXED_SHA, p);
const haveBlobs = hasBaseCommit(ROOT, FIXED_SHA) && Object.values(blobs).every((r) => r.ok && r.out.length > 0);
if (!haveBlobs) {
  shallowSkip('strip-comments【1】【2-blob】【4】固定 blob 已知答案表', '【0】【2-tree】【3】【5】是 history-free 的等價條件，仍在守');
} else {
  for (const [p, k] of Object.entries(KNOWN)) {
    const src = blobs[p].out;
    T('1 ' + p + '：srcNonWs=' + k.srcNonWs + ' dropNonWs=' + k.dropNonWs + ' dropLines=' + k.dropLines + ' srcLines=' + k.srcLines + ' blocks=' + k.blocks + ' maxBlock=' + k.maxBlock, () => {
      assert.strictEqual(nonWs(src), k.srcNonWs, '原檔非空白數不對 ⇒ blob 讀錯');
      assert.strictEqual(lineCount(src), k.srcLines);
      const st = stripCommentLinesWithStats(src);
      assert.strictEqual(nonWs(st.out), k.dropNonWs, '刪行版非空白數 ' + nonWs(st.out));
      assert.strictEqual(lineCount(st.out), k.dropLines, '刪行版行數 ' + lineCount(st.out));
      assert.strictEqual(st.blocks.length, k.blocks, '區塊數 ' + st.blocks.length);
      assert.strictEqual(st.maxBlockLines, k.maxBlock, '最長區塊 ' + st.maxBlockLines);
      assert.ok(st.blocks.every((b) => b.closed), '有未收尾的區塊');
      const b = stripCommentsBlankChecked(src, { label: p });
      assert.strictEqual(nonWs(b), k.dropNonWs, '留白版非空白數 ' + nonWs(b));
    });
    T('2 ' + p + '：⭐ 兩種渲染去空白後逐位相同、留白版長度＝' + src.length + '、行數＝' + k.srcLines, () => {
      const { blank } = assertEquivalent(src, p);
      assert.strictEqual(blank.length, src.length);
    });
  }
  const game = blobs[P_GAME].out;
  const HOLE_LINE = 'let _rtSegN = 0;';
  T('4-1 ⭐ 反面對照：區塊正則對固定 blob 的 game 頁把 :208～:384 吃掉（第 13 種安慰劑）—— :342 的 `' + HOLE_LINE + '` 消失；兩種渲染都留住、留白版留在第 342 行', () => {
    const L = game.split('\n');
    assert.ok(L[341].includes(HOLE_LINE), '前提：第 342 行應是 ' + HOLE_LINE + '，實得 ' + JSON.stringify(L[341].slice(0, 40)));
    assert.ok(L[207].includes('/api/tournament/*'), '前提：第 208 行應是含 /api/tournament/* 的 // 註解（洞的起點）');
    const bad = blockRegexStrip(game);
    assert.ok(!bad.split('\n')[341].includes(HOLE_LINE), '區塊正則居然沒吃掉第 342 行？反面對照失效');
    assert.strictEqual(bad.split(HOLE_LINE).length - 1, 0);
    // 量出洞的範圍：第 209 行起（第 208 行 /* 之前的字還在）連續多少行被清成空白 ⇒ 行為端 hook 實測是 :208～:384
    const BL = bad.split('\n');
    let holeEnd = 208; while (holeEnd < L.length && BL[holeEnd].trim() === '') holeEnd++;
    assert.ok(holeEnd - 208 >= 170, '洞太小（' + (holeEnd - 208) + ' 行）？形狀變了');
    assert.ok(L.slice(208, holeEnd).some((l) => /\b(let|const|function)\b/.test(l)), '洞裡沒有真程式碼？那就不是事故 2 的形狀');
    const { drop, blank } = assertEquivalent(game, P_GAME);
    assert.strictEqual(drop.split(HOLE_LINE).length - 1, 1);
    assert.ok(blank.split('\n')[341].includes(HOLE_LINE), '留白版第 342 行應仍含 ' + HOLE_LINE);
    assert.strictEqual(blank.split(HOLE_LINE).length - 1, 1);
  });
  T('4-2 ⭐ 洞內探針：在第 209 行之後塞一行 `const __probe_in_hole = 1;` ⇒ 區塊正則版看不到它；刪行版看得到；留白版在第 210 行看得到', () => {
    const L = game.split('\n');
    const PROBE = 'const __probe_in_hole = 1;';
    const inj = [...L.slice(0, 209), PROBE, ...L.slice(209)].join('\n');
    assert.strictEqual(blockRegexStrip(inj).split(PROBE).length - 1, 0, '區塊正則版居然看得到探針？反面對照失效');
    const { drop, blank } = assertEquivalent(inj, 'inj');
    assert.strictEqual(drop.split(PROBE).length - 1, 1);
    assert.strictEqual(blank.split('\n')[209], PROBE);
    assert.strictEqual(nonWs(drop), KNOWN[P_GAME].dropNonWs + nonWs(PROBE), '探針之外的數字不可以變');
  });
}

console.log('【2-tree】工作樹等價（不綁數字）');
T('2-tree game/+page.svelte：兩種渲染去空白後逐位相同；留白版長度行數不變；checked 兩入口對照通過', () => {
  const src = readFileSync(join(ROOT, P_GAME), 'utf8');
  const { blank } = assertEquivalent(src, P_GAME);
  // 反對照「是降頻不是停」只出現在 :6925 的 // 註解裡（test-v6146 也拿它當「註解確實被剝掉」的錨點）
  const d = stripCommentsChecked(src, { label: P_GAME, mustKeep: ['function startTournamentPoll()'], mustDrop: ['是降頻不是停'] });
  const b = stripCommentsBlankChecked(src, { label: P_GAME, mustKeep: ['function startTournamentPoll()'], mustDrop: ['是降頻不是停'] });
  assert.strictEqual(squash(b), squash(d));
  assert.strictEqual(b, blank);
});

console.log('【5】全站實掃');
T('5-1 git ls-tree HEAD 的每一支 .ts/.js/.mjs/.cjs/.svelte/.html：兩種渲染逐檔等價、留白版長度行數不變、零未收尾、最長區塊 ≤ 150（實測 91）', () => {
  const files = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', 'HEAD', '--name-only'], { encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\n').filter((f) => /\.(ts|js|mjs|cjs|svelte|html)$/.test(f) && !f.startsWith('node_modules/'));
  assert.ok(files.length >= 900, '只列到 ' + files.length + ' 支（v6.323 有 1025 支）⇒ ls-tree 壞了？');
  let n = 0, maxB = 0, maxF = '';
  for (const f of files) {
    let src; try { src = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    if (!src) continue;
    n++;
    const sc = scanCommentLines(src);
    for (const b of sc.blocks) {
      assert.ok(b.closed, f + '：第 ' + b.line + ' 行的區塊沒有收尾');
      assert.ok(b.lines <= 150, f + '：第 ' + b.line + ' 行的區塊長達 ' + b.lines + ' 行（護欄 150）');
    }
    if (sc.maxBlockLines > maxB) { maxB = sc.maxBlockLines; maxF = f; }
    assertEquivalent(src, f);
  }
  assert.ok(n >= 900, '實際讀到 ' + n + ' 支');
  console.log('        掃了 ' + n + ' 支；最長區塊 ' + maxB + ' 行（' + maxF + '）');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} test-lib-strip-comments：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
