/**
 * v5.761 守衛:所有 TOOL_ATTACK_BONUS.get( 套用點都必須在「阻礙之塔(isToolsJammed)」gate 之內。
 * 阻礙之塔讓場上所有【寶可夢道具】失效 → 攻擊方傷害加成道具在主管線(engine)已 gate,但
 * 多目標 inline 傷害 resolver(snipe-multi / clone-strike-multi-hit)曾漏 gate(v5.761 補)。
 * 此為防禦性不變量(目前 TOOL_ATTACK_BONUS Map 工具皆非現役,無 active 影響),防將來該類
 * 工具重返現役時於這些招式誤加傷害。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
const ROOT = process.env.PTCG_SRC_ROOT || fileURLToPath(new URL('..', import.meta.url));
const GATE = /isToolsJammed|toolsJammed|JAMMING_TOWER|阻礙之塔/;
const ungated = [];
for (const rel of ['src/lib/game/effects.ts', 'src/lib/game/engine.ts']) {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/TOOL_ATTACK_BONUS\.get\(/.test(lines[i])) continue;
    // 往回最多 30 行找 jamming gate（同一個 enclosing 區塊）
    let found = false;
    for (let j = i; j >= Math.max(0, i - 30); j--) { if (GATE.test(lines[j])) { found = true; break; } }
    if (!found) ungated.push(`${rel}:${i + 1}`);
  }
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
T('每個 TOOL_ATTACK_BONUS.get 套用點都在 isToolsJammed gate 內', () => {
  assert.equal(ungated.length, 0, '未 gate 的套用點:\n    ' + ungated.join('\n    '));
});
console.log('\nTOOL_ATTACK_BONUS 阻礙之塔 gate 守衛:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
