#!/usr/bin/env node
/**
 * 反模式 lint — 把「反覆踩到的雷」做成 CI 靜態檢查，新出現就擋。
 * Check A：closure 參數寫 `_pool`/`_aIdx`/... 但 body 又引用去底線同名 → ReferenceError。
 * Check B：基本能量用 `pokemonType === '屬性'` 比對、無卡名 fallback（基本能量 pokemonType 為 null）。
 * Run: node scripts/anti-pattern-lint.mjs  (exit 0=乾淨 / 1=有違規)
 * 見長期記憶 feedback-basic-energy-pokemontype-null / reference-discard-prize-log。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src/lib/game');
function walk(dir){const o=[];for(const e of readdirSync(dir)){const p=join(dir,e);if(statSync(p).isDirectory())o.push(...walk(p));else if(e.endsWith('.ts'))o.push(p);}return o;}
const files = walk(SRC);
const rel = (f) => f.slice(ROOT.length + 1);
const violations = [];

// ── Check A：_X 參數但 body 引用 X ───────────────────────────────
const UP = ['pool', 'aIdx', 'dIdx', 'state'];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const fnRe = /\(([^()]*)\)\s*(?:=>\s*\{|\{)/g;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    const params = m[1];
    const und = UP.filter((n) => new RegExp(`\\b_${n}\\b`).test(params) && !new RegExp(`(^|[,\\s(])${n}\\b`).test(params));
    if (und.length === 0) continue;
    let i = m.index + m[0].length - 1, depth = 0, end = -1;
    for (let j = i; j < src.length; j++){const c=src[j];if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0){end=j;break;}}}
    if (end < 0) continue;
    const body = src.slice(i + 1, end);
    for (const n of und) {
      const uses = new RegExp(`(?<![.\\w])${n}\\b(?!\\s*:)`).test(body);
      const redecl = new RegExp(`\\([^()]*\\b${n}\\b[^()]*\\)\\s*=>|function\\s+[A-Za-z0-9_]*\\s*\\([^()]*\\b${n}\\b|\\bconst\\s+${n}\\b|\\blet\\s+${n}\\b`).test(body);
      if (uses && !redecl) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push(`[A] ${rel(f)}:${line} — 參數 \`_${n}\` 但 body 引用 \`${n}\`（ReferenceError；closure 改帶 \`${n}\`）`);
      }
    }
  }
}

// ── Check B：基本能量 pokemonType 比對、無 fallback ───────────────
const TYPE_LIT = /'(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless)'/;
const SAFE = /energyMatchesType|isBasicEnergyOfType|ENERGY_NAME_TO_TYPE|name\.includes|name\.match|【|TYPE_TO_TAG/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const norm = lines[i].replace(TYPE_LIT, 'T');
    if (!/\bpokemonType\s*(===|!==)\s*(type\b|typeFilter\b|t\b|filter\b|energyType\b|T)/.test(norm)) continue;
    const ctx = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
    if (!/supertype\s*===\s*'Energy'|\bsubtype\s*===\s*'Basic'/.test(ctx)) continue;
    if (SAFE.test(ctx)) continue;
    violations.push(`[B] ${rel(f)}:${i + 1} — 基本能量用 pokemonType 比對、無卡名 fallback（改 energyMatchesType / isBasicEnergyOfType）`);
  }
}


// ── Check C：對手寶可夢直接加傷未過免疫 guard ─────────────────────
//   偵測「對 defender 寶可夢 .damage += / damage: x.damage + N」卻沒走中央 helper
//   或免疫 guard。目的＝防未來新攻擊/效果卡漏掉 化隱/神秘石居/對戰圓形/太晶 等免疫關卡。
//   合法直改（自傷反彈→攻擊者 aIdx、治癒、道具指示物、effect-KO 走 sanityKOSweep、
//   callsite 已 guard 的共用 helper）會自然略過或可標 `// dmg-direct-ok: 理由`。
//   見長期記憶 reference-central-damage-helper / reference-attack-effect-immunity-sweep。
const C_GUARD = /canApplyEffectToTarget|canApplyAttackEffectToTarget|passiveImmunityDamageBlock|resolveBenchGuard|resolveActiveAttackGuard|isBenchProtected|dealAttackDamageToTarget|fireDefenderOnDamaged|markFaintByEffect|sanityKOSweep|guard\.blocked|_snipeGuard|dmg-direct-ok/;
const C_ADD = /\.damage\s*\+=|damage:\s*[\w.]+\.damage\s*\+\s*[\w(]/;
const C_FUNC_START = /^\s*(regR|regPost|regPre|regA|register[A-Za-z]+|export\s+(async\s+)?function|function\s|[\w$]+\.set\(|\[\s*['"][^'"]+['"]\s*,\s*\()/;
const C_ATTACKER = new Set(['aIdx', 'idx', 'actorIdx', 'attackerIdx']);
function mutatedIdx(lines, i, lo) {
  for (let j = i; j >= Math.max(lo, i - 10); j--) {
    let m;
    if ((m = lines[j].match(/updatePlayer\(\s*[\w.]+\s*,\s*([a-zA-Z0-9_ ()-]+?)\s*,/))) return m[1].trim();
    if ((m = lines[j].match(/players\[\s*([a-zA-Z0-9_ ()-]+?)\s*\]\s*=/))) return m[1].trim();
    if ((m = lines[j].match(/\b(?:const|let)\s+\w+\s*=\s*\{\s*\.\.\.\s*(?:state\.)?players\[\s*([a-zA-Z0-9_ ()-]+?)\s*\]/))) return m[1].trim();
    if ((m = lines[j].match(/i\s*!==\s*([a-zA-Z0-9_ ()-]+?)\s*\?/))) return m[1].trim();
    if ((m = lines[j].match(/\.map\(\(\s*\w+\s*,\s*i\s*\)\s*=>\s*i\s*===\s*([a-zA-Z0-9_ ()-]+?)\b/))) return m[1].trim();
  }
  return null;
}
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!C_ADD.test(lines[i])) continue;
    if (/dmg-direct-ok/.test(lines[i]) || /dmg-direct-ok/.test(lines[i - 1] ?? '')) continue;
    let fs = i;
    for (let j = i; j >= Math.max(0, i - 80); j--) { if (C_FUNC_START.test(lines[j])) { fs = j; break; } }
    const idx = mutatedIdx(lines, i, fs);                       // 限定本函式內向上找被改索引（不跨註冊邊界）
    if (idx && C_ATTACKER.has(idx)) continue;                  // 反彈/自傷→攻擊者側，免 guard
    const isDefender = !!idx && (/\bdIdx\b|\boppIdx\b/.test(idx) || /1\s*-\s*aIdx/.test(idx));
    if (!isDefender) continue;                                  // 索引非明確 defender → 保守不報
    const span = lines.slice(fs, i + 2).join('\n');
    if (C_GUARD.test(span)) continue;                           // 函式內有免疫 guard / 中央 helper
    violations.push(`[C] ${rel(f)}:${i + 1} — 對手寶可夢直接加傷未見免疫 guard（改走 dealAttackDamageToTarget / canApplyEffectToTarget，或標 // dmg-direct-ok: 理由）`);
  }
}


// ── Check D：禁用 9999/99999 假傷害強制昏厥（須改走 markFaintByEffect）─────────
//   「直接昏厥/招式效果KO」要用中央 markFaintByEffect(damage=有效maxHP)，不可把 damage
//   灌成 9999/99999 → KO 被擋時殘留異常傷害值(?/HP 0/0 卡死)。見 reference-faint-handattach-helpers。
const D_FAKE = /damage:\s*9{4,}\b|damage:\s*[\w.]+\.damage\s*\+\s*9{4,}\b/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('//') || t.startsWith('*')) continue;   // 註解不算
    if (/dmg-direct-ok/.test(lines[i])) continue;
    if (D_FAKE.test(lines[i])) {
      violations.push(`[D] ${rel(f)}:${i + 1} — 用 9999/99999 假傷害強制昏厥；改走 markFaintByEffect(inst, pool, state)`);
    }
  }
}

if (violations.length === 0) {
  console.log('反模式 lint：✅ 無違規（A: _pool ReferenceError / B: 基本能量屬性比對 / C: 對手直接加傷漏免疫 guard / D: 9999假傷害KO）');
  process.exit(0);
}
console.log(`反模式 lint：❌ 發現 ${violations.length} 處違規\n`);
for (const v of violations) console.log('  ' + v);
console.log('\n（誤報可在 scripts/anti-pattern-lint.mjs 調整 regex；真違規請修正）');
process.exit(1);
