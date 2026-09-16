/**
 * v6.398 突變測試：test-v6398 真的有在守嗎？
 * ⚠ 判紅一律看 exit code（守衛結尾本來就會印「PASS 20 / FAIL 0」，用 /FAIL/ 比對會恆真）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GUARD = join(ROOT, 'scripts/test-v6398-host-aware-energy-card.mjs');
const P_EFF = join(ROOT, 'src/lib/game/effects.ts');
const P_ENG = join(ROOT, 'src/lib/game/engine.ts');
const P_CHZ = join(ROOT, 'src/lib/game/effects/cards/m2_dragon_charizard_batch.ts');
const P_SPD = join(ROOT, 'src/lib/game/effects/cards/v2660_i_wave16_misc9.ts');
const FILES = [P_GUARD, P_EFF, P_ENG, P_CHZ, P_SPD];
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

console.log('=== v6.398 突變測試 ===');

M('M1 ⭐⭐⭐ 烈獄狂火X 改回本檔 local 的非 host-aware 判準 => A1 必紅（站長回報的那個 bug）',
  () => swap(P_CHZ,
    "  for (const pk of selfField(p)) {\n    for (const e of hostEnergyCardsOfType(pk, 'Fire', pool)) eligibleIds.add(e.iid);\n  }",
    "  for (const pk of selfField(p)) {\n    for (const e of pk.energyAttached) {\n      const ec = pool.get(e.cardId);\n      if (ec && ec.supertype === 'Energy' && (ec.pokemonType === 'Fire' || ec.name.includes('【火】'))) eligibleIds.add(e.iid);\n    }\n  }"),
  true, /FAIL A1 /);

M('M2 ⭐⭐⭐ 中央 hostEnergyCardsOfType 改成不看 host（直接比 pokemonType）=> A1 必紅',
  () => swap(P_EFF,
    "  return host.energyAttached.filter(e => energyProvidesType(host, e, type, pool));",
    "  return host.energyAttached.filter(e => pool.get(e.cardId)?.pokemonType === type);"),
  true, /FAIL A1 /);

M('M3 ⭐⭐ registerFieldDiscardMultiply 不把 filter 傳給 picker => A7 必紅（兩端不一致）',
  () => swap(P_EFF,
    "    energyTypeFilter: (typeFilter === 'all' || typeFilter === 'basic') ? undefined : typeFilter,\n    basicEnergyOnly: typeFilter === 'basic' ? true : undefined,\n  });\n  regPre(key, fieldDiscardMultiplyPre(",
    "  });\n  regPre(key, fieldDiscardMultiplyPre("),
  true, /FAIL A7/);

M('M4 ⭐⭐ engine 的凍原堡壘改回只認基本【水】=> A4 必紅',
  () => swap(P_ENG,
    "        const hasWater = defender.active.energyAttached.some(e => energyProvidesType(defender.active!, e, 'Water', pool));",
    "        const hasWater = defender.active.energyAttached.some(e => {\n          const ec = pool.get(e.cardId);\n          return !!ec && ec.supertype === 'Energy' && ec.subtype === 'Basic'\n            && (ec.pokemonType === 'Water' || /【水】/.test(ec.name ?? ''));\n        });"),
  true, /FAIL A4/);

M('M5 ⭐⭐ hostHasEnergyType 自己再寫一次 some（判準又變兩份）=> B4 必紅',
  () => swap(P_EFF,
    "  return hostEnergyCardsOfType(host, type, pool).length > 0;",
    "  return !!host && host.energyAttached.some(e => energyProvidesType(host, e, type, pool));"),
  true, /FAIL B4/);

M('M6 ⭐⭐⭐ 電蜘蛛｜放電：只有 PRE 走中央、POST 改回舊判準（PRE/POST 漂移）=> A2 必紅',
  () => swap(P_SPD,
    "    const lightningIids = new Set(hostEnergyCardsOfType(p.active, 'Lightning', pool).map(e => e.iid));",
    "    const lightningIids = new Set(p.active.energyAttached.filter(e => {\n      const ec = pool.get(e.cardId);\n      return !!ec && (ec.pokemonType === 'Lightning' || String(ec.name ?? '').includes('【雷】'));\n    }).map(e => e.iid));"),
  true, /FAIL A2/);

M('M7 ⭐⭐ preDiscardEnergyEligible 的屬性檢查改成一律放行 => B2 必紅（picker 端的述詞不是「一律放行」）',
  () => swap(P_EFF,
    "  if (opts.type && (!host || !energyProvidesType(host, e, opts.type, pool))) return false;",
    "  if (opts.type && !host) return false;"),
  true, /FAIL B2/);

M('N1 只改守衛的一行註解（不得誤紅）',
  () => swap(P_GUARD, "console.log('\\n【B】", "console.log('\\n【B】(v6398 註解突變) "),
  false, null);

restore();
console.log('=== v6.398 突變測試：' + ok + ' OK / ' + bad + ' NG ===');
process.exit(bad ? 1 : 0);
