#!/usr/bin/env node
/**
 * 反模式 lint — 把「反覆踩到的雷」做成 CI 靜態檢查，新出現就擋。
 * Check A：closure 參數寫 `_pool`/`_aIdx`/... 但 body 又引用去底線同名 → ReferenceError。
 * Check B：基本能量用 `pokemonType === '屬性'` 比對、無卡名 fallback（基本能量 pokemonType 為 null）。
 * Check J：讀傷害狀態(中毒/灼傷)只讀 status 主格漏三槽(secondary/tertiary) → 改 hasStatusInAnySlot。
 * Check I：數/丟附加道具只讀 toolAttached 漏 extraTools(多重轉接洛托姆) → 改 getAllAttachedTools。
 * Check H：對手寶可夢非傷害效果(換位/丟能量/丟道具/施狀態)直接 inline mutate 未過免疫 gate → 繞過化隱/純樸。
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


// ── Check E：markFaintByEffect 只能用於「自身」昏厥，對手效果KO須用 koTargetByAttackEffect ──
//   markFaintByEffect(damage=有效maxHP) 是自身昏厥(高速破壞/擊斃自身)用；對對手「使昏厥」要走
//   中央 koTargetByAttackEffect(深淵之瞳式：搬棄牌+recordOppKO+addPendingPrize，不走 damage 管線)。
//   見 reference-effect-ko-central-helper。偵測 markFaintByEffect 包在 defender 索引(dIdx/oppIdx)的更新區。
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/markFaintByEffect\s*\(/.test(lines[i])) continue;
    if (/dmg-direct-ok/.test(lines[i]) || /export function markFaintByEffect/.test(lines[i])) continue;
    let fs = i;
    for (let j = i; j >= Math.max(0, i - 80); j--) { if (C_FUNC_START.test(lines[j])) { fs = j; break; } }
    const idx = mutatedIdx(lines, i, fs);
    const isDefender = !!idx && (/\bdIdx\b|\boppIdx\b/.test(idx) || /1\s*-\s*aIdx/.test(idx));
    if (isDefender) {
      violations.push(`[E] ${rel(f)}:${i + 1} — markFaintByEffect 用於對手(${idx})；對手效果KO須改走 koTargetByAttackEffect(state, aIdx, target, isActive, pool, label)`);
    }
  }
}


// ── Check F：scrubBenchStatus 的 BENCH_ACTION_LOCK_FLAGS 只能含「攻擊/撤退鎖」─────
//   scrubBenchStatus(engine.ts)每個 action 後清備戰寶可夢的這些旗標。它【只能】含
//   「備戰不可能有意義的 active-only 攻擊/撤退鎖」；嚴禁混入：
//     ① 加傷 BUFF(damageBonus*/deferredPrize*)— 備戰特性可合法設、升場才生效(奔流之心，v5.529 血淚)
//     ② 受傷類旗標(immune*/takeExtraDamage*/damageReduce*)— 備戰仍可被狙擊招式打到，語義有效
//   且每個鎖旗標必須也在 clearActiveEffects 清單內(active→bench 一律清，子集不變式)。
//   見 reference-clear-active-effects-central。
{
  const flagsSrc = readFileSync(join(SRC, 'instance-flags.ts'), 'utf8');
  const grab = (name) => {
    const mm = flagsSrc.match(new RegExp(name + '\\s*:\\s*readonly[\\s\\S]*?=\\s*\\[([\\s\\S]*?)\\n\\];'));
    return mm ? [...mm[1].matchAll(/'([a-zA-Z0-9_]+)'/g)].map((x) => x[1]) : [];
  };
  const lockFlags = grab('BENCH_SCRUB_LOCK_FLAGS');
  const caeFields = new Set(grab('CLEAR_ON_EXIT_FLAGS'));
  const LOCK_NAME = /^(cantAttack|cantRetreat|blockedAttackNames|attackFailureFlipCount|pointySpin|attackCostIncrease|retreatCostIncrease|paralyzeFang)/;
  for (const f of lockFlags) {
    if (!LOCK_NAME.test(f)) {
      violations.push(`[F] instance-flags.ts BENCH_SCRUB_LOCK_FLAGS 含非「攻擊/撤退鎖」旗標 \`${f}\`（buff/受傷類旗標備戰仍有意義，不可每 action 清；見 reference-clear-active-effects-central / v5.529 奔流之心）`);
    }
    if (caeFields.size > 0 && !caeFields.has(f)) {
      violations.push(`[F] instance-flags.ts BENCH_SCRUB_LOCK_FLAGS 的 \`${f}\` 不在 CLEAR_ON_EXIT_FLAGS（子集不變式被破壞）`);
    }
  }
}

// ── Check G：從手牌附能的「自方治療」與「對手反應」雙胞胎必須成對 ──────────
//   applyMagearnaHandAttachHeal(瀑機雅娜自動治療,從手牌附能觸發) 與 fireOnHandEnergyAttached
//   (對手附能被動:耕鬼ex侵蝕詛咒/麻痺門牙) 是同一「從手牌附能」事件的雙胞胎反應。
//   任何呼叫前者的 resolver 必須也呼叫後者,否則對手侵蝕詛咒/麻痺門牙漏觸發(v5.662 一次補了7處)。
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    // v5.782：含 _magHeal 別名(= applyMagearnaHandAttachHeal),原只配全名→ inferno/ursaluna 滑過
    if (!/(applyMagearnaHandAttachHeal|_magHeal)\s*\(/.test(lines[i])) continue;
    if (/const _magHeal\s*=/.test(lines[i])) continue; // 別名定義行本身不算
    if (/function applyMagearnaHandAttachHeal/.test(lines[i])) continue;
    if (/dmg-direct-ok|handattach-heal-only-ok/.test(lines[i])) continue;
    let fs = i;
    for (let j = i; j >= Math.max(0, i - 80); j--) { if (C_FUNC_START.test(lines[j])) { fs = j; break; } }
    let depth = 0, end = lines.length, started = false;
    for (let j = fs; j < Math.min(lines.length, fs + 120); j++) {
      for (const ch of lines[j]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') { depth--; } }
      if (started && depth <= 0) { end = j; break; }
    }
    const span = lines.slice(fs, end + 1).join('\n');
    if (!/fireOnHandEnergyAttached/.test(span)) {
      violations.push(`[G] ${rel(f)}:${i + 1} — 呼叫 applyMagearnaHandAttachHeal(從手牌附能)卻未見 fireOnHandEnergyAttached（對手侵蝕詛咒/麻痺門牙會漏觸發；用 fireOnHandEnergyAttached(applyMagearnaHandAttachHeal(...), idx, targetIid, pool) 包一層，或標 // handattach-heal-only-ok: 理由）`);
    }
  }
}


// ── Check H：對手寶可夢「非傷害效果」施加未過免疫 gate ──────────────────
//   換位 / 丟能量 / 丟道具 / 施狀態 直接改動對手(dIdx/oppIdx)寶可夢,卻沒走
//   canApplyEffectToTarget 或中央 gated helper → 繞過 化隱/純樸/光之翼。
//   防未來新卡(M6+)inline 翻牆。合法豁免標 // opp-mut-ok: 理由。
//   見長期記憶 reference-opp-swap-hidden-immunity-gate / reference-discard-opp-energy-tool-hidden-immunity。
const H_MUT = [
  ['換位(active賦值)', /(?<![=!<>])\.active\s*=(?!=)/],
  ['對手備戰增減',     /\.bench\.(?:push|splice|unshift)\s*\(/],
  ['丟能量',           /\.energyAttached\s*=(?!=)|\.energyAttached\.splice\s*\(/],
  ['丟道具',           /\.(?:toolAttached|extraTools)\s*=(?!=)/],
  ['施狀態',           /\.(?:status|secondaryStatus|tertiaryStatus)\s*=(?!=)/],
];
const H_GUARD = /canApplyEffectToTarget|canApplyAttackEffectToTarget|oppPokemonImmuneToAttackEffect|forceOppSwap|oppSwapDmgPost|applyStatusToOppActive|applyDamageToAllOpp|dealAttackDamageToTarget|koTargetByAttackEffect|clearActiveEffects|toBareCard|isImmuneToOppSupporter|resolveBenchGuard|_gustImmune|opp-mut-ok/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;  // 純註解行
    const code = lines[i].replace(/\/\/.*$/, '');                                  // 剝行內註解
    const hit = H_MUT.find(([, re]) => re.test(code));
    if (!hit) continue;
    if (/opp-mut-ok/.test(lines[i]) || /opp-mut-ok/.test(lines[i - 1] ?? '')) continue;
    let fs = i;
    for (let j = i; j >= Math.max(0, i - 100); j--) { if (C_FUNC_START.test(lines[j])) { fs = j; break; } }
    const idx = mutatedIdx(lines, i, fs);
    if (!idx) continue;                       // 找不到明確被改 index → 保守不報
    if (C_ATTACKER.has(idx)) continue;        // 自己側,免 gate
    const isDefender = /\bdIdx\b|\boppIdx\b/.test(idx) || /1\s*-\s*aIdx/.test(idx);
    if (!isDefender) continue;
    const span = lines.slice(fs, i + 2).join('\n');
    if (H_GUARD.test(span)) continue;
    violations.push(`[H] ${rel(f)}:${i + 1} — 對手寶可夢${hit[0]}未見免疫 gate（改走 canApplyEffectToTarget/中央 gated helper,或標 // opp-mut-ok: 理由）`);
  }
}


// ── Check I：數/丟「附加道具」只讀 toolAttached 漏 extraTools（多重轉接洛托姆）────────
//   卡面「道具數量」「丟棄全部道具」若只讀 toolAttached,會漏 extraTools(洛托姆ex 多重轉接第2張以上)。
//   中央 getAllAttachedTools(inst) = toolAttached + extraTools。boolean「是否有道具」讀 toolAttached 合法。
//   只報「push 進棄牌陣列」與「count++ 計數」context,且該函式塊內無 getAllAttachedTools/extraTools。
//   合法豁免標 // extratools-ok: 理由。見長期記憶 reference-tool-count-extratools。
const I_HIT = [
  /\.push\(\s*\{?\s*\.\.\.[\w.]+\.toolAttached/,   // discardArr.push({ ...x.toolAttached ... })
  /\.push\(\s*[\w.]+\.toolAttached\s*\)/,          // discardArr.push(x.toolAttached)
  /discard:\s*\[[^\]]*\.toolAttached/,             // discard: [...p.discard, x.toolAttached]
  /if\s*\(\s*[\w.]+\.toolAttached\s*\)\s*(?:\{\s*)?\w*count/, // if (x.toolAttached) count++
];
const I_FUNC_START = /^\s*(regR|regPost|regPre|regA|register[A-Za-z]+|export\s+(async\s+)?function|function\s|[\w$]+\.set\(|[\w$]+\s*=\s*\(|\[\s*['"][^'"]+['"]\s*,\s*\()/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tt = lines[i].trimStart();
    if (tt.startsWith('//') || tt.startsWith('*') || tt.startsWith('/*')) continue;
    const code = lines[i].replace(/\/\/.*$/, '');
    if (!I_HIT.some(re => re.test(code))) continue;
    if (/extratools-ok/.test(lines[i]) || /extratools-ok/.test(lines[i - 1] ?? '')) continue;
    let fs = i;
    for (let j = i; j >= Math.max(0, i - 60); j--) { if (I_FUNC_START.test(lines[j])) { fs = j; break; } }
    let end = Math.min(lines.length, fs + 120);
    const span = lines.slice(fs, end).join('\n');
    if (/getAllAttachedTools|extraTools/.test(span)) continue;  // 塊內已處理 extraTools
    violations.push(`[I] ${rel(f)}:${i + 1} — 數/丟附加道具只讀 toolAttached 漏 extraTools（改走 getAllAttachedTools,或標 // extratools-ok: 理由）`);
  }
}


// ── Check J：讀「傷害狀態」(中毒/灼傷)只讀 status 主格漏三槽 ────────────────────
//   三槽制(v5.295):行動狀態(睡眠/混亂/麻痺)恆在 status 主格,但傷害狀態(poisoned/burned)
//   可落在 status/secondaryStatus/tertiaryStatus 任一槽。條件式只讀 .status==='poisoned'/'burned'
//   會漏另兩槽(如睡眠+灼傷時灼傷在 secondary)。改走中央 hasStatusInAnySlot(inst, cond)。
//   checkup 依實際所在格清除等合法主格讀取標 // status-slot-ok。見長期記憶 reference-defender-status-three-slot-read。
const J_HIT = /\.status\s*===?\s*'(poisoned|burned)'|\.status\s*!==?\s*'(poisoned|burned)'/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tt = lines[i].trimStart();
    if (tt.startsWith('//') || tt.startsWith('*') || tt.startsWith('/*')) continue;
    const code = lines[i].replace(/\/\/.*$/, '');
    if (!J_HIT.test(code)) continue;
    if (/status-slot-ok/.test(lines[i]) || /status-slot-ok/.test(lines[i - 1] ?? '')) continue;
    // 窗 [i-1, i+3]：若鄰近有 secondaryStatus/tertiaryStatus(手寫三槽)或 hasStatusInAnySlot(中央)→ 視為已跨槽
    const win = lines.slice(Math.max(0, i - 1), i + 4).join('\n');
    if (/secondaryStatus|tertiaryStatus|hasStatusInAnySlot/.test(win)) continue;
    violations.push(`[J] ${rel(f)}:${i + 1} — 讀傷害狀態(中毒/灼傷)只讀 status 主格漏三槽（改走 hasStatusInAnySlot,或標 // status-slot-ok: 理由）`);
  }
}

// ── Check K：清除狀態時清 secondaryStatus 卻漏 tertiaryStatus（寫入端三槽）─────
//   三槽制(v5.295):清除特殊狀態一律清三槽(status+secondaryStatus+tertiaryStatus)。
//   反覆踩(v5.728姐姐治療/v5.855 scrubBench/v5.856泡沫水·命運擺弄):只清
//   status+secondaryStatus 漏 tertiary → 第三槽狀態殘留。Check J 守讀取端,Check K 守寫入端。
//   見長期記憶 reference-demote-clear-status-swap。合法只清雙槽者標 // status-slot-ok: 理由。
const K_SEC = /secondaryStatus:\s*undefined|delete\s+[\w.]+\.secondaryStatus/;
const K_TERT = /tertiaryStatus:\s*undefined|delete\s+[\w.]+\.tertiaryStatus/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tt = lines[i].trimStart();
    if (tt.startsWith('//') || tt.startsWith('*') || tt.startsWith('/*')) continue;
    const code = lines[i].replace(/\/\/.*$/, '');
    if (!K_SEC.test(code)) continue;
    if (/status-slot-ok/.test(lines[i]) || /status-slot-ok/.test(lines[i - 1] ?? '')) continue;
    const win = lines.slice(Math.max(0, i - 8), i + 9).join('\n');
    if (K_TERT.test(win)) continue;
    violations.push(`[K] ${rel(f)}:${i + 1} — 清狀態清了 secondaryStatus 卻漏 tertiaryStatus（三槽制須一併清第三槽,或標 // status-slot-ok: 理由）`);
  }
}

// ── Check L：有偏洗牌 .sort(() => Math.random()) — 非均勻,牌庫順序可被利用 ────────
//   PTCG 牌庫重洗須「均勻隨機」(Fisher-Yates)。`.sort(隨機比較器)` 是已知有偏洗牌
//   (V8 TimSort 對隨機比較器產生非均勻排列),牌庫順序偏差可被利用,違反競技公平。
//   一律走中央 shuffle()(_shared.ts,Fisher-Yates)。合法例外標 // shuffle-ok: 理由。
//   v5.864 首跑抓 23 處(m5_preview 17/six_decks 5/v2540 1)全收斂 shuffle()。
const L_BIAS = /\.sort\([^;\n]*Math\.random/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tt = lines[i].trimStart();
    if (tt.startsWith('//') || tt.startsWith('*') || tt.startsWith('/*')) continue;
    if (!L_BIAS.test(lines[i])) continue;
    if (/shuffle-ok/.test(lines[i]) || /shuffle-ok/.test(lines[i - 1] ?? '')) continue;
    violations.push(`[L] ${rel(f)}:${i + 1} — 有偏洗牌 .sort(()=>Math.random)(非均勻,牌庫順序可利用）→ 改走中央 shuffle()(Fisher-Yates),或標 // shuffle-ok: 理由`);
  }
}

// ── Check M：reg/regG/regA/regR/regPre/regPost 用空字串 key ─────────────────────
//   reg 系列以卡名/招式名為 key 註冊到 Map；空字串 '' 是死碼(TRAINER_GUARDS.get(卡名) 永遠
//   拿不到)，且多個空 key 互相覆蓋 → 該卡靜默失去 guard/handler。v5.870 首跑抓 5 處 regG('')
//   (訂購盒/招式學習器機/派帕/吹火人/赤松 漏填卡名 → 牌庫空仍可用)。合法例外標 // empty-reg-ok。
const M_EMPTY_REGKEY = /\b(reg|regG|regA|regR|regPre|regPost)\(\s*(''|"")\s*,/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tt = lines[i].trimStart();
    if (tt.startsWith('//') || tt.startsWith('*') || tt.startsWith('/*')) continue;
    if (!M_EMPTY_REGKEY.test(lines[i])) continue;
    if (/empty-reg-ok/.test(lines[i]) || /empty-reg-ok/.test(lines[i - 1] ?? '')) continue;
    violations.push(`[M] ${rel(f)}:${i + 1} — reg 系列空字串 key(死碼,該卡靜默失去 guard/handler）→ 補正確卡名/招式名，或標 // empty-reg-ok: 理由`);
  }
}

// ── Check N：withPending 用的 effectKey 沒有對應 resolver（死 effectKey）─────────────
//   picker 開了但 RESOLVE_SELECTION 查不到 resolver → 選完靜默無效果(氣味偵測/警備濁霧 v5.881)。
//   收集 regR('k')/regR(CONST)/RESOLVERS.set(...) 註冊的 key(含常數解析) vs effectKey:'k'/CONST 使用。
//   m5-retry-badge-decide 是 engine RESOLVE_SELECTION inline 特判(非 regR) → 白名單。
{
  const allsrc = files.map(f => readFileSync(f, 'utf8')).join('\n');
  const constMap = {};
  for (const mm of allsrc.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g)) constMap[mm[1]] = mm[2];
  const registered = new Set();
  for (const mm of allsrc.matchAll(/(?:regR|RESOLVERS\.set)\(\s*['"]([^'"]+)['"]/g)) registered.add(mm[1]);
  for (const mm of allsrc.matchAll(/(?:regR|RESOLVERS\.set)\(\s*([A-Za-z_$][\w$]*)\s*,/g)) { if (constMap[mm[1]]) registered.add(constMap[mm[1]]); }
  const INLINE_OK = new Set(['m5-retry-badge-decide']);
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const tt = lines[i].trimStart();
      if (tt.startsWith('//') || tt.startsWith('*') || tt.startsWith('/*')) continue;
      if (/effectkey-inline-ok/.test(lines[i]) || /effectkey-inline-ok/.test(lines[i - 1] ?? '')) continue;
      let key = null;
      let m1 = lines[i].match(/effectKey:\s*['"]([^'"]+)['"]/);
      if (m1) key = m1[1];
      else { const m2 = lines[i].match(/effectKey:\s*([A-Za-z_$][\w$]*)\b/); if (m2 && constMap[m2[1]]) key = constMap[m2[1]]; }
      if (!key || INLINE_OK.has(key)) continue;
      if (!registered.has(key)) violations.push(`[N] ${rel(f)}:${i + 1} — effectKey '${key}' 無對應 resolver(死 key,picker 選完無效果）→ 用有註冊 regR/RESOLVERS.set 的 key，或標 // effectkey-inline-ok: 理由`);
    }
  }
}

if (violations.length === 0) {
  console.log('反模式 lint：✅ 無違規（A: _pool ReferenceError / B: 基本能量屬性比對 / C: 對手直接加傷漏免疫 guard / D: 9999假傷害KO / E: markFaint用於對手 / F: scrub鎖清單純度 / G: 從手牌附能治療漏對手反應 / H: 對手非傷害效果 inline 漏免疫 gate / I: 數丟道具漏 extraTools / J: 讀傷害狀態漏三槽 / K: 清狀態漏三槽(寫入端) / L: 有偏洗牌.sort(Math.random)→中央shuffle / M: reg空字串key死碼 / N: withPending死effectKey無resolver）');
  process.exit(0);
}
console.log(`反模式 lint：❌ 發現 ${violations.length} 處違規\n`);
for (const v of violations) console.log('  ' + v);
console.log('\n（誤報可在 scripts/anti-pattern-lint.mjs 調整 regex；真違規請修正）');
process.exit(1);
