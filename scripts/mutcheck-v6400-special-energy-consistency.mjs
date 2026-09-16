/**
 * v6.400 突變測試：test-v6400 真的有在守嗎？
 * ⚠ 判紅一律看 exit code（守衛結尾本來就會印「PASS 15 / FAIL 0」）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GUARD = join(ROOT, 'scripts/test-v6400-special-energy-consistency.mjs');
const P_ENG = join(ROOT, 'src/lib/game/engine.ts');
const FILES = [P_GUARD, P_ENG];
const ORIG = new Map(FILES.map((p) => [p, readFileSync(p, 'utf8')]));
const restore = () => { for (const [p, s] of ORIG) writeFileSync(p, s, 'utf8'); };

let ok = 0, bad = 0;
function runGuard() {
  try {
    execFileSync(process.execPath, [P_GUARD], { cwd: ROOT, maxBuffer: 1 << 26, timeout: 600000 });
    return { red: false, out: '' };
  } catch (e) {
    return { red: true, out: String((e.stdout && e.stdout.toString()) || '') + String((e.stderr && e.stderr.toString()) || '') + '#exit' };
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
function M(name, mutate, wantRed, wantMsg, forbidMsg) {
  restore();
  try { mutate(); } catch (e) { console.log('  NG ' + name + ' => 施加突變時出錯：' + e.message); bad++; restore(); return; }
  const { red, out } = runGuard();
  let p = (red === wantRed), why = '';
  if (p && red && wantMsg && !wantMsg.test(out)) { p = false; why = '（紅了，但不是紅在預期的那一條）'; }
  if (p && forbidMsg && forbidMsg.test(out)) { p = false; why = '（不該紅的那一條也紅了）'; }
  if (p) { console.log('  OK ' + name); ok++; }
  else { console.log('  NG ' + name + ' => ' + (red ? '紅了' : '沒紅') + '（期望 ' + (wantRed ? '紅' : '綠') + '）' + why); bad++; }
  restore();
}

console.log('=== v6.400 突變測試 ===');

// ⚠ 拿掉表項會同時打到 getEnergyUnits（付費端 fallback 成【無】）⇒ 整支一定會紅在 B1。
//   這一條要證明的不是「整支綠」，而是「**F1 不會紅**」——卡名 fallback 真的把 getEnergyProvided 接住了。
M('M1 ★★ 把「燃料【火】能量」從 SPECIAL_ENERGY_TYPES 拿掉 => 紅在 B1，但 **F1 不得紅**（卡名 fallback 接住 getEnergyProvided）',
  () => swap(P_ENG, "  '燃料【火】能量': ['Fire'],", "  // (mutant removed)"),
  true, /FAIL B1/, /FAIL F1 /);

M('M2 ⭐⭐⭐ 同時拿掉表項**與**卡名 fallback => F1 必紅（證明 M1 的綠真的是 fallback 撐的）',
  () => {
    swap(P_ENG, "  '燃料【火】能量': ['Fire'],", "  // (mutant removed)");
    swap(P_ENG, "  const sm = c.name.match(/【(.+?)】/);\n  if (sm) {\n    const st = ZH_ENERGY_TYPE[sm[1]];\n    if (st) return [st];\n  }\n  return ['Colorless'];",
      "  return ['Colorless'];");
  },
  true, /FAIL F1 /);

M('M3 ⭐⭐⭐ energyTypeUnitsHostAware 的一般分支改回 isEnergyOfType => C1 必紅（本版的修正被撤回）',
  () => swap(P_ENG, "  return getEnergyProvided(e.cardId, pool).includes(type) ? 1 : 0;\n}",
    "  return isEnergyOfType(ec, type) ? 1 : 0;\n}"),
  true, /FAIL C1/);

M('M4 ⭐⭐ 火箭隊能量的 2 改成 1 => D4 必紅（零回歸釘死具體數值）',
  () => swap(P_ENG, "  if (ec.name === '火箭隊能量') return (type === 'Psychic' || type === 'Darkness') ? 2 : 0;",
    "  if (ec.name === '火箭隊能量') return (type === 'Psychic' || type === 'Darkness') ? 1 : 0;"),
  true, /FAIL D4/);

M('M5 ⭐⭐ 稜鏡能量的 host 判斷反過來 => D1 必紅',
  () => swap(P_ENG, "  if (ec.name === '稜鏡能量') return !hostIsEvolution ? 1 : (type === 'Colorless' ? 1 : 0);",
    "  if (ec.name === '稜鏡能量') return hostIsEvolution ? 1 : (type === 'Colorless' ? 1 : 0);"),
  true, /FAIL D1/);

M('M6 ⭐⭐⭐ canAffordAttack 的稜鏡分支拿掉（付費端與計數端脫鉤）=> B1 必紅',
  () => swap(P_ENG,
    "    if (ec?.name === '稜鏡能量') {\n      units.push({ types: isEvolution ? ['Colorless'] : ALL_TYPES });\n      continue;\n    }",
    "    if (ec?.name === '稜鏡能量') {\n      units.push({ types: ['Colorless'] });\n      continue;\n    }"),
  true, /FAIL B1/);

M('M7 ⭐⭐ totalEnergyUnits 的新衝天倍率拿掉（撤退端與付費端脫鉤）=> B2 必紅',
  () => swap(P_ENG, "      n += hostIsStage2 ? 2 : 1;", "      n += 1;"),
  true, /FAIL B2/);

M('N1 只改守衛的一行註解（不得誤紅）',
  () => swap(P_GUARD, "console.log('\\n【D】", "console.log('\\n【D】(v6400 註解突變) "),
  false, null);

restore();
console.log('=== v6.400 突變測試：' + ok + ' OK / ' + bad + ' NG ===');
process.exit(bad ? 1 : 0);
