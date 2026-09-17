/**
 * v6.401 突變測試：test-v6401 真的有在守嗎？
 * ⚠ 判紅一律看 exit code（守衛結尾本來就會印「PASS 12 / FAIL 0」）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GUARD = join(ROOT, 'scripts/test-v6401-energy-units-central.mjs');
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

console.log('=== v6.401 突變測試 ===');

M('M1 ⭐⭐⭐ countEnergy 改回自己算（不走中央）=> A1 必紅',
  () => swap(P_ENG,
    "  for (const e of pokemon.energyAttached) {\n    for (const u of energyUnitsOnHost(e, pokemon, pool)) {\n      for (const ty of u.types) map.set(ty, (map.get(ty) ?? 0) + 1);\n    }\n  }",
    "  for (const e of pokemon.energyAttached) {\n    for (const ty of getEnergyProvided(e.cardId, pool)) map.set(ty, (map.get(ty) ?? 0) + 1);\n  }"),
  true, /FAIL A1/);

M('M2 ⭐⭐⭐ 火箭隊能量改回 1 個單位 => B1 必紅（站長裁示的那一條）',
  () => swap(P_ENG,
    "  if (c.name === '火箭隊能量') return [{ types: ['Psychic', 'Darkness'] }, { types: ['Psychic', 'Darkness'] }];",
    "  if (c.name === '火箭隊能量') return [{ types: ['Psychic', 'Darkness'] }];"),
  true, /FAIL B1/);

M('M3 ⭐⭐⭐ 拿掉 host=null 的保守分支（稜鏡沒有 host 時當成非進化）=> C1 必紅',
  () => swap(P_ENG,
    "  if (c.name === '稜鏡能量') return (hasHost && !hostIsEvolution) ? [ALL()] : [C()];",
    "  if (c.name === '稜鏡能量') return !hostIsEvolution ? [ALL()] : [C()];"),
  true, /FAIL C1/);

M('M4 ⭐⭐ 拿掉繁茂分支 => C2 必紅',
  () => swap(P_ENG,
    "  if (opts?.bloom && isBasicEnergyOfType(c, 'Grass')) {\n    return [{ types: ['Grass'] }, { types: ['Grass'] }];\n  }",
    "  if (false && opts?.bloom && isBasicEnergyOfType(c, 'Grass')) {\n    return [{ types: ['Grass'] }, { types: ['Grass'] }];\n  }"),
  true, /FAIL C2/);

M('M5 ⭐⭐ 新衝天能量附【2階】的 2 個改成 1 個 => C3 必紅（零回歸釘死具體數值）',
  () => swap(P_ENG,
    "  if (c.name === '新衝天能量') return (hasHost && hostIsStage2) ? [ALL(), ALL()] : [C()];",
    "  if (c.name === '新衝天能量') return (hasHost && hostIsStage2) ? [ALL()] : [C()];"),
  true, /FAIL C3/);

M('M6 ⭐⭐⭐ canAffordAttack 改回自己收集單位（付費端脫離中央）=> A1 必紅',
  () => swap(P_ENG,
    "  for (const e of pokemon.energyAttached) {\n    units.push(...energyUnitsOnHost(e, pokemon, pool, { bloom: hasBloom }));\n  }",
    "  for (const e of pokemon.energyAttached) {\n    units.push(...getEnergyUnits(e.cardId, pool));\n  }"),
  true, /FAIL A1/);

M('M7 ⭐⭐ 把特殊能量卡名搬回 countEnergy（判準又變兩份）=> A2 必紅',
  () => swap(P_ENG,
    "  const map = new Map<EnergyType, number>();\n  for (const e of pokemon.energyAttached) {\n    for (const u of energyUnitsOnHost(e, pokemon, pool)) {",
    "  const map = new Map<EnergyType, number>();\n  for (const e of pokemon.energyAttached) {\n    if (pool.get(e.cardId)?.name === '古舊能量') { /* mutant */ }\n    for (const u of energyUnitsOnHost(e, pokemon, pool)) {"),
  true, /FAIL A2/);

M('N1 只改守衛的一行註解（不得誤紅）',
  () => swap(P_GUARD, "console.log('\\n【B】", "console.log('\\n【B】(v6401 註解突變) "),
  false, null);

restore();
console.log('=== v6.401 突變測試：' + ok + ' OK / ' + bad + ' NG ===');
process.exit(bad ? 1 : 0);
