// v6.336 守衛 —— 修掉兩支「會隨機假紅」的守衛（站長裁定：依建議處理）
//
// 背景：v6.334 與 v6.335 各被一條**噪音判準**擋下來一次，原樣 rerun 就綠：
//   ① `test-v6234` ⑦：3000 次真隨機擲幣，判準 `maxFlips < 20`。
//      「擲到反面為止」⇒ P(f ≥ 20) = 2^-19 ⇒ P(max ≥ 20) ≈ 0.57%／次 CI。
//   ② `test-v6242` ⑤：`shipped.ms < bare.ms * 1.3` —— 拿同樣有噪音的牆鐘數字當分母取比值，
//      兩邊各只量一發；runner 被鄰居搶 CPU 時分母縮、分子脹。
//   ⚠ 假紅最大的傷害不是浪費一次 rerun，而是**訓練大家「看到紅先 rerun」**；
//     下一步就是有人幫它加 skip，守備靜悄悄地沒了。
//
// 修法照 IRON_RULES Rule 40：**改判準到「意圖級」，不是放寬**。
//   ① 取樣改吃固定種子（scripts/lib/seeded-rng.mjs），判準改成標題真正要守的「官方上限 30 碰不到」。
//   ② 改成兩條零噪音判準：讓路次數 = 節拍算得出來的值（確定性）＋ 總耗時的寬鬆絕對上界。
//
// ⚠ Rule 38（同一個判準只能有一份）—— 本檔與被改的那兩支守衛的分工：
//   · 「怪顎龍｜亂暴 的上限碰不到」這個**引擎行為**判準，只住在 test-v6234 ⑦，本檔不重抄。
//   · 「讓路次數對不對」這個**出貨碼行為**判準，只住在 test-v6242 ⑤，本檔不重抄。
//   · 本檔守的是**元性質**：(A) 亂數工具本身可重現、且新判準對種子不敏感（順便把舊判準的
//     假紅率**量出來**）；(B)(C) 那兩段真的搬到意圖級了、不會被無聲改回去（附反安慰劑）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { mulberry32, withSeededRandom, withBiasedCoin } from './lib/seeded-rng.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'be43eb1e19e365fe086a0baea8e21c132a73d84b';   // v6.335（v6.336 的上一版）
const F6234 = 'scripts/test-v6234-resistance-label-and-coin-cap.mjs';
const F6242 = 'scripts/test-v6242-casual-fullscan-eventloop.mjs';

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ⚠ 否定型斷言（「不得再出現 X」）一定要**先剝註解**：這一版的修法本身就在註解裡
//   原封不動引用了舊寫法（`maxFlips < 20`、`shipped.ms < bare.ms * 1.3`），不剝就會誤紅。
//   用中央 helper 的等長留白版 ⇒ 位移與行數不變，切片錨點仍然對得上（Rule 38：不自己重刻剝除器）。
const strip = (src, label) => stripCommentsBlankChecked(src, { label });

// ── 切片器（Rule 25：掃描器自己要有下限斷言，抽壞了不可以靜默全綠）────────────
function section(src, startMark, endMark, what) {
  const i = src.indexOf(startMark);
  assert.ok(i >= 0, what + '：找不到起點錨點 ' + startMark);
  const j = src.indexOf(endMark, i);
  assert.ok(j > i, what + '：找不到終點錨點 ' + endMark);
  const out = src.slice(i, j);
  assert.ok(out.length > 400, what + '：切出來只有 ' + out.length + ' 字（切片器壞了？）');
  return out;
}
// ── 掃描器：同一份掃描器餵 HEAD 與 BASE 兩種輸入（Rule 38：判準只寫一份）──────
const scan6234 = (sec) => ({
  seeded: /withSeededRandom\(/.test(sec),
  rigged: /withBiasedCoin\(/.test(sec),
  old20: /maxFlips\s*<\s*20\b/.test(sec),
  capIntent: /maxFlips\s*<\s*CAP\b/.test(sec),
  repeatable: /可重現/.test(sec),
});
const scan6242 = (sec) => ({
  noisyRatio: /\b\w+\.ms\s*[*/]\s*\w/.test(sec) || /\b\w+\.ms\s*<\s*\w+\.ms\b/.test(sec),
  yieldCount: /assert\.strictEqual\(\s*counted\.spy\.n/.test(sec),
  absBound: /shipped\.ms\s*<\s*\d{3,}/.test(sec),
  mutCadence: /countingYield\(1\)/.test(sec),
});

const SEC6234 = ['⑦ 【C】', '⑧ ⭐ 突變測試'];
const SEC6242 = ['⑤ ⭐ 事件迴圈實測', '⑥ 讓路 helper 本身'];

const head6234 = read(F6234);
const head6242 = read(F6242);
const h34 = scan6234(section(strip(head6234, 'HEAD v6234'), ...SEC6234, 'HEAD test-v6234 ⑦'));
const h42 = scan6242(section(strip(head6242, 'HEAD v6242'), ...SEC6242, 'HEAD test-v6242 ⑤'));

// ══════════════════════════════════════════════════════════════════════════
console.log('【A】scripts/lib/seeded-rng.mjs：可重現、會還原、統計正確');

T('A1 mulberry32：同一顆種子產生同一串；不同種子不同串', () => {
  const a = Array.from({ length: 64 }, ((r) => () => r())(mulberry32(12345)));
  const b = Array.from({ length: 64 }, ((r) => () => r())(mulberry32(12345)));
  const c = Array.from({ length: 64 }, ((r) => () => r())(mulberry32(12346)));
  assert.deepStrictEqual(a, b, '同種子跑出不同結果 —— 這個 PRNG 不可重現');
  assert.notDeepStrictEqual(a, c, '不同種子跑出相同結果 —— 種子根本沒在用');
  assert.ok(a.every((x) => x >= 0 && x < 1), '產生了 [0,1) 以外的值');
});

T('A2 withSeededRandom：期間換掉 Math.random，離開時一定還原（fn 丟例外也要還原）', () => {
  const orig = Math.random;
  const inside = withSeededRandom(7, () => Math.random());
  assert.strictEqual(Math.random, orig, '正常結束沒有還原 Math.random');
  assert.strictEqual(inside, mulberry32(7)(), '期間吐出來的不是種子源的第一個值');
  assert.throws(() => withSeededRandom(7, () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(Math.random, orig, '⚠ fn 丟例外時沒有還原 Math.random（後面所有測試都會被汙染）');
});

T('A3 withBiasedCoin：真的把硬幣灌偏（正對照工具自己要先驗，Rule 25）', () => {
  const orig = Math.random;
  const heads = withBiasedCoin(99, 0.95, () => {
    let n = 0;
    for (let i = 0; i < 20000; i++) if (Math.random() < 0.5) n++;
    return n / 20000;
  });
  assert.ok(heads > 0.93 && heads < 0.97, '灌成 95% 正面卻量到 ' + heads.toFixed(3));
  assert.strictEqual(Math.random, orig, '沒有還原 Math.random');
});

T('A4 ⭐⭐⭐ 量化：新判準（<30）對種子不敏感；舊判準（<20）在同一批種子裡本來就會紅', () => {
  // ⚠ 這裡是**純數學模擬**（不跑引擎）：目的是量化判準本身的穩健度，
  //   不是在守「怪顎龍｜亂暴」的行為 —— 那條只住在 test-v6234 ⑦（Rule 38）。
  const S = 1000, N = 3000, CAP = 30, BASE_SEED = 0x2a170000;
  const flipsUntilTails = (rng) => { let f = 0; while (f < CAP) { f++; if (!(rng() < 0.5)) break; } return f; };
  let worstNew = 0, oldWouldFail = 0, sum = 0;
  for (let s = 0; s < S; s++) {
    const rng = mulberry32(BASE_SEED + s);
    let mx = 0;
    for (let i = 0; i < N; i++) { const f = flipsUntilTails(rng); sum += f; if (f > mx) mx = f; }
    if (mx > worstNew) worstNew = mx;
    if (!(mx < 20)) oldWouldFail++;                       // 舊判準在這顆種子上會翻紅
  }
  const mean = sum / (S * N);
  console.log(`      ${S} 顆種子 × ${N} 次：最差 max = ${worstNew}（上限 ${CAP}）、`
    + `舊判準 <20 會紅 ${oldWouldFail} 顆（${(oldWouldFail / S * 100).toFixed(1)}%）、平均 ${mean.toFixed(4)} 次`);
  assert.ok(Math.abs(mean - 2) < 0.05, '模擬器本身就不對：平均應為 2.0，實得 ' + mean.toFixed(4));
  assert.strictEqual(worstNew < CAP, true,
    `新判準在 ${S} 顆種子裡也被碰到了（最差 ${worstNew} ≥ ${CAP}）—— 那就不能宣稱「上限碰不到」`);
  assert.ok(oldWouldFail >= 1,
    `舊判準 <20 在 ${S} 顆種子裡一顆都沒紅 —— 那模擬器八成壞了（理論上約 0.57%/顆）`);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【B】test-v6234 ⑦：取樣可重現、判準已搬到意圖級');

T('B1 ⑦ 用的是固定種子（withSeededRandom）＋ 偏態硬幣正對照（withBiasedCoin），且 import 自單一來源', () => {
  assert.ok(/from '\.\/lib\/seeded-rng\.mjs'/.test(head6234), '檔頭沒有 import scripts/lib/seeded-rng.mjs');
  assert.ok(h34.seeded, '⑦ 沒有用 withSeededRandom —— 還在吃真隨機，會繼續隨機假紅');
  assert.ok(h34.rigged, '⑦ 沒有偏態硬幣的正對照 —— 「碰不到上限」可能只是恆真放行（Rule 33）');
  assert.ok(h34.repeatable, '⑦ 沒有「可重現」那條自證 —— 種子哪天被拿掉會靜默退化');
});

T('B2 ⑦ 的判準是「碰不到官方上限 CAP」，不是隨手留的 < 20', () => {
  assert.ok(!h34.old20, '⑦ 仍然寫著 maxFlips < 20 —— 這正是每 175 次 CI 假紅一次的那條');
  assert.ok(h34.capIntent, '⑦ 沒有對 CAP 斷言 —— 判準沒有搬到意圖級');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【C】test-v6242 ⑤：不再對噪音分母取比值');

T('C1 ⑤ 不得再拿另一個牆鐘量測當分母／比較對象（那是噪音除以噪音）', () => {
  assert.ok(!h42.noisyRatio, '⑤ 仍然有「某某.ms 乘/除某某」或「.ms < 某某.ms」的比值判準');
});

T('C2 ⑤ 改成兩條零噪音判準：讓路次數＝節拍算得出來的值 ＋ 總耗時的絕對上界', () => {
  assert.ok(h42.yieldCount, '⑤ 沒有對讓路次數做確定性斷言');
  assert.ok(h42.absBound, '⑤ 沒有總耗時的絕對上界（意圖：admin 不可以等很久）');
  assert.ok(h42.mutCadence, '⑤ 沒有「把節拍突變成每 1 筆」的反安慰劑 —— 計數器可能只是個常數');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【D】HEAD-FAIL：同一份掃描器餵 BASE（' + BASE_SHA.slice(0, 8) + '）必須判成舊寫法');

if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【D】對 BASE 的反安慰劑', '需要歷史 commit；【A】【B】【C】不需要歷史，仍在守');
} else {
  // ⚠ Rule 41：BASE 上「缺席」的東西要用哨兵包起來，不可以整支 throw。
  const bLib = readBaseBlob(ROOT, BASE_SHA, 'scripts/lib/seeded-rng.mjs');
  const b34 = readBaseBlob(ROOT, BASE_SHA, F6234);
  const b42 = readBaseBlob(ROOT, BASE_SHA, F6242);

  T('D1 BASE 沒有 scripts/lib/seeded-rng.mjs（本版才新增；哨兵式斷言，不是靠 throw）', () => {
    assert.strictEqual(bLib.ok, false, 'BASE 竟然已經有 seeded-rng.mjs —— BASE_SHA 指錯版本了？');
  });

  T('D2 ⭐ 反安慰劑：同一份掃描器餵 BASE 的 ⑦ ⇒ B1／B2 必須判成紅', () => {
    assert.ok(b34.ok, '讀不到 BASE 的 ' + F6234);
    const s = scan6234(section(strip(b34.out, 'BASE v6234'), ...SEC6234, 'BASE test-v6234 ⑦'));
    assert.strictEqual(s.seeded, false, 'BASE 的 ⑦ 竟然就有 withSeededRandom —— 掃描器沒在掃東西');
    assert.strictEqual(s.old20, true, 'BASE 的 ⑦ 竟然沒有 maxFlips < 20 —— 掃描器沒在掃東西');
    assert.strictEqual(s.capIntent, false, 'BASE 的 ⑦ 竟然已經對 CAP 斷言');
  });

  T('D3 ⭐ 反安慰劑：同一份掃描器餵 BASE 的 ⑤ ⇒ C1／C2 必須判成紅', () => {
    assert.ok(b42.ok, '讀不到 BASE 的 ' + F6242);
    const s = scan6242(section(strip(b42.out, 'BASE v6242'), ...SEC6242, 'BASE test-v6242 ⑤'));
    assert.strictEqual(s.noisyRatio, true, 'BASE 的 ⑤ 竟然沒有比值判準 —— 掃描器沒在掃東西');
    assert.strictEqual(s.yieldCount, false, 'BASE 的 ⑤ 竟然已經有讓路計數斷言');
    assert.strictEqual(s.mutCadence, false, 'BASE 的 ⑤ 竟然已經有節拍突變');
  });
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【E】版本一致');
T('E1 version.ts ≥ 6.336 且 admin.html 的 SITE_VERSION_HINT 同步', () => {
  const v = /export const VERSION = '([\d.]+)'/.exec(read('src/lib/version.ts'));
  assert.ok(v, '讀不到 VERSION');
  assert.ok(parseFloat(v[1]) >= 6.336, '版本沒 bump：' + v[1]);
  const hint = /window\.SITE_VERSION_HINT = '([\d.]+)'/.exec(read('oracle-admin/admin.html'));
  assert.ok(hint, '讀不到 SITE_VERSION_HINT');
  assert.strictEqual(hint[1], v[1], 'admin.html 的 SITE_VERSION_HINT 沒跟上 version.ts');
});

console.log(`\n=== v6.336 隨機假紅守衛修正：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
