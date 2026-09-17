#!/usr/bin/env node
/**
 * v6.402 突變測試：證明 test-v6402-criteria-convergence.mjs 不是安慰劑。
 *
 * 做法：對 src 逐一注入一個「本版收斂想防止的錯誤」，跑守衛，斷言
 *   ① 守衛 exit code ≠ 0（⚠ 絕不用 /FAIL/.test(out) —— 守衛結尾恆印「FAIL N」）
 *   ② **紅在預期的那幾條**（型態 2：無差別 try/catch／紅錯地方 也算沒測到）
 *   ③ 有些突變還要斷言「另一條**不准**紅」，證明兩條斷言各自獨立（不是一起爆）
 * 最後一律還原檔案（finally），並在結尾複驗「還原後守衛全綠」。
 *
 * ⚠ 等價突變誠實標記，不為了湊「全殺」而補假條件。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const GUARD = join(ROOT, 'scripts/test-v6402-criteria-convergence.mjs');

const EFFECTS = 'src/lib/game/effects.ts';
const ENGINE = 'src/lib/game/engine.ts';
const TOOLS = 'src/lib/game/effects/cards/tools.ts';
const ENERGY = 'src/lib/game/effects/cards/energy_cards.ts';
const SELFILTER = 'src/lib/game/selection-filter.ts';   // ⭐v6.402 超級進化ex 判準下沉的 leaf

/** @type {{id:string,file:string,from:string,to:string,red:string[],green?:string[],note?:string}[]} */
const MUTS = [
  {
    id: 'M1 龐克頭盔退回「只看 toolAttached」（v5.835 那個漏洞）',
    file: EFFECTS,
    from: "  if (!getAllAttachedTools(defActive).some((t) => pool.get(t.cardId)?.name === '龐克頭盔')) return 0;",
    to: "  if (pool.get(defActive.toolAttached?.cardId ?? '')?.name !== '龐克頭盔') return 0;",
    red: ['B5'], green: ['B1'],
  },
  {
    id: 'M2 龐克頭盔的屬性 gate 恆真（反安慰劑：證明 B4 真的在守屬性）',
    file: EFFECTS,
    from: "  if (!fieldPokemonHasType(state, dIdx, defActive, pool, 'Darkness')) return 0;",
    to: "  if (false) return 0;",
    red: ['B4'], green: ['B1', 'B5'],
  },
  {
    id: 'M3 豪邁炸彈門檻 240 → 239（卡面「240」以上）',
    file: SELFILTER,
    from: 'export const LUXURY_BOMB_DAMAGE_THRESHOLD = 240;',
    to: 'export const LUXURY_BOMB_DAMAGE_THRESHOLD = 239;',
    red: ['B8'],
  },
  {
    id: 'M4 拿掉「holder 自己是超級進化ex 就不觸發」（卡面「除外」）',
    file: SELFILTER,
    from: '  if (isMegaExCard(holderCard)) return false;   // 卡面「超級進化寶可夢【ex】除外」',
    to: '  if (false) return false;   // 卡面「超級進化寶可夢【ex】除外」',
    red: ['B9', 'B10'],
    green: ['B8', 'D2'],
    note: 'B10 一起紅正是「訂製背心與豪邁炸彈共用同一份」的證明。'
      + '⚠ B10 原本寫成「兩邊都呼叫同一支函式必相同」⇒ 本突變兩邊一起變、斷言恆真（型態 12），'
      + '就是這個突變逼出來的，已改成驗具體值 60／0／0。'
      + '⚠ D2 **不准**紅：判準下沉 leaf 之後 D2 守的是「定義只有一份、呼叫端都走中央」，'
      + '本突變只改函式內部 ⇒ D2 看不到才是對的（兩層斷言各自獨立）。',
  },
  {
    id: 'M5 toolDefenseByTypeApplies 忽略 holderTypes（渾厚鱗片變成誰都減 50）',
    file: EFFECTS,
    from: '  const ht = defense.holderTypes;\n  if (!ht) return true;',
    to: '  const ht = undefined;\n  if (!ht) return true;',
    red: ['B12'], green: ['B13'],
  },
  {
    id: 'M6 fieldSlotOf 的備戰分支謊報成 active',
    file: EFFECTS,
    from: "    if (p?.bench?.some((b) => b.iid === inst.iid)) return { ownerIdx: i, loc: 'bench' };",
    to: "    if (p?.bench?.some((b) => b.iid === inst.iid)) return { ownerIdx: i, loc: 'active' };",
    red: ['D4b'], green: ['B14'],
  },
  {
    id: 'M7 fieldOwnerIdxOf 不委派、自己再寫一份迴圈（Rule 38 回頭路）',
    file: EFFECTS,
    from: '  return fieldSlotOf(state, inst)?.ownerIdx;\n}',
    to: '  if (!state || !inst) return undefined;\n  for (const i of [0, 1] as const) {\n'
      + '    const p = state.players[i];\n    if (p?.active?.iid === inst.iid) return i;\n'
      + '    if (p?.bench?.some((b) => b.iid === inst.iid)) return i;\n  }\n  return undefined;\n}',
    red: ['D4'], green: ['B14', 'D4b'],
    note: '行為完全相同 ⇒ 只有靜態收斂斷言抓得到（這正是它存在的理由）',
  },
  {
    id: 'M8 磁鐵【鋼】能量退回直讀印刷屬性',
    file: ENERGY,
    from: "  if (ctx.effectiveTypes.includes('Metal')) return { zero: true };",
    to: "  if (_holder.pokemonType === 'Metal') return { zero: true };",
    red: ['D5'], green: ['C1'],
    note: 'C1 仍綠是**預期**：【鋼】寶可夢的印刷屬性本來就是 Metal ⇒ 行為端看不出來，'
      + '只有 D5 的靜態收斂斷言擋得住這種「未來新卡才會爆」的退化。',
  },
  {
    id: 'M9 engine 不再呼叫中央龐克頭盔述詞（改回自己算）',
    file: ENGINE,
    from: '    let punkReflectDamage = punkHelmetReflectDamageFor(',
    to: '    let punkReflectDamage = 0 * Number(\n',
    red: ['D1'],
    note: '呼叫數 3 → 2 ⇒ D1 的「定義 1 ＋ 呼叫 2」會紅（本突變會讓 tsc 不過，'
      + '但守衛走 esbuild bundle 不做型別檢查，照樣跑得完）',
  },
  {
    id: 'M11 engine 主管線算出的反擊量被吃掉（呼叫還在、行為沒了）',
    file: ENGINE,
    from: '    let punkReflectDamage = punkHelmetReflectDamageFor(',
    to: '    let punkReflectDamage = 0 && punkHelmetReflectDamageFor(',
    red: ['E2E1'], green: ['D1', 'B1'],
    note: 'D1（靜態呼叫計數）與 B1（直呼述詞）都**不准**紅 —— 只有端到端 E2E1 抓得到。'
      + '這正是審查 Y3 要補端到端的理由：靜態斷言證明「有接線」，行為端才證明「線是活的」。',
  },
  {
    id: 'M10 fieldPokemonHasType 退回印刷屬性（整條收斂變成空殼）',
    file: EFFECTS,
    from: '  const idx = ownerIdx ?? fieldOwnerIdxOf(state, inst);\n'
      + '  return hasEffectivePokemonType(state, idx, inst, pool.get(inst.cardId), pool, type);',
    to: '  return pool.get(inst.cardId)?.pokemonType === type;',
    red: ['B16', 'E2b'], green: ['B15'],
  },
];

function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
  const out = (r.stdout || '') + (r.stderr || '');
  const reds = new Set();
  const greens = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(PASS|FAIL)\s+(\S+)/);
    if (!m) continue;
    (m[1] === 'FAIL' ? reds : greens).add(m[2]);
  }
  return { status: r.status, reds, greens, out };
}

console.log('【0】基準：未突變時守衛必須全綠');
const base = runGuard();
assert.strictEqual(base.status, 0, '未突變時守衛就不是全綠，先修守衛：\n' + base.out.slice(-2000));
console.log('  OK 基準全綠（' + base.greens.size + ' 條）');

let ok = 0, bad = 0;
for (const m of MUTS) {
  const path = join(ROOT, m.file);
  const orig = readFileSync(path, 'utf8');
  const crlf = orig.includes('\r\n');
  const NL = (s) => (crlf ? s.replace(/\r?\n/g, '\r\n') : s);
  const from = NL(m.from), to = NL(m.to);
  try {
    const hits = orig.split(from).length - 1;
    assert.strictEqual(hits, 1, m.id + '：突變錨點命中 ' + hits + ' 次（需 1）⇒ 突變沒套上，結果不可信');
    writeFileSync(path, orig.replace(from, to));
    const r = runGuard();
    // ① exit code
    assert.notStrictEqual(r.status, 0, m.id + '：守衛沒紅 ⇒ 測不到這個退化');
    // ② 紅在預期的那幾條
    const missing = m.red.filter((id) => ![...r.reds].some((x) => x.startsWith(id.split(' ')[0])));
    assert.strictEqual(missing.length, 0, m.id + '：預期紅的條目沒紅：' + missing.join(',')
      + '（實際紅：' + [...r.reds].join(',') + '）');
    // ③ 指定的那幾條不准紅（證明斷言彼此獨立）
    for (const g of (m.green ?? [])) {
      const stillRed = [...r.reds].some((x) => x.startsWith(g));
      assert.ok(!stillRed, m.id + '：' + g + ' 不應該一起紅（兩條斷言沒有各自獨立）');
    }
    console.log('  OK  ' + m.id + (m.note ? '\n        ↳ ' + m.note : ''));
    ok++;
  } catch (e) {
    console.log('  BAD ' + m.id + ' :: ' + e.message);
    bad++;
  } finally {
    writeFileSync(path, orig);
  }
}

console.log('\n【Z】複驗：全部還原後守衛必須回到全綠');
const after = runGuard();
if (after.status !== 0) { console.log('  BAD 還原後守衛沒回到全綠：\n' + after.out.slice(-2000)); bad++; }
else console.log('  OK 還原後全綠');

console.log('\n=== v6.402 突變測試：OK ' + ok + ' / BAD ' + bad + '（共 ' + MUTS.length + ' 個突變）===');
process.exit(bad > 0 ? 1 : 0);
