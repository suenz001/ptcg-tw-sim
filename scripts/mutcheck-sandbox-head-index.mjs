#!/usr/bin/env node
/**
 * 突變測試：證明 test-sandbox-head-index.mjs 不是安慰劑。
 *
 * 為什麼這支需要突變測試：A 組是**靜態形狀**斷言（「原始碼裡必須有 reset --mixed、
 * 不能有 checkout」），這類斷言最容易寫成「只驗字串存在」的安慰劑；而正對照如果
 * 餵的是一個「三項全犯」的樣本，掏空其中任何一項偵測之後它仍然會回 >= 2 條
 * ⇒ 照樣綠（安慰劑型態 12）。所以 A1b/A1b2/A1b3 與 A2b/A2b2 是**逐項**的正對照，
 * 這裡就逐項去掏空，證明每一條各自有效。
 *
 * B 組（行為端）也有同型風險：B1「舊寫法必敗」如果工作樹其實是乾淨的，那它就會
 * 變成恆假而不是恆真——M10 把「工作樹是髒的」這個前提拿掉，證明 B1 量的是真東西。
 *
 * ⚠ 誠實揭露：有幾條 `green` 宣告**結構上恆綠**，不構成獨立性證據 ——
 *   M1/M2/M2b/M2c/M2d 宣告的 `A1b*`／`A2b*` 餵的是寫死的常數字串樣本，與 runner 無關；
 *   M1 宣告的 `B1`/`B4` 在 B 組（完全不讀 run-tests.mjs）下恆綠；
 *   M10 宣告的 `A1`/`A2` 同理（M10 只改守衛的 B 段）。
 *   真正有資訊量的是 M5–M9、M11–M13 那幾組：它們逐項掏空守衛**自己的偵測器**，
 *   證明各條偵測彼此獨立。
 *
 * 做法：逐一注入突變 → 跑守衛 → 斷言 ① exit ≠ 0 ② **紅在預期的那一條**
 * （⚠ 絕不用 /FAIL/.test(out)，守衛結尾恆印「FAIL N」）→ finally 還原 → 複驗全綠。
 *
 * ⚠⚠ 這支是**破壞式**的：會暫時改寫 scripts/run-tests.mjs 與守衛自己。
 *   請在平行 runner 的沙盒裡跑，不要在主樹跑。它刻意**不**接進 npm test chain
 *   （test-runner-and-chain-hygiene 的 A1 正是在守這件事）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const GUARD_REL = 'scripts/test-sandbox-head-index.mjs';
const GUARD = join(ROOT, GUARD_REL);
const RUNNER = 'scripts/run-tests.mjs';

// ⚠ anchor 一律用**單行**＋`String.raw`：這些檔是 CRLF，跨行 anchor 用 '\n' 接會對不上；
//   而 regex 字面裡的 \s、\{ 若寫在一般字串裡會被 JS 吃掉一層跳脫。
/** @type {{id:string,file:string,from:string,to:string,red:string[],green?:string[]}[]} */
const MUTS = [
  {
    id: 'M1 重用分支改回「try { checkout } catch {}」（本版修掉的那個 bug 本體）',
    file: RUNNER,
    from: String.raw`    } catch (e1) {`,
    to: String.raw`      git(['checkout', '-q', '--detach', headSha], sb);
    } catch (e1) {`,
    red: ['A1'],
    green: ['A1b', 'A1b2', 'A1b3', 'A1c', 'A2', 'B1', 'B4'],
  },
  {
    id: 'M2 只退化成「空吞 catch」，而且帶**行內註解**（＝ BASE 的原形）',
    file: RUNNER,
    from: String.raw`    } catch (e1) {`,
    to: String.raw`    } catch { /* 靜默吞掉 */ }
    if (0) try { 0; } catch (e1) {`,
    // ⚠ 第一版這裡用的是**字面**的 `catch { }`（沒有註解），給了假的安全感：
    //   `stripCommentsBlankChecked` 不剝行內註解，所以帶註解的版本（也就是 BASE 的原形）
    //   在舊判準下是**存活**的。獨立審查的 V1 實測到這件事。
    red: ['A1'],
    green: ['A1b', 'A1b3', 'A2'],
  },
  {
    id: 'M2b 空吞但帶具名參數：catch (e) { }',
    file: RUNNER,
    from: String.raw`    } catch (e1) {`,
    to: String.raw`    } catch (e) { }
    if (0) try { 0; } catch (e1) {`,
    red: ['A1'],
    green: ['A1b', 'A1b3', 'A2'],
  },
  {
    id: 'M2c ⭐ 後置斷言的 throw 還在、但條件恆假（暫時關掉來 debug 忘了打開）· HEAD 那條',
    file: RUNNER,
    from: String.raw`  if (sbHead !== headSha) {`,
    to: String.raw`  if (false && sbHead !== headSha) {`,
    // ⚠ 這個形狀在第一版守衛下**完全存活**（獨立審查的 V3）：舊判準只檢查
    //   「那兩個 git 指令的字串有沒有出現」，不檢查斷言還有沒有效力。
    red: ['A2'],
    green: ['A1', 'A2b', 'A2b2', 'A2b3'],
  },
  {
    id: 'M2d ⭐ 同上 · index 那條（if (0 &&)）',
    file: RUNNER,
    from: String.raw`  if (rIdx.status !== 0) {`,
    to: String.raw`  if (0 && rIdx.status !== 0) {`,
    red: ['A2'],
    green: ['A1', 'A2b', 'A2b2', 'A2b3'],
  },
  {
    id: 'M3 拿掉 HEAD 的後置斷言',
    file: RUNNER,
    from: String.raw`  const sbHead = git(['rev-parse', 'HEAD'], sb).trim();`,
    to: String.raw`  const sbHead = headSha;`,
    red: ['A2'],
    green: ['A1', 'A2b', 'A2b2'],
  },
  {
    id: 'M4 拿掉 index==HEAD 的後置斷言',
    file: RUNNER,
    from: String.raw`  const rIdx = spawnSync('git', ['-C', sb, 'diff', '--cached', '--quiet', 'HEAD'], { encoding: 'utf8' });`,
    to: String.raw`  const rIdx = { status: 0 };`,
    red: ['A2'],
    green: ['A1', 'A2b', 'A2b2'],
  },
  {
    id: 'M5 掏空「checkout」的偵測',
    file: GUARD_REL,
    from: String.raw`  if (/checkout/.test(block)) {`,
    to: String.raw`  if (0 && /checkout/.test(block)) {`,
    red: ['A1b'],
    // ⭐ A1 不會紅（現行程式碼本來就沒有 checkout）—— 逐項正對照才是它唯一的偵測器。
    green: ['A1', 'A1b2', 'A1b3', 'A1c'],
  },
  {
    id: 'M6 掏空「空吞 catch」的偵測',
    file: GUARD_REL,
    from: String.raw`  if (/catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)?\s*\}/.test(block)) {`,
    to: String.raw`  if (0) {`,
    red: ['A1b2'],
    green: ['A1', 'A1b', 'A1b3', 'A1c'],
  },
  {
    id: 'M7 掏空「必須有 reset --mixed」的偵測',
    file: GUARD_REL,
    from: String.raw`  if (!/'reset'[\s\S]{0,40}'--mixed'/.test(block)) {`,
    to: String.raw`  if (false) {`,
    red: ['A1b3'],
    green: ['A1', 'A1b', 'A1b2', 'A1c'],
  },
  {
    id: 'M8 掏空「後置斷言要有 HEAD 比對」的偵測',
    file: GUARD_REL,
    from: String.raw`  probe(RX_HEAD, RX_IDX, 'HEAD（rev-parse）');`,
    to: String.raw`  if (0) probe(RX_HEAD, RX_IDX, 'HEAD（rev-parse）');`,
    red: ['A2b', 'A2b4', 'A2b5'],
    green: ['A2', 'A2b2', 'A2b3', 'A2b6'],
  },
  {
    id: 'M9 掏空「後置斷言要有 index 比對」的偵測',
    file: GUARD_REL,
    from: String.raw`  probe(RX_IDX, RX_HEAD, 'index==HEAD（diff --cached --quiet）');`,
    to: String.raw`  if (0) probe(RX_IDX, RX_HEAD, 'index==HEAD（diff --cached --quiet）');`,
    red: ['A2b2', 'A2b6'],
    green: ['A2', 'A2b', 'A2b3', 'A2b4', 'A2b5'],
  },
  {
    id: 'M9b ⭐ 拿掉 probe 的窗口截斷（第一個斷言會借用第二個的 throw ⇒ 恆綠）',
    file: GUARD_REL,
    from: String.raw`    const o = other.exec(after);`,
    to: String.raw`    const o = null;`,
    // A2b4 的註解就是在講這件事：窗口若不截斷，「HEAD 那條的 throw 被拿掉」這個
    // 正對照會借用 index 那條的 throw 而永遠通過 ⇒ 兩條 probe 不獨立。
    // ⚠ A2b6 也會跟著紅，而且是**正確**的連帶：窗口不截斷時，HEAD 那條的窗口也看得到
    //   index 那條的 `if (0 &&`，於是兩條都被判成「被恆假條件停用」⇒ 回 2 條而不是 1 條。
    //   我第一次把 A2b6 宣告成 green，被突變測試當場抓出誤解（這正是「必須斷言紅在
    //   預期的那一條」這個紀律的用處）。
    red: ['A2b4', 'A2b6'],
    green: ['A2', 'A2b', 'A2b2', 'A2b3', 'A2b5'],
  },
  {
    id: 'M10 ⭐ 把 B 組「沙盒工作樹是髒的」這個前提拿掉（證明 B1 不是恆真）',
    file: GUARD_REL,
    from: String.raw`    writeFileSync(join(wt, 'b.txt'), 'B1\n'); writeFileSync(join(wt, 'a.txt'), 'A2\n');`,
    to: String.raw`    writeFileSync(join(wt, 'a.txt'), 'A1\n');`,
    // 工作樹乾淨 ⇒ checkout 會成功 ⇒ B1 紅；HEAD/index 也就跟著前進 ⇒ B2/B3 一起紅。
    // 這正是要證明的：那三條量的是「髒工作樹」這個真實情境，不是 git 的恆常行為。
    red: ['B1', 'B2', 'B3'],
    green: ['B4', 'B5', 'B6', 'B7', 'A1', 'A2'],
  },
  {
    id: 'M11 D 組清單漏列一個來源（＝第一版真的犯過的錯）',
    file: GUARD_REL,
    from: String.raw`  ['scripts/test-v6378-eol-harness-and-t-split.mjs', 'ls-files --others：static/music 殘檔'],`,
    to: String.raw`  // removed-by-mutcheck`,
    red: ['D1'],     // 掃得到、清單裡沒有 ⇒ 「新的來源沒被記下來」
    green: ['D2', 'D3', 'D4'],
  },
  {
    id: 'M12 D 組清單留了一條已經不存在的（過期）',
    file: GUARD_REL,
    from: String.raw`  ['scripts/test-v6378-eol-harness-and-t-split.mjs', 'ls-files --others：static/music 殘檔'],`,
    to: String.raw`  ['scripts/test-v6378-eol-harness-and-t-split.mjs', 'ls-files --others：static/music 殘檔'],
  ['scripts/test-this-file-does-not-exist.mjs', '過期條目'],`,
    red: ['D2'],
    green: ['D1', 'D3', 'D4'],
  },
  {
    id: 'M13 掏空 D 組的偵測判準（readsIndex 恆偽）',
    file: GUARD_REL,
    from: String.raw`  return /['"]ls-files['"]/.test(src);`,
    to: String.raw`  return false && /['"]ls-files['"]/.test(src);`,
    red: ['D2', 'D3'],   // 掃不到任何東西 ⇒ 清單全部「不見了」＋正對照失效
    green: ['D0', 'D4'],
  },
];

function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, timeout: 300000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
/** 某一條斷言有沒有紅。⚠ 只認「FAIL <id>」這個逐條樣式。 */
function isRed(out, id) {
  return new RegExp('^\\s*FAIL ' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'm').test(out);
}

console.log('【0】基準：未突變時守衛必須全綠');
{
  const r = runGuard();
  assert.strictEqual(r.code, 0, '未突變就紅了，突變測試無意義：\n' + r.out.slice(-1500));
  console.log('  OK  守衛在乾淨狀態下 exit=0');
}

let killed = 0;
for (const m of MUTS) {
  const path = join(ROOT, m.file);
  const orig = readFileSync(path, 'utf8');
  try {
    const n = orig.split(m.from).length - 1;
    assert.strictEqual(n, 1, `${m.id}：突變 anchor 在 ${m.file} 裡出現 ${n} 次（需要恰好 1 次）`
      + `\n  ⚠ 不唯一時 replace 只會改掉第一處 ⇒ 突變只做了一半，`
      + `「紅在預期那一條」成立的原因就不是你以為的那個。\n  找：${m.from.slice(0, 100)}`);
    writeFileSync(path, orig.replace(m.from, m.to));
    const r = runGuard();
    assert.notStrictEqual(r.code, 0, `${m.id}：突變存活（守衛照樣 exit=0）\n` + r.out.slice(-1200));
    for (const id of m.red) {
      assert.ok(isRed(r.out, id), `${m.id}：應該紅在 ${id}，但那一條沒紅\n` + r.out.slice(-1800));
    }
    for (const id of (m.green || [])) {
      assert.ok(!isRed(r.out, id), `${m.id}：${id} 不該跟著紅（斷言之間沒有各自獨立）\n` + r.out.slice(-1800));
    }
  } finally {
    writeFileSync(path, orig);
  }
  killed++;
  console.log(`  OK  ${m.id}  → 紅在 ${m.red.join('/')}${m.green ? '，而 ' + m.green.join('/') + ' 維持綠' : ''}`);
}

console.log('\n【末】還原後複驗');
{
  const r = runGuard();
  assert.strictEqual(r.code, 0, '還原後守衛沒有回到全綠（finally 沒還原乾淨）：\n' + r.out.slice(-1500));
  console.log('  OK  還原後 exit=0');
}

console.log(`\n=== mutcheck 沙盒 HEAD/index：${killed}/${MUTS.length} 個突變都被抓到 ===`);
