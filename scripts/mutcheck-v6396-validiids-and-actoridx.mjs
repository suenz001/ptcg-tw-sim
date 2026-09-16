/**
 * v6.396 突變測試：test-v6396 真的有在守嗎？
 *
 * ⚠ 判紅一律看 exit code —— 守衛結尾本來就會印「PASS 11 / FAIL 0」，
 *   用 /FAIL/.test(out) 判紅會恆真（v6.393c 第一版踩過）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GUARD = join(ROOT, 'scripts/test-v6396-validiids-and-actoridx.mjs');
const P_SHARED = join(ROOT, 'src/lib/game/effects/_shared.ts');
const P_AIEVAL = join(ROOT, 'src/lib/game/ai-eval.ts');
const P_ENGINE = join(ROOT, 'src/lib/game/engine.ts');
const P_TYPES = join(ROOT, 'src/lib/game/types.ts');
const FILES = [P_GUARD, P_SHARED, P_AIEVAL, P_ENGINE, P_TYPES];
const ORIG = new Map(FILES.map((p) => [p, readFileSync(p, 'utf8')]));
const restore = () => { for (const [p, s] of ORIG) writeFileSync(p, s, 'utf8'); };

let ok = 0, bad = 0;
function runGuard() {
  try {
    const out = execFileSync(process.execPath, [P_GUARD], { cwd: ROOT, maxBuffer: 1 << 26, timeout: 600000 }).toString('utf8');
    return { red: false, out };
  } catch (e) {
    const out = String((e.stdout && e.stdout.toString()) || '') + String((e.stderr && e.stderr.toString()) || '') + '#exit';
    return { red: true, out };
  }
}
function swap(p, from, to, want = 1) {
  const s = readFileSync(p, 'utf8');
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const f = from.replace(/\r?\n/g, eol), t = to.replace(/\r?\n/g, eol);
  const n = s.split(f).length - 1;
  if (n !== want) throw new Error('錨點命中 ' + n + ' 次（預期 ' + want + '）');
  writeFileSync(p, s.split(f).join(t), 'utf8');
}
function M(name, mutate, wantRed, wantMsg) {
  restore();
  try { mutate(); } catch (e) { console.log('  NG ' + name + ' => 施加突變時出錯：' + e.message); bad++; restore(); return; }
  const { red, out } = runGuard();
  let p = (red === wantRed), why = '';
  if (p && red && wantMsg && !wantMsg.test(out)) { p = false; why = '（紅了，但不是紅在預期的那一條）'; }
  if (p) { console.log('  OK ' + name); ok++; }
  else { console.log('  NG ' + name + ' => ' + (red ? '紅了' : '沒紅') + '（期望 ' + (wantRed ? '紅' : '綠') + '）' + why); bad++; }
  restore();
}

console.log('=== v6.396 突變測試 ===');

// M1：白名單改回寫在 pending 頂層（v6.396 之前的寫法）
M('M1 ⭐⭐⭐ healOneOwnPokemonPending 的白名單改回寫在 pending 頂層 => A1 必紅',
  () => swap(P_SHARED,
    "    effectKey,\n    // ⚠⚠ validIids **必須寫在 params 裡**：engine 的中央消毒閘讀的是 `pending.params?.validIids`，\n    //   寫在 pending 頂層那一行從來不會被讀到（v6.396 修）。\n    params: { healAmount: amount, validIids: ownIids },",
    "    validIids: ownIids,\n    effectKey,\n    params: { healAmount: amount },"),
  true, /FAIL A1 /);

// M2：拿掉「actorIdx 落到假想盤面」那一行（v6.396 之前的行為）
M('M2 ⭐⭐⭐ 拿掉 sim.activePlayerIndex = actorIdx => B1 必紅（B0 仍須綠）',
  () => swap(P_AIEVAL, "      sim.activePlayerIndex = actorIdx;\n", "", 2),
  true, /FAIL B1 /);

// M3：中央閘不再讀 params.validIids（整段放行）
M('M3 ⭐⭐ 中央閘改成原封放行（不讀 params.validIids）=> A2 必紅',
  () => swap(P_ENGINE,
    "    const allowSet = new Set(viRaw as string[]);\n    return iids.filter((iid) => allowSet.has(iid));",
    "    void viRaw;\n    return iids;"),
  true, /FAIL A2 /);

// M4：把死欄位加回型別（頂層寫法又會躲過 tsc）
M('M4 ⭐ 把 validIids 欄位加回 PendingSelection => A4 必紅',
  () => swap(P_TYPES, "export interface PendingSelection {\n", "export interface PendingSelection {\n  validIids?: string[];\n"),
  true, /FAIL A4 /);

// N1：只改守衛裡的註解，不得誤紅
M('N1 只改守衛的一行註解（不得誤紅）',
  () => swap(P_GUARD, "console.log('\\n【A】", "console.log('\\n【A】(v6396 註解突變) "),
  false, null);

restore();
let same = true;
for (const [p, s] of ORIG) if (readFileSync(p, 'utf8') !== s) same = false;
if (same) { console.log('  OK 還原檢查：五個檔都逐位元回到突變前'); ok++; }
else { console.log('  NG 還原檢查失敗'); bad++; }
const final = runGuard();
if (!final.red) { console.log('  OK 還原後守衛回到全綠'); ok++; }
else { console.log('  NG 還原後守衛仍是紅的'); bad++; }

console.log('\n=== v6.396 突變測試：OK ' + ok + ' / NG ' + bad + ' ===');
process.exit(bad ? 1 : 0);