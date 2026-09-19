#!/usr/bin/env node
/**
 * 突變測試：證明 test-pw-gate.mjs 不是安慰劑。
 *
 * ⚠ 誠實揭露：A1b／A1b2／A1b3／A1c／C4b／C4c／C4d／D1 餵的是**寫死的常數字串樣本**，
 *   對 deploy.yml／package.json 的突變**結構上恆綠**，不構成獨立性證據。
 *   真正有資訊量的是 M1／M4–M8（三個過渡期把手與 CI 安裝）與 M10／M11（掏空掃描判準）。
 *
 * ⚠⚠ 破壞式：會暫時改寫 scripts/lib/pw.mjs、scripts/run-pw-guards.mjs、
 *   .github/workflows/deploy.yml、package.json 與一支守衛。請在沙盒裡跑。
 *   刻意**不**接進 npm test chain。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const GUARD_REL = 'scripts/test-pw-gate.mjs';
const GUARD = join(ROOT, GUARD_REL);
const GATE = 'scripts/lib/pw.mjs';
const RUNPW = 'scripts/run-pw-guards.mjs';
const YML = '.github/workflows/deploy.yml';
const PKG = 'package.json';
const V6285 = 'scripts/test-v6285-settings-scroll.mjs';

/** @type {{id:string,file:string,from:string,to:string,red:string[],green?:string[]}[]} */
const MUTS = [
  {
    id: 'M1 ⭐ 把過渡期預設改成 auto 卻忘了刪 deploy.yml 的三行把手',
    file: GATE,
    from: String.raw`export const PW_DEFAULT_MODE = 'off';`,
    to: String.raw`export const PW_DEFAULT_MODE = 'auto';`,
    red: ['B0'],
    green: ['A1', 'C1', 'C2', 'C3', 'C4'],
  },
  {
    id: 'M2 pwMode 對無效值不退回預設（判準被改寫）',
    file: GATE,
    from: String.raw`  return PW_DEFAULT_MODE;`,
    to: String.raw`  return 'auto';`,
    red: ['D1'],
    green: ['B0', 'A1', 'C4'],
  },
  {
    id: 'M4 ⭐ deploy.yml 主 chain 的 PTCG_PW: off 被刪掉',
    file: YML,
    from: String.raw`          PTCG_PW: 'off'`,
    to: String.raw`          # PTCG_PW removed-by-mutcheck`,
    red: ['B0'],
    green: ['C1', 'C2', 'C3', 'D1'],
  },
  {
    id: 'M5 ⭐ 獨立 step 的 continue-on-error 被拿掉（PW 紅燈會直接擋 deploy）',
    file: YML,
    from: String.raw`        continue-on-error: true`,
    to: String.raw`        continue-on-error: false`,
    red: ['B0'],
    green: ['C1', 'C2', 'C3'],
  },
  {
    id: 'M6 ⭐⭐ CI 不再安裝 chromium-headless-shell（那 10 支等於沒在守）',
    file: YML,
    from: String.raw`        run: npx playwright install --with-deps chromium-headless-shell`,
    to: String.raw`        run: echo skip-install`,
    red: ['C1'],
    green: ['B0', 'C2', 'C3', 'C4'],
  },
  {
    id: 'M7 CI 不再快取瀏覽器（每次都重抓 115MB）',
    file: YML,
    from: String.raw`          path: ~/.cache/ms-playwright`,
    to: String.raw`          path: ~/.cache/nothing-here`,
    red: ['C2'],
    green: ['B0', 'C1', 'C3'],
  },
  {
    id: 'M8 ⭐ 快取鍵寫死瀏覽器 build 號（pin 死版本號，升版後靜默失效）',
    file: YML,
    from: "          key: ms-playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}",
    to: String.raw`          key: ms-playwright-chromium_headless_shell-1243`,
    red: ['C2b'],
    green: ['B0', 'C1', 'C2', 'C3'],
  },
  {
    id: 'M9 ⭐⭐ 一支守衛改回自己 require playwright（Rule 38：判準變兩份）',
    file: V6285,
    from: String.raw`chromium = pwChromium('v6.285 【D】DOM 量測');`,
    to: String.raw`try { chromium = require('playwright').chromium; } catch { chromium = null; }`,
    red: ['A1'],
    // ⚠ 我第一次把 C4 也宣告成 red，被突變測試當場抓出誤解：這個突變只換掉 **gate 那一行**，
    //   檔頭的 `import { pwChromium, pwLaunchWith } from './lib/pw.mjs';` **還在**
    //   ⇒ usesPwGate 仍判它是 PW 守衛 ⇒ 掃到的支數不變 ⇒ C4 維持綠。
    //   （這正是「必須斷言紅在預期的那一條」這個紀律的用處 —— 安慰劑型態 2：紅錯地方也算沒測到。）
    green: ['B0', 'C1', 'C2', 'C3', 'C4', 'A1b', 'A1c'],
  },
  {
    id: 'M4b ⭐⭐ 把剝註解拿掉（deploy.yml 的註解裡就寫著那三行，會讓 B0 假綠）',
    file: GUARD_REL,
    from: String.raw`.filter((L) => !/^\s*#/.test(L))`,
    to: String.raw`.filter(() => true)`,
    // ⚠ 這正是第一版真的犯過的錯（突變 M4 當時存活）：判準從註解裡讀到
    //   「⭐ 修完之後要刪掉 PTCG_PW: 'off'」這句話，於是真的那一行被刪掉也看不出來。
    red: ['B0b'],
    green: ['B0', 'B0c', 'C1', 'C2'],
  },
  {
    id: 'M10 ⭐ usesPwGate 放寬回「只要 import 了 ./lib/pw.mjs 就算」',
    file: RUNPW,
    from: String.raw`  return /\b(pwChromium|pwLaunch|pwLaunchWith|pwUsable)\b/.test(m[1]);`,
    to: String.raw`  return true;`,
    // ⚠ 第一次我把突變寫成「改掉捕捉群組的形狀」，那根本沒有改變語意 ⇒ 突變存活。
    //   ⭐ 通則：突變要落在**你想守的那個邊際帶**，不是「看起來有改到」的地方。
    red: ['C4d'],
    green: ['C4', 'C4b', 'C4c', 'B0'],
  },
  {
    id: 'M11 ⭐ 把下限常數調成 0（C4 會永遠成立）',
    file: RUNPW,
    from: String.raw`export const MIN_PW_GUARDS = 10;`,
    to: String.raw`export const MIN_PW_GUARDS = 0;`,
    red: ['C4e'],
    green: ['C4', 'C4b', 'C4c', 'C4d', 'B0'],
  },
  {
    id: 'M12 ⭐⭐ playwright 從 devDependencies 拿掉（npm ci 不會裝 ⇒ 等於沒有）',
    file: PKG,
    from: String.raw`    "playwright": "^1.63.0",`,
    to: String.raw``,
    red: ['C3'],
    green: ['B0', 'C1', 'C2', 'C4'],
  },
];

function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, timeout: 300000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
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
      + `\n  ⚠ 不唯一時 replace 只會改掉第一處 ⇒ 突變只做了一半。\n  找：${m.from.slice(0, 100)}`);
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

console.log(`\n=== mutcheck PW 中央閘：${killed}/${MUTS.length} 個突變都被抓到 ===`);
