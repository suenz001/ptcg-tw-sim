#!/usr/bin/env node
/**
 * 反模式 lint — 把「反覆踩到的雷」做成 CI 靜態檢查，新出現就擋。
 * Check A：closure 參數寫 `_pool`/`_aIdx`/... 但 body 又引用去底線同名 → ReferenceError。
 * Check B：基本能量用 `pokemonType === '屬性'` 比對、無卡名 fallback（基本能量 pokemonType 為 null）。
 * Check J：讀傷害狀態(中毒/灼傷)只讀 status 主格漏三槽(secondary/tertiary) → 改 hasStatusInAnySlot。
 * Check I：數/丟附加道具只讀 toolAttached 漏 extraTools(多重轉接洛托姆) → 改 getAllAttachedTools。
 * Check H：對手寶可夢非傷害效果(換位/丟能量/丟道具/施狀態)直接 inline mutate 未過免疫 gate → 繞過化隱/純樸。
 * Check U：對手 active 上寫「跨回合 debuff 旗標」(下回合無法攻擊/延遲丟棄/延遲KO…)未過免疫 gate。
 *          ⭐Check H 只認得 5 種改動樣態(換位/備戰/能量/道具/狀態三槽)，**寫自訂旗標不在其中** →
 *          整整一類招式從免疫檢查底下溜過去(v6.046 一次掃出 11 張卡，含玩家回報的迷唇姐｜強烈之吻)。
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
const sepChar = join('a','b').includes('\\') ? '\\' : '/';
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


// ── Check O：底層模組反向 import 卡檔（module-init 循環 TDZ 防護，v5.989 事故）──────
//   engine.ts 曾反向 import 卡檔 v3080 → 循環相依 → rollup 模組初始化 TDZ → 對戰頁白屏。
//   node 測試 + deploy 綠 皆抓不到(vite build 只打包不執行)。凍結現況「symbol 層級」白名單：
//   底層模組(engine/effects/defense/_shared/types/instance-flags)新增反向 edge、或既有 edge
//   新增白名單外 symbol → FAIL。修法:helper 下沉 _shared/leaf,讓卡檔與 engine 都 import 它。
//   白名單只准縮不准擴。見 feedback-build-fail-debug-lessons ⑧。
{
  const LOW = new Set([
    'src/lib/game/engine.ts', 'src/lib/game/effects.ts', 'src/lib/game/defense.ts',
    'src/lib/game/effects/_shared.ts', 'src/lib/game/types.ts', 'src/lib/game/instance-flags.ts',
  ]);
  const WL = {
  "defense.ts→v3001_g3_wave3": [
    "hasAnyEffectiveAbility",
    "isAbilityHolderEffective"
  ],
  "effects.ts→stadiums": [
    "BENCH_PROTECTION_STADIUMS",
    "JAMMING_TOWER_STADIUMS",
    "PASSIVE_STADIUMS",
    "ROCKET_WATCHTOWER_STADIUMS"
  ],
  "effects.ts→tools": [
    // v6.072：訂製背心用的新 map。與同 edge 既有 12 個 TOOL_* 完全同家族
    //   （都是 tools.ts 的 side-effect registry，engine 從 effects re-export 取用），
    //   不是新的反向 edge、也不是新的相依方向 → 屬白名單內既有結構的延伸。
    "TOOL_DEFENSE_REDUCE_BY_ATTACKER_CARD",
    "TOOL_ATTACH_GATE",
    "TOOL_ATTACK_BONUS",
    "TOOL_BOTH_SIDES_RETREAT_PLUS",
    "TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY",
    "TOOL_DEFENSE_REDUCE_BY_TYPE",
    "TOOL_END_TURN_DISCARD",
    "TOOL_HP_BONUS",
    "TOOL_ON_DAMAGED",
    "TOOL_ON_KO",
    "TOOL_PREVENT_KO",
    "TOOL_PRIZE_BONUS",
    "TOOL_RETREAT_MOD"
  ],
  "effects.ts→v158_energy_chain": [
    "startEnergyChain"
  ],
  "effects.ts→v2998_g2": [
    "desertDragonflyOnKo"
  ],
  "effects.ts→v2999_g3_wave1": [
    "bronzongShelterReduce",
    "curlWallReduce",
    "gearCoatingReduce",
    "hasIronTracksDualCore",
    "registerV2999G3W1Passives",
    "steelixPalaceReduce"
  ],
  "effects.ts→v3000_g3_wave2": [
    "applyMagearnaHandAttachHeal",
    "canRelicanthDiverCatchTrigger",
    "hasBugAegislashShield",
    "isBasicWaterEnergy",
    "registerV3000G3W2Passives"
  ],
  "effects.ts→v3001_g3_wave3": [
    "hasAnyEffectiveAbility",
    "hasEffectiveKageHide",
    "isAbilityHolderEffective",
    "isAbilityNullifiedByPassive",
    "isInitializeNullified",
    "isOppEvilEyeBlocking",
    "registerV3001G3W3Passives"
  ],
  "effects.ts→v3050_deferred_wave_a": [
    "registerV3050DeferredWaveA"
  ],
  "effects.ts→v3060_deferred_wave_b": [
    "attackerHasSpecialEnergy",
    "getBenchImmunityAbilityName",
    "hasBenchAttackImmunityAbility",
    "isImmuneToOppTrainer",
    "registerV3060DeferredWaveBPassives"
  ],
  "effects.ts→v3070_deferred_wave_d": [
    "klingerAbility_EmergencyRotate",
    // v6.080 M6 烈箭鷹ex｜激動俯衝 —— 與 klingerAbility_EmergencyRotate 同檔同型（手牌→備戰），
    //   兩者都是 ON_HAND_ACTIVATE_ABILITIES 的 value fn，不在模組初始化期被呼叫（TDZ 安全）。
    "talonflameExAbility_ExcitingDive",
    "registerV3070DeferredWaveD",
    "supercatExpAbility_LureTail",
    "volcaronaAbility_HeatScale"
  ],
  "effects.ts→v3080_deferred_wave_c": [
    "isImmuneToOppSupporter",
    "isReturnToHandBlockedByCalmGround",
    "registerV3080DeferredWaveC"
  ],
  "effects.ts→v3210_ordiga": [
    "registerV3210Ordiga"
  ],
  "engine.ts→v2999_g3_wave1": [
    "bronzongShelterReduce",
    "curlWallReduce",
    "gearCoatingReduce",
    "steelixPalaceReduce"
  ],
  "engine.ts→v3000_g3_wave2": [
    "FIRST_TURN_USABLE_ATTACKS",
    "canRelicanthDiverCatchTrigger",
    "canTogekissMiracleKissTrigger",
    "hasMeloettaExDebut",
    "isBasicWaterEnergy",
    "magearnaAutoHealAmount",
    "magmarFlowingBurnBonus"
  ],
  "engine.ts→v3001_g3_wave3": [
    "hasAnyEffectiveAbility",
    "getOppRetreatTriggers",
    "hasAbilityOnActive",
    "hasEffectiveCalmGroundOnSide",
    "hasEffectiveKageHide",
    "hasRocketAmpharosDarkPulse",
    "hasRocketTyranitarSandstorm",
    "isAbilityHolderEffective",
    "isAbilityNullifiedByPassive",
    "isInitializeNullified",
    "isOppEvilEyeBlocking",
    "isOppItemPlayBlocked",
    "isOppStadiumPlayBlocked",
    "isReturnToHandBlockedByCalmGround"
  ],
  "engine.ts→v3050_deferred_wave_a": [
    "askUseRetreatToBenchAbility"
  ],
  "engine.ts→v3070_deferred_wave_d": [
    "findFieldPokemonByName",
    "hasFieldPokemonByName",
    "oppHasStage2"
  ],
  "engine.ts→v3080_deferred_wave_c": [
    "getAttacksFromEvolvedFromStack",
    "hasArchaeoglobinDiveMemory"
  ]
};
  const resolveSpec = (fileRel, spec) => {
    if (!spec.startsWith('.')) return spec;
    const out = fileRel.split('/').slice(0, -1);
    for (const seg of spec.split('/')) { if (seg === '.' || seg === '') continue; if (seg === '..') out.pop(); else out.push(seg); }
    return out.join('/');
  };
  const base = (p) => p.split('/').pop();
  const blockRe = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  for (const f of files) {
    const r = f.slice(ROOT.length).replace(/^[/\\]+/, '').split(sepChar).join('/');
    if (!LOW.has(r)) continue;
    const src = readFileSync(f, 'utf8');
    let m;
    blockRe.lastIndex = 0;
    while ((m = blockRe.exec(src)) !== null) {
      if (/^\s*(import|export)\s+type\s/.test(m[0])) continue;
      const resolved = resolveSpec(r, m[2]);
      if (!resolved.includes('/effects/cards/')) continue;
      const key = base(r) + '\u2192' + base(resolved);
      const allowed = WL[key];
      if (!allowed) { violations.push([r, `[O] 底層模組新增對卡檔的反向 import (edge 不在白名單): from '${m[2]}' — helper 應下沉 _shared/leaf,禁止底層 import 卡檔`]); continue; }
      for (const raw of m[1].split(',')) {
        let s = raw.trim(); if (!s || s.startsWith('type ')) continue;
        s = s.split(/\s+as\s+/)[0].trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(s)) continue;
        if (!allowed.includes(s)) violations.push([r, `[O] 既有反向 edge 新增白名單外 symbol '${s}' (from '${m[2]}') — 恐致 module-init 循環 TDZ;把 helper 下沉 leaf 或改從既有安全 import`]);
      }
    }
  }
  // leaf 純度鎖
  for (const leaf of ['src/lib/game/effects/_shared.ts', 'src/lib/game/types.ts', 'src/lib/game/instance-flags.ts', 'src/lib/game/selection-filter.ts']) {
    const lf = files.find((x) => x.slice(ROOT.length).replace(/^[/\\]+/, '').split(sepChar).join('/') === leaf);
    if (!lf) continue;
    for (const line of readFileSync(lf, 'utf8').split('\n')) {
      if (/^\s*(import|export)\s+type\s/.test(line)) continue;
      if (/(import|export)\b[^\n]*from\s+['"]\.\.?\/(effects|engine)/.test(line)) violations.push([leaf, `[O] leaf 模組不得 import ./effects 或 ./engine(保持 leaf 純度): ${line.trim().slice(0, 80)}`]);
    }
  }
}

// ── Check P：opp-bench-choose / opp-poke-choose 的 pending 帶 filter: 欄 ──────────
//   UI(game/+page.svelte)與 AI 的 opp-bench/poke-choose picker 只認 params.validIids，
//   會「忽略」pending 的 filter 欄 → filter:'ex'/'Basic' 形同虛設（可選非法目標）。
//   v5.996 閃電急襲(限ex)/嗡嗡榍石(限基礎)踩此雷。一律改用 params.validIids 過濾。
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /type:\s*'opp-(?:bench|poke)-choose'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const rest = src.slice(m.index, m.index + 500);
    const end = rest.indexOf('})');
    const blk = end >= 0 ? rest.slice(0, end) : rest;
    if (/\bfilter:/.test(blk)) {
      const line = src.slice(0, m.index).split('\n').length;
      violations.push(`[P] ${rel(f)}:${line} — opp-bench/poke-choose pending 帶 filter: 欄（UI/AI 忽略，只認 validIids）→ 改用 params.validIids 過濾`);
    }
  }
}


// ── Check Q：regR resolver 用 client selectedIids「保序 map」重建牌庫頂，未 re-validate ─────
//   引擎 RESOLVE_SELECTION 不驗 client selectedIids 的 min/max/重複/filter → resolver 若用
//   `iids.map(iid => deck.find(...))`(保序)重建 `deck: [...]` 而不去重/夾上限,惡意 client 可傳整副
//   牌庫→疊牌不重洗、傳重複→複製卡(v6.009 暗碼迷)。安全做法:先 `[...new Set(iids)].slice(0,N)`。
//   合法者(順序來自伺服器可信來源、或已別處驗)加 `// revalidate-ok: 理由`。
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /regR\(\s*'([^']+)'\s*,\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const iidsParam = (m[2].split(',')[2] || '').trim();       // (st, idx, iids, params, pool)
    if (!/^[\w$]+$/.test(iidsParam)) continue;
    const body = src.slice(m.index, m.index + 3000);
    const bodyEnd = body.indexOf('\n});');
    const blk = bodyEnd >= 0 ? body.slice(0, bodyEnd) : body;
    const orderMap = new RegExp(iidsParam + '\\b[^;\\n]{0,40}\\.map\\(').test(blk);  // iids.map( / (iids ?? []).map(
    const rebuildsDeck = /deck:\s*\[/.test(blk);                 // 重建牌庫陣列(順序注入面)
    if (!(orderMap && rebuildsDeck)) continue;
    if (/revalidate-ok/.test(blk)) continue;
    if (new RegExp('new Set\\(\\s*\\(?\\s*' + iidsParam).test(blk)) continue;  // 已去重
    if (new RegExp('\\[\\s*\\.\\.\\.\\s*new Set[\\s\\S]{0,60}' + iidsParam + '[\\s\\S]{0,60}\\.slice\\(0').test(blk)) continue; // 已對 iids 去重+夾上限
    const line = src.slice(0, m.index).split('\n').length;
    violations.push(`[Q] ${rel(f)}:${line} — regR '${m[1]}' 用 client selectedIids 保序 map 重建牌庫頂未去重/夾上限（引擎不驗 min/max/重複 → 疊牌/複製卡）→ 先 [...new Set(iids)].slice(0,N)，或標 // revalidate-ok: 理由`);
  }
}


// ── Check R：對戰 UI(+page.svelte/MobilePortraitBattle) 與 AI 判「基本能量屬性」直讀 pokemonType ──
//   現役 68 張基本能量卡 pokemonType 全 null，屬性要從卡名【X】推。DistinctTypes/能量去重 filter 若
//   直讀 card.pokemonType → 全被濾掉、玩家「選不了基礎能量」(v6.008 稜鏡充能)。改用 getBasicEnergyType。
//   ⚠anti-pattern-lint 主體只掃 src/lib/game，UI 在 src/routes → 本 check 額外納入兩個對戰 svelte 檔。
{
  const R_EXTRA = ['src/routes/game/+page.svelte', 'src/routes/game/MobilePortraitBattle.svelte'].map(p => join(ROOT, p));
  const R_SAFE = /getBasicEnergyType|isBasicEnergyOfType|energyMatchesType|name\.includes|name\.match|【/;
  for (const f of [...files.filter(x => /ai\.ts$/.test(x)), ...R_EXTRA]) {
    let lines;
    try { lines = readFileSync(f, 'utf8').split('\n'); } catch { continue; }
    for (let i = 0; i < lines.length; i++) {
      // pokemonType 被加進「屬性集合」或用於能量去重/DistinctTypes 情境
      if (!/pokemonType/.test(lines[i])) continue;
      if (!/(Types?\.add\(|seenTypes|pickedTypes|DistinctTypes|distinctType)/.test(lines[i]) &&
          !/(Types?\.add\(|seenTypes|pickedTypes|DistinctTypes|distinctType)/.test(lines.slice(Math.max(0,i-3), i+1).join('\n'))) continue;
      const ctx = lines.slice(Math.max(0, i - 5), i + 3).join('\n');
      if (R_SAFE.test(ctx)) continue;   // 已用卡名推導
      violations.push(`[R] ${rel(f)}:${i + 1} — 判基本能量屬性直讀 pokemonType（恒 null → 選不到）→ 改用 getBasicEnergyType（卡名【X】推）`);
    }
  }
}


// ── Check S：effects 端三 zone(deck-search/hand-discard/discard-search)的 filter 字面量必須被中央
//   selection-filter evaluator 收錄，或在凍結白名單（P1-1 收尾：防新卡用未收錄 filter 掉 fallthrough）──
{
  const sfSrc = readFileSync(join(SRC, 'selection-filter.ts'), 'utf8');
  const knownExact = new Set([...sfSrc.matchAll(/^\s*'([^']+)':\s*\(/gm)].map((m) => m[1]));
  const knownPrefix = [...new Set([...sfSrc.matchAll(/\.startsWith\('([^']+)'\)/g)].map((m) => m[1]))];
  // v6.019 凍結白名單（dump 現況 deck-search 未收錄的 fallthrough filter；只准縮不准擴）
  const S_WL_EXACT = new Set(['Basic:SameName','Basic:TOP5','BasicMetalEnergy:TOP4','BasicPokemon','DarknessPokemon:TOP7','EvilAwakening:EvolveFrom','Evolution','EvolutionPokemon','FirePokemonOrBasicFireEnergy','GrassBasicOrGrassEnergy:TOP7','GrassPokemonOrStadium','RakiPokemonOrFireEnergy','Stage1Or2:Metal','SturdyMightTree:Stage1','SturdyMightTree:Stage2','Supporter:TOP4','Supporter:TOP6','Supporter:TOP7','TOP2','TOP4','TOP6','TOP8','Trainer:Supporter','Trainer:TOP_N','any']);
  // v6.027：'Basic:NamePrefix=' / 'Card:' / 'NameContains:' 已收進中央 selection-filter → 移出白名單
  //   （白名單只准縮不准擴）。剩餘前綴型 fallthrough：無。
  const S_WL_PREFIX = [];
  const sCovered = (fl) => knownExact.has(fl) || knownPrefix.some((p) => fl.startsWith(p)) || S_WL_EXACT.has(fl) || S_WL_PREFIX.some((p) => fl.startsWith(p));
  const sZoneRe = /type:\s*'(deck-search|hand-discard|discard-search)'[\s\S]{0,600}?filter:\s*'([^']+)'/g;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    let m;
    while ((m = sZoneRe.exec(src)) !== null) {
      const fl = m[2];
      if (!sCovered(fl)) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push(`[S] ${rel(f)}:${line} — pending filter '${fl}'(${m[1]}) 未被中央 selection-filter 收錄、也不在凍結白名單 → 會掉 inline fallthrough。請把 predicate 收進 selection-filter.ts，或（明示沿用 inline fallthrough）加進 Check S 白名單`);
      }
    }
  }
}


// ── Check T：開 picker 前的公開 addLog 不得帶「候選 N 張 / 發現 N 張」隱藏 zone 統計（資訊洩漏，P1 收尾）──
//   picker UI 本就顯示候選卡，log 帶數量純冗餘、且把隱藏 zone（自己手牌/牌庫）構成洩漏給對手。全禁。
//   G 標批（v2996_g4 / v2998_g2，不維護，鐵律）整檔豁免。
for (const f of files) {
  const relf = rel(f);
  if (/v2996_g4|v2998_g2/.test(relf)) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/(候選|發現) \$\{/.test(lines[i])) {
      violations.push(`[T] ${relf}:${i + 1} — picker log 帶「候選/發現 N 張」會把隱藏 zone(手牌/牌庫)統計洩漏給對手(資訊洩漏)→ 刪除該數量片段(picker UI 已顯示候選卡，log 冗餘)`);
    }
  }
}


// ── Check V：對戰圓形競技場 counterPlacement 表態守衛（v6.029，凍結白名單，比照 Check S）──
//   背景（v6.028）：【對戰圓形競技場】卡面只擋「備戰被**放置傷害指示物**」，舊實作卻擋掉所有
//   attack-effect / ability-effect，誤擋了換位／退化／丟道具／bounce／效果 KO 等十餘種效果
//   （玩家回報：場上有對戰圓形時鐵掌力士抓不到對手備戰）。
//   修法是在 canApplyEffectToTarget 加 counterPlacement 旗標，**未傳＝保守照擋（fail-closed）**。
//   本 Check 的用途：**新增**的呼叫點一律要顯式表態，避免日後新卡漏標而被靜默誤擋。
//   既有未表態站點（全部經 Fable audit 確認 target 為對手戰鬥位、走不到 stadium 分支＝零影響）
//   以「檔案層級凍結白名單」放行——白名單只准縮不准擴。
{
  const V_FROZEN_FILES = new Set([
  'effects.ts',
  'effects/cards/m5_preview.ts',
  'effects/cards/maroon_dragon_deck.ts',
  'effects/cards/six_decks.ts',
  'effects/cards/v155_attacks.ts',
  'effects/cards/v2352_j_mark_batch.ts',
  'effects/cards/v2354_j_mark_batch.ts',
  'effects/cards/v2370_new_decks_batch.ts',
  'effects/cards/v2401_i_wave2_draw_swap_search.ts',
  'effects/cards/v2670_i_wave17_complex2.ts',
  'effects/cards/v2750_h_wave2_full.ts',
  'effects/cards/v2995_g4_wave1.ts',
  'effects/cards/v2998_g2.ts',
  'engine.ts',
]);
  // 與 lint 其他 Check 一致：先移除註解與字串，避免 JSDoc 範例碼誤判
  const vStrip = (src) => {
    let out = '', st = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i], n2 = src[i + 1] || '';
      if (st === 0) {
        if (c === '/' && n2 === '/') { st = 1; out += '  '; i++; continue; }
        if (c === '/' && n2 === '*') { st = 2; out += '  '; i++; continue; }
        if (c === "'") st = 3; else if (c === '"') st = 4; else if (c === '`') st = 5;
        out += c; continue;
      }
      if (st === 1) { if (c === '\n') { st = 0; out += '\n'; } else out += ' '; continue; }
      if (st === 2) { if (c === '*' && n2 === '/') { st = 0; out += '  '; i++; continue; } out += (c === '\n' ? '\n' : ' '); continue; }
      if (c === '\\') { out += c + (src[i + 1] || ''); i++; continue; }
      if ((st === 3 && c === "'") || (st === 4 && c === '"') || (st === 5 && c === '`')) st = 0;
      out += c;
    }
    return out;
  };
  for (const f of files) {
    // ⚠不用既有的 rel()：ROOT 結尾帶斜線導致它會多切一個字元（訊息路徑會少字母）。
    //   這裡自己算「src/lib/game/ 之後」的穩定相對路徑當白名單 key。
    const fSlash = f.replace(/\\/g, '/');
    const relf = fSlash.slice(fSlash.lastIndexOf('/src/lib/game/') + '/src/lib/game/'.length);
    if (V_FROZEN_FILES.has(relf)) continue;                  // 既有站點所在檔（凍結）
    const src = vStrip(readFileSync(f, 'utf8'));
    const re2 = /canApplyEffectToTarget\s*\(/g;
    let m;
    while ((m = re2.exec(src)) !== null) {
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 40), m.index))) continue;  // 定義本體
      let d = 1, j = m.index + m[0].length;
      while (j < src.length && d) { if (src[j] === '(') d++; else if (src[j] === ')') d--; j++; }
      const call = src.slice(m.index, j);
      if (call.includes("'attack-damage'")) continue;         // 對戰圓形不擋招式傷害
      if (/isBench:\s*false/.test(call)) continue;            // 目標在戰鬥位 → 走不到 bench 分支
      if (call.includes('counterPlacement')) continue;        // 已表態
      const line = src.slice(0, m.index).split('\n').length;
      violations.push(`[V] ${relf}:${line} — canApplyEffectToTarget 的 attack-effect/ability-effect 呼叫未表態 `
        + `counterPlacement。此旗標決定【對戰圓形競技場】要不要擋：放置/移轉傷害指示物→true，`
        + `其餘(換位/退化/丟道具/bounce/效果KO/狀態)→false。未傳會保守照擋，可能誤擋你的新效果。`);
    }
  }
}


// ── Check U：對手 active 上寫「跨回合 debuff 旗標」未過免疫 gate ─────────────
//   卡面主詞是「受到這個招式的寶可夢…」＝對受招者施加的招式效果 → 薄霧能量/化隱/純樸/
//   皇帝之勢/抵抗之幕/化石 等「不受對手招式效果影響」一律要擋。
//   正解：走中央 applyOppActiveDebuffPost(label, mutate, msg)（內含 gate + 免疫原因 log）。
//   ⭐旗標清單直接讀 instance-flags.ts 的 OPP_ATTACK_DEBUFF_FLAGS —— 與引擎兜底 sweep 同一份，
//     不會漂移；新增旗標歸類後，這道檢查自動涵蓋。
//   合法豁免標 // opp-debuff-ok: 理由。見長期記憶 reference-opp-debuff-flag-immunity-central。
{
  /** 取 updatePlayer(狀態, 目標index, …) 的第二個引數；括號平衡且可跨行。 */
  const uTargetIdx = (text) => {
    let last = null, k = -1;
    while ((k = text.indexOf('updatePlayer(', k + 1)) !== -1) {
      let d = 1, j = k + 'updatePlayer('.length, start = j;
      const args = [];
      for (; j < text.length && d > 0; j++) {
        const c = text[j];
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) { args.push(text.slice(start, j)); break; } }
        else if (c === ',' && d === 1) { args.push(text.slice(start, j)); start = j + 1; }
      }
      if (args.length >= 2) last = args[1].trim().replace(/\s+/g, ' ');
    }
    return last;
  };
  const flagsSrc = readFileSync(join(SRC, 'instance-flags.ts'), 'utf8');
  const uIdx0 = flagsSrc.indexOf('OPP_ATTACK_DEBUFF_FLAGS');
  const uList = uIdx0 > 0 ? flagsSrc.slice(flagsSrc.indexOf('[', uIdx0), flagsSrc.indexOf('];', uIdx0)) : '';
  const U_FLAGS = [...uList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (U_FLAGS.length < 10) {
    violations.push('[U] 讀不到 instance-flags.ts 的 OPP_ATTACK_DEBUFF_FLAGS（解析失效，Check U 形同關閉）');
  }
  const U_GUARD = /applyOppActiveDebuffPost|canApplyEffectToTarget|canApplyAttackEffectToTarget|oppPokemonImmuneToAttackEffect|defCantAttackNextPost|defCantRetreatNextPost|lockOppChosenAttackPost|defNextAtkReducePost|guard\.blocked|opp-debuff-ok/;
  const U_FUNC_START = /^\s*(regR|regPost|regPre|regA|export\s+(async\s+)?function|function\s|[\w$]+\.set\(|[\w$]+\s*=\s*\()/;
  const U_RE = new RegExp('\\b(' + U_FLAGS.join('|') + ')\\s*:(?!\\s*undefined)');
  for (const f of files) {
    const relf = f.slice(ROOT.length).split(sepChar).join('/');
    // 引擎的 promote/清除、清單本身、型別定義不是「施加」→ 跳過
    if (/src\/lib\/game\/(engine|instance-flags|types)\.ts$/.test(relf)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trimStart();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      const code = lines[i].replace(/\/\/.*$/, '');
      if (!U_RE.test(code)) continue;
      if (/opp-debuff-ok/.test(lines[i]) || /opp-debuff-ok/.test(lines[i - 1] ?? '')) continue;
      let fstart = i;
      for (let j = i; j >= Math.max(0, i - 100); j--) { if (U_FUNC_START.test(lines[j])) { fstart = j; break; } }
      // 不能只用 mutatedIdx：它只認**同一行**的 updatePlayer(x, dIdx, …)，而這類招式常寫成多行
      //   （updatePlayer 一行、addLog 一行、dIdx 一行、mutate 一行）—— 迷唇姐｜強烈之吻正是多行寫法，
      //   第一版 Check U 因此對它靜默放行。改成跨行、括號平衡地取第二個引數。
      const idx = uTargetIdx(lines.slice(fstart, i + 1).join('\n')) ?? mutatedIdx(lines, i, fstart);
      if (!idx) continue;                                   // 找不到明確被改的一側 → 保守不報
      if (C_ATTACKER.has(idx)) continue;                    // 寫在自己身上（反衝類）→ 不需 gate
      const isDefender = /\bdIdx\b|\boppIdx\b/.test(idx) || /1\s*-\s*aIdx/.test(idx);
      if (!isDefender) continue;
      const span = lines.slice(fstart, i + 2).join('\n');
      if (U_GUARD.test(span)) continue;
      violations.push(`[U] ${relf}:${i + 1} — 在對手寶可夢身上寫跨回合 debuff 旗標未見免疫 gate`
        + `（改走 applyOppActiveDebuffPost，或標 // opp-debuff-ok: 理由）`);
    }
  }
}


// ── Check W：deck-search 用純 'TOPn' 卻帶 validIids（可勾限制沒反映在顯示上）──────────
//   背景（v6.109，玩家回報超級烈空坐ex｜霸者咆哮）：卡面「查看牌庫上方 N 張，從其中選擇
//   **某類別**的卡」若寫成 filter:'TOPn'，UI 會把 N 張**全部**丟進可勾區，只靠 validIids
//   擋住不能選的 —— 玩家要在一堆點不動的卡裡找目標，而且畫面完全沒說明為什麼點不下去。
//   正解（同寶可裝置3.0）：filter 用**類別型**（'BasicEnergy:TOP_N' / 'Supporter:TOP7' …），
//   可勾區只留該類別，其餘走 UI 的「🔍 查看翻到的其他 N 張（本次不可選）」下拉。
//   ⚠ 純 'TOPn' 本身沒錯 —— 卡面若是「選任意 N 張卡」（探險家的嚮導／八朔／多龍奇｜偵查指令）
//   就該全部可勾。判準是「**有沒有 validIids**」：有 = 卡面限了類別 = 顯示也要限。
{
  const W_RE = /filter:\s*'TOP\d+'/;
  for (const f of files) {
    const relf = f.slice(ROOT.length).split(sepChar).join('/');
    if (!/src\/lib\/game\/effects/.test(relf)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const code = lines[i].replace(/\/\/.*$/, '');
      if (!W_RE.test(code)) continue;
      // 同一個 withPending 物件內（往後 25 行）出現 validIids ⇒ 可勾集合是子集
      const span = lines.slice(i, i + 25).join('\n').replace(/\/\/[^\n]*/g, '');
      if (!/validIids\s*:/.test(span)) continue;
      if (/top-filter-ok/.test(lines[i]) || /top-filter-ok/.test(lines[i - 1] ?? '')) continue;
      violations.push(`[W] ${relf}:${i + 1} — deck-search 用純 'TOPn' 卻帶 validIids：`
        + `可勾的只有子集、畫面卻顯示全部（玩家看不出為何點不下去）。`
        + `改用類別型 filter（如 'BasicEnergy:TOP_N' + params.topIids），`
        + `其餘卡會自動走「查看翻到的其他 N 張」下拉；或標 // top-filter-ok: 理由`);
    }
  }
}

if (violations.length === 0) {
  console.log('反模式 lint：✅ 無違規（A: _pool ReferenceError / B: 基本能量屬性比對 / C: 對手直接加傷漏免疫 guard / D: 9999假傷害KO / E: markFaint用於對手 / F: scrub鎖清單純度 / G: 從手牌附能治療漏對手反應 / H: 對手非傷害效果 inline 漏免疫 gate / I: 數丟道具漏 extraTools / J: 讀傷害狀態漏三槽 / K: 清狀態漏三槽(寫入端) / L: 有偏洗牌.sort(Math.random)→中央shuffle / M: reg空字串key死碼 / N: withPending死effectKey無resolver / P: opp-bench/poke-choose帶filter欄(改validIids) / Q: resolver保序map client iids重建牌庫未去重夾上限(疊牌/複製卡) / R: UI/AI判基本能量屬性直讀pokemonType(恒null選不到) / S: effects的filter字面量未收錄中央selection-filter且不在白名單→掉fallthrough / T: picker log帶候選/發現N張洩漏隱藏zone統計 / U: 對手active寫跨回合debuff旗標漏免疫gate(強烈之吻類) / V: canApplyEffectToTarget未表態counterPlacement(對戰圓形只擋放指示物) / W: deck-search純TOPn卻帶validIids(可勾子集但顯示全部)）');
  process.exit(0);
}
console.log(`反模式 lint：❌ 發現 ${violations.length} 處違規\n`);
for (const v of violations) console.log('  ' + v);
console.log('\n（誤報可在 scripts/anti-pattern-lint.mjs 調整 regex；真違規請修正）');
process.exit(1);
