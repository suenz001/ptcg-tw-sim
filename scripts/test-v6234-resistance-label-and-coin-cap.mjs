#!/usr/bin/env node
/**
 * v6.234 守衛 —— 三件事，每一件都配「證明它不是恆真」的對照或突變。
 *
 *  【A】傷害公式的用語從「屬性相剋」改成**卡面官方用語「抵抗力」**（引擎戰鬥紀錄＋預估都改）。
 *       ⇒ 只是顯示文字：釘死「同一盤面前後傷害數值完全相同」，並在完整 clone 時
 *         用**逐位元組回推**證明 engine.ts 除了那一行 label 之外一個字都沒動。
 *  【B】「擲硬幣直到出現反面」型招式的文案改成「傷害依擲幣次數而定」（站長裁定；舊的「0+」讀起來很怪）。
 *       ⇒ 三種情境各斷言一次，並釘死手機／桌機取用的是**同一份字串來源**。
 *  【C】全站「擲到反面為止」的迴圈收斂到中央 `flipCoinsUntilTails`，上限逐處宣告。
 *       ⇒ 行為端證明「把硬幣固定成全正面時會在有限步內結束」，
 *         並用正對照證明真實隨機下的行為與 BASE 完全相同。
 *
 * ⚠ IRON_RULES Rule 25：所有掃描器都附下限斷言；Rule 33：否定型斷言都配正對照。
 * ⚠ CI 的 checkout 是 fetch-depth:1 淺複製 ⇒ 用得到 git 歷史的段落一律先探測、拿不到就明講 SKIP，
 *   **絕不可以讓 git 的例外把整支測試炸掉**（v6.233 第一發就是這樣把 build 弄紅的）。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'cad2bba07942ffcf70bc52df1107e9a9cdbb668d';   // v6.233
const CENTRAL = 'flipCoinsUntilTails';

let n = 0, bad = 0;
const chk = (label, cond) => { n++; console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) bad++; };

// ── git 探測（淺複製就整段 SKIP）────────────────────────────────────────────
const git = (args) => {
  try {
    return { ok: true, out: execFileSync('git', ['-C', ROOT, ...args],
      { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8') };
  } catch { return { ok: false, out: '' }; }
};
const HAS_BASE = git(['cat-file', '-e', BASE + '^{commit}']).ok;

// ── 把（可選擇性突變的）src 打包成可執行模組 ────────────────────────────────
const TMPS = [];
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

async function bundleSrc(srcDir, tag) {
  const td = mkdtempSync(join(tmpdir(), 'v6234-' + tag + '-'));
  TMPS.push(td);
  const stub = join(td, 'paths.js'), entry = join(td, 'entry.ts'), out = join(td, 'out.mjs');
  writeFileSync(stub, 'export const base="";');
  writeFileSync(entry,
    `export * from ${JSON.stringify(join(srcDir, 'lib/game/damage-estimate'))};\n` +
    `export { applyAction } from ${JSON.stringify(join(srcDir, 'lib/game/engine'))};\n` +
    `import ${JSON.stringify(join(srcDir, 'lib/game/effects'))};`);
  await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'node',
    target: 'node20', alias: { '$lib': join(srcDir, 'lib'), '$app/paths': stub }, logLevel: 'error' });
  return import(pathToFileURL(out).href + '?t=' + tag);
}

/** 複製一份 src 出來、套用突變，再打包。用來做真正的突變測試（不是嘴上說說）。 */
async function bundleMutated(tag, mutations) {
  const td = mkdtempSync(join(tmpdir(), 'v6234-src-' + tag + '-'));
  TMPS.push(td);
  cpSync(join(ROOT, 'src'), join(td, 'src'), { recursive: true });
  for (const [rel, from, to] of mutations) {
    const p = join(td, 'src', rel);
    const t = readFileSync(p, 'utf8');
    if (!t.includes(from)) return { err: `突變定位失敗（找不到 ${from.slice(0, 40)}… @ ${rel}）` };
    writeFileSync(p, t.replace(from, to));
  }
  return { mod: await bundleSrc(join(td, 'src'), tag) };
}

const mod = await bundleSrc(join(ROOT, 'src'), 'head');

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// ── fixture ─────────────────────────────────────────────────────────────────
const inst = (cardId, iid, ex = {}) =>
  ({ iid, cardId: String(cardId), damage: 0, energyAttached: [], evolvedFromStack: [], ...ex });
const ENERGY = {};
for (const c of pool.values()) {
  if (c.supertype === 'Energy' && c.subtype === 'Basic') {
    const m = /基本【(.)】能量/.exec(c.name || ''); if (m) ENERGY[m[1]] = c;
  }
}
const T2C = { Grass:'草', Fire:'火', Water:'水', Lightning:'雷', Psychic:'超',
              Fighting:'鬥', Darkness:'惡', Metal:'鋼', Colorless:'草', Dragon:'草' };
function payFor(cost, pkType) {
  const out = []; let k = 0;
  for (const c of (cost || [])) {
    const t = (c === '無') ? (T2C[pkType] || '草') : c;
    const e = ENERGY[t]; if (e) out.push(inst(e.id, 'e' + (k++)));
  }
  for (let i = 0; i < 6; i++) out.push(inst((ENERGY[T2C[pkType] || '草']).id, 'ex' + (k++)));
  return out;
}
const DECK_IDS = [...pool.values()]
  .filter(c => String(c.supertype || '').startsWith('Pok') && ['H','I','J'].includes(c.regulationMark))
  .slice(0, 8).map(c => c.id);
const deckOf = (tag) => DECK_IDS.map((id, i) => inst(id, tag + i));
function mkState(attCard, defCard, energyInsts) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(attCard.id, 'a1', { energyAttached: energyInsts }),
        bench: [inst(attCard.id, 'b1')], hand: [inst(attCard.id, 'h1')], deck: deckOf('d'),
        discard: [inst(attCard.id, 'g1')], prizes: [inst(attCard.id, 'pz1'), inst(attCard.id, 'pz2')],
        energyAttachedThisTurn: false },
      { name: 'P2', active: inst(defCard.id, 'oa1', { energyAttached: [inst(ENERGY['水'].id, 'oe1'), inst(ENERGY['水'].id, 'oe2')] }),
        bench: [inst(defCard.id, 'ob1')], hand: [inst(defCard.id, 'oh1')],
        deck: deckOf('od'), discard: [inst(defCard.id, 'og1')],
        prizes: [inst(defCard.id, 'opz1'), inst(defCard.id, 'opz2')], energyAttachedThisTurn: false },
    ],
  };
}
const findAtk = (name, atkName) => {
  const c = [...pool.values()].find(x => x.name === name && (x.attacks || []).some(a => a.name === atkName));
  if (!c) return null;
  return { card: c, idx: (c.attacks || []).findIndex(a => a.name === atkName), atk: (c.attacks || []).find(a => a.name === atkName) };
};
const findCard = (name) => [...pool.values()].find(x => x.name === name) ?? null;
function setup(attName, atkName, defName) {
  const f = findAtk(attName, atkName); const d = findCard(defName);
  if (!f || !d) return null;
  return { ...f, def: d, state: mkState(f.card, d, payFor(f.atk.cost, f.card.pokemonType)) };
}
const NEUTRAL = [...pool.values()].find(x =>
  String(x.supertype || '').startsWith('Pok') && ['H','I','J'].includes(x.regulationMark) &&
  (x.stage ?? x.subtype) === 'Basic' && !x.abilities?.length && !x.weakness && !x.resistance && x.hp >= 200);

const SRC = {
  engine: readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'),
  effects: readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'),
  est: readFileSync(join(ROOT, 'src/lib/game/damage-estimate.ts'), 'utf8'),
  page: readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'),
  mob: readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8'),
};

// ══════════════════════════════════════════════════════════════════════════
console.log('⓪ 前提：素材齊備（掃描器／樣本自身先驗，Rule 25）');
chk('卡池載入（> 4000 張）', pool.size > 4000);
chk('八種基本能量都找得到', Object.keys(ENERGY).length === 8);
chk('中性防守方存在：' + (NEUTRAL?.name ?? '—'), !!NEUTRAL);
chk(`兩個大檔沒有被 mount 截斷（engine ${SRC.engine.length} / effects ${SRC.effects.length}）`,
    SRC.engine.length > 450000 && SRC.effects.length > 750000);
chk(`兩個 svelte 沒有被截斷（page ${SRC.page.length} / mobile ${SRC.mob.length}）`,
    SRC.page.length > 900000 && SRC.mob.length > 90000);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n① 【A】卡面官方用語查證：官方寫的是「抵抗力」，不是「屬性相剋」');
{
  // 唯一權威來源＝static/cards 的卡面原文（禁英日 Wiki、禁憑印象）。
  let faceHits = 0, oldTermHits = 0;
  for (const c of pool.values()) {
    const blob = JSON.stringify(c);
    if (blob.includes('抵抗力')) faceHits++;
    if (blob.includes('屬性相剋')) oldTermHits++;
  }
  chk(`卡面原文出現「抵抗力」的卡片 ${faceHits} 張（下限 20；證明這個詞真的是官方用語）`, faceHits >= 20);
  chk(`卡面原文出現「屬性相剋」的卡片 ${oldTermHits} 張（必須 0；官方從不用這個詞）`, oldTermHits === 0);
  // 官方規則書也對得上
  const rulesPath = join(ROOT, 'PTCG RULES/PTCG_RULES.md');
  const rules = existsSync(rulesPath) ? readFileSync(rulesPath, 'utf8') : '';
  chk(`官方規則書讀得到（${rules.length} 字，下限 10000）`, rules.length > 10000);
  chk('官方規則書 PTCG_RULES.md 有「抵抗力」條目', rules.includes('**抵抗力**'));
  chk('官方規則書完全沒有「屬性相剋」這個詞', rules.length > 10000 && !rules.includes('屬性相剋'));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n② 【A】引擎戰鬥紀錄與預估都改用「抵抗力」（行為端，不是 grep 字串）');
// 對照靶卡面（逐字查證自 static/cards）：大岩蛇｜怪力 印刷傷害 100；凱西 抵抗力【鬥】-30 ⇒ 100-30 = 70
const RESIST_CASE = { att: '大岩蛇', atk: '怪力', def: '凱西', expect: 70 };
{
  const s = setup(RESIST_CASE.att, RESIST_CASE.atk, RESIST_CASE.def);
  chk(`fixture 存在：${RESIST_CASE.att}｜${RESIST_CASE.atk} vs ${RESIST_CASE.def}`, !!s);
  if (s) {
    // 前提：對照靶的卡面真的有「對攻方屬性的抵抗力」，否則這一條驗不出東西（Rule 33）
    chk(`  └ 前提：${RESIST_CASE.def} 卡面抵抗力 = ${s.def.resistance?.type} ${s.def.resistance?.value}`,
        !!s.def.resistance?.type && !!s.def.resistance?.value);
    const before = JSON.stringify(s.state);
    const est = mod.estimateAttackDamage(s.state, s.idx, pool, 0);
    const after = mod.applyAction(s.state, { type: 'ATTACK', attackIndex: s.idx }, pool);
    const msgs = (after.log ?? []).map(l => l?.message ?? '');
    const formulaLine = msgs.filter(m => /【[^】]*=/.test(m)).pop() ?? '';
    chk(`  └ 戰鬥紀錄公式：${formulaLine || '(無)'}`, formulaLine.includes('(抵抗力)'));
    chk('  └ 戰鬥紀錄不再出現「屬性相剋」', !msgs.some(m => m.includes('屬性相剋')));
    chk(`  └ 預估的 term label 也是「抵抗力」：${est.formula || '(無)'}`,
        est.kind === 'exact' && (est.terms || []).some(t => t.label === '抵抗力'));
    chk('  └ 預估的 term label 沒有「屬性相剋」',
        !(est.terms || []).some(t => t.label === '屬性相剋'));
    chk('  └ 「為什麼」短句用的也是「抵抗力」：' + mod.estimateReasonText(est),
        mod.estimateReasonText(est).includes('抵抗力'));
    chk('  └ 預估沒有動到原盤面（順帶維持 v6.233 的不變量）', JSON.stringify(s.state) === before);
    // ⭐ 計算結果未變：釘死數值（卡面：怪力 100，凱西 抵抗力【鬥】-30 ⇒ 100-30 = 70）
    const dmg = after.lastDealtDamage ?? 0;
    chk(`  └ ⭐ 傷害數值 = ${dmg}（釘死；label 只是顯示文字，數值不得改變）`, dmg === RESIST_CASE.expect);
    chk('  └ ⭐ 預估值 === 實打值', est.kind === 'exact' && est.value === dmg);
  }
}
// 正對照：抵抗力真的有被扣（否則上面「數值沒變」可能只是兩邊都沒算）
{
  const a = setup(RESIST_CASE.att, RESIST_CASE.atk, RESIST_CASE.def);
  const b = setup(RESIST_CASE.att, RESIST_CASE.atk, NEUTRAL?.name);
  const ea = a && mod.estimateAttackDamage(a.state, a.idx, pool, 0);
  const eb = b && mod.estimateAttackDamage(b.state, b.idx, pool, 0);
  const delta = Math.abs(Number(String(a?.def?.resistance?.value ?? 0)));
  chk(`正對照：有抵抗力 ${ea?.value} vs 無抵抗力 ${eb?.value}，差 ${delta}（證明②不是恆真）`,
      !!ea && !!eb && ea.kind === 'exact' && eb.kind === 'exact' && eb.value - ea.value === delta);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n③ 【A】沒有任何「邏輯」靠這個字串做判斷；舊歸檔紀錄不會壞');
{
  // 全站原始碼不得再產生新的「屬性相剋」文字
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|js|mjs|svelte)$/.test(e.name)) files.push(p);
  } };
  walk(join(ROOT, 'src'));
  chk(`掃描器自身：掃到 ${files.length} 個原始碼檔（下限 150）`, files.length >= 150);
  const offenders = files.filter(p => readFileSync(p, 'utf8').includes('屬性相剋'))
                         .map(p => p.slice(ROOT.length));
  chk(`src/ 全域已無「屬性相剋」（殘留 ${offenders.length}）${offenders.slice(0, 3).join(' / ')}`,
      offenders.length === 0);
  // 「只當顯示文字」：label 只被拿去組字串／顯示，沒有任何比較運算
  chk('引擎只把 label 推進 formula（沒有 label === 之類的判斷）',
      !/label\s*===\s*['"]/.test(SRC.engine) && !/===\s*['"]屬性相剋['"]/.test(SRC.engine));
  chk('預估模組也沒有拿 label 做判斷（只 filter sign，不 filter label）',
      !/t\.label\s*===\s*['"]/.test(SRC.est));
  // 舊歸檔紀錄：對戰紀錄的解析器（動畫、著色、預估取公式）都不看這個詞
  const parsers = ['src/lib/game/coinAnimation.ts', 'src/lib/game/log_format.ts', 'src/lib/game/log_zoom.ts']
    .map(p => ({ p, t: readFileSync(join(ROOT, p), 'utf8') }));
  chk(`掃描器自身：讀到 ${parsers.length} 個紀錄解析器（下限 3）`, parsers.length >= 3);
  chk('紀錄解析器完全不認得「屬性相剋」／「抵抗力」這兩個詞（新舊並存不會壞）',
      parsers.every(x => !x.t.includes('屬性相剋') && !x.t.includes('抵抗力')));
  // 預估取公式是靠【】括號，與 label 的字面無關 ⇒ 舊紀錄照樣解析得出來
  chk('預估取公式靠【…】而不是靠 label 字面', SRC.est.includes('/【([^】]+)】/'));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ 【B】三種情境的實際文案 ＋ 手機／桌機同一份來源');
const OPEN_ZERO = { att: '胖丁', atk: '滾球' };            // 基礎 0：0 + 正面數×20
const OPEN_BASE = { att: '超級袋獸ex', atk: '機關槍合擊' };  // 基礎 200：200 + 正面數×50
const RANGE_CAP = { att: '喵喵', atk: '亂抓' };             // 有上限的擲幣：擲 3 次 ×20
{
  const rows = [];
  for (const [tag, c] of [['基礎 0', OPEN_ZERO], ['基礎非 0', OPEN_BASE], ['有上限擲幣', RANGE_CAP]]) {
    const s = setup(c.att, c.atk, NEUTRAL?.name);
    if (!s) { chk(`${tag}：fixture 找不到 ${c.att}｜${c.atk}`, false); rows.push(null); continue; }
    const e = mod.estimateAttackDamage(s.state, s.idx, pool, 0);
    rows.push({ tag, c, e, txt: mod.estimateShortText(e) });
    console.log(`   〔${tag}〕${c.att}｜${c.atk} → 「${mod.estimateShortText(e)}」`);
  }
  const [z, b, r] = rows;
  chk('① 基礎 0（胖丁｜滾球）文案 === 「預估：傷害依擲幣次數而定」',
      !!z && z.e.kind === 'open' && z.txt === '預估：傷害依擲幣次數而定');
  chk('② 基礎非 0（超級袋獸ex｜機關槍合擊）文案 === 「預估 200 起，傷害依擲幣次數而定」',
      !!b && b.e.kind === 'open' && b.txt === '預估 200 起，傷害依擲幣次數而定');
  chk('③ 有上限的擲幣（喵喵｜亂抓）維持範圍寫法 === 「預估 0～60（擲幣）」',
      !!r && r.e.kind === 'range' && r.txt === '預估 0～60（擲幣）');
  chk('⚠ 舊文案「0+（擲到反面為止，無上限）」已完全消失',
      rows.every(x => !x || (!x.txt.includes('無上限') && !/\d\+（/.test(x.txt))));
  chk('三種情境都還帶著「預估」二字（不可讓玩家以為是保證值）',
      rows.every(x => !x || x.txt.includes('預估')));

  // ⭐ 手機／桌機同一份來源
  chk('⭐ 文案函式只有一支：estimateShortText 定義在 damage-estimate.ts',
      (SRC.est.match(/export function estimateShortText/g) || []).length === 1);
  chk('⭐ 桌機呼叫 estimateShortText（不自己拼字串）', SRC.page.includes('estimateShortText('));
  chk('⭐ 手機直式呼叫 estimateShortText（不自己拼字串）', SRC.mob.includes('estimateShortText('));
  for (const [who, t] of [['桌機 +page.svelte', SRC.page], ['手機 MobilePortraitBattle', SRC.mob]]) {
    chk(`⭐ ${who} 沒有自己寫一份「依擲幣次數」的文案字面量`,
        !t.includes('依擲幣次數') && !t.includes('擲到反面為止'));
  }
  chk('⭐ 新文案字面量全站只出現在 damage-estimate.ts 這一個檔',
      SRC.est.includes('傷害依擲幣次數而定') &&
      !SRC.page.includes('傷害依擲幣次數而定') && !SRC.mob.includes('傷害依擲幣次數而定'));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ 【C】全站「擲到反面為止」的迴圈：一律走中央 helper、一律有上限');
{
  const scan = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) scan.push(p);
  } };
  walk(join(ROOT, 'src/lib/game'));
  chk(`掃描器自身：掃到 ${scan.length} 個 .ts（下限 60）`, scan.length >= 60);

  // 抓「迴圈裡呼叫 flipCoinsWithLog」——那就是手寫的擲幣迴圈
  const handRolled = [];
  let callSites = 0;
  for (const p of scan) {
    const lines = readFileSync(p, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(CENTRAL + '(')) callSites++;
      if (!/flipCoinsWithLog\s*\(/.test(lines[i])) continue;
      for (let j = i; j >= Math.max(0, i - 8); j--) {
        if (/^\s*(for|while)\s*\(/.test(lines[j])) {
          const body = lines.slice(j, Math.min(lines.length, j + 14)).join('\n');
          // 只看「重複擲同一個 label」型（迴圈變數/heads 有上限）；for..of 走陣列不算
          if (/^\s*(for \(let|while)/.test(lines[j])) {
            // `i < maxFlips` ＝ 中央 helper 自己（上限由必填參數帶進來）⇒ 算「有上限」
            const capped = /(i\s*<\s*\d+|i\s*<=\s*\d+|heads\s*[<>]=?\s*\d+|i\s*<\s*maxFlips)/.test(body);
            if (!capped) handRolled.push(p.slice(ROOT.length) + ':' + (j + 1) + ' → ' + lines[j].trim());
          }
          break;
        }
      }
    }
  }
  // ⚠ 下限斷言：中央 helper 的呼叫點要夠多，否則「沒有無上限迴圈」可能只是掃描器壞了
  chk(`中央 ${CENTRAL} 的呼叫／定義點共 ${callSites} 處（下限 12）`, callSites >= 12);
  chk(`沒有任何「沒有上限」的手寫擲幣迴圈（殘留 ${handRolled.length}）\n      ${handRolled.slice(0, 4).join('\n      ')}`,
      handRolled.length === 0);
  // 中央 helper 的 maxFlips 是必填（不得給預設值，否則等於默默改掉某些卡的上限）
  const decl = /export function flipCoinsUntilTails\([\s\S]*?\)\s*:/.exec(SRC.effects)?.[0] ?? '';
  chk('中央 helper 存在且 maxFlips 是必填參數（沒有 `= 20` 這種預設值）',
      /maxFlips:\s*number,/.test(decl) && !/maxFlips[^,)]*=/.test(decl));
  // 逐處宣告的上限值：同族本來就有 10/20/30 三種，必須原封不動保留
  const caps = [...SRC.effects.matchAll(/flipCoinsUntilTails\([^)]*,\s*(\d+)\)/g)].map(m => m[1]);
  const cardDir = join(ROOT, 'src/lib/game/effects/cards');
  for (const f of readdirSync(cardDir)) {
    if (!f.endsWith('.ts')) continue;
    for (const m of readFileSync(join(cardDir, f), 'utf8').matchAll(/flipCoinsUntilTails\([^)]*,\s*(\d+)\)/g)) caps.push(m[1]);
  }
  const uniq = [...new Set(caps)].sort();
  chk(`逐處宣告的上限值 = ${JSON.stringify(uniq)}（原本就是 10/20/30 三種，一個都不能被統一掉）`,
      uniq.length === 3 && uniq.includes('10') && uniq.includes('20') && uniq.includes('30'));
  chk(`共 ${caps.length} 處宣告了上限（下限 11）`, caps.length >= 11);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ 【C】行為端：把硬幣固定成全正面時，兩張原本沒有上限的卡會在有限步內結束');
const RUNAWAY = [['怪顎龍', '亂暴'], ['洛奇亞ex', '破壞潮旋']];
const BUDGET = 400;
/** 全正面；抽超過 budget 次就 throw（＝真的卡死時測試會抓到，而不是整支跑不完） */
function runAllHeads(m, s, budget = BUDGET) {
  const orig = Math.random;
  let calls = 0;
  try {
    Math.random = () => { if (++calls > budget) throw new Error('COIN_RUNAWAY'); return 0.25; };
    const out = m.applyAction(s.state, { type: 'ATTACK', attackIndex: s.idx }, pool);
    return { ok: true, calls, flips: (out._machineGunLastFlips ?? []).length };
  } catch (e) {
    return { ok: false, calls, err: String(e && e.message) };
  } finally { Math.random = orig; }
}
for (const [an, atkn] of RUNAWAY) {
  const s = setup(an, atkn, NEUTRAL?.name);
  if (!s) { chk(`${an}｜${atkn}：fixture 找不到`, false); continue; }
  const r = runAllHeads(mod, s);
  chk(`${an}｜${atkn} 固定全正面：有限步內結束（擲了 ${r.flips} 次、抽了 ${r.calls} 次亂數）`,
      r.ok && r.flips > 0 && r.flips <= 30);
}
// 正對照：同一支 runner 對「本來就有上限」的卡也跑得完（證明 runner 不是恆真地放行）
{
  const s = setup('胖丁', '滾球', NEUTRAL?.name);
  const r = s && runAllHeads(mod, s);
  chk(`正對照：胖丁｜滾球（原本就有 20 上限）同樣結束，擲了 ${r?.flips} 次`,
      !!r && r.ok && r.flips === 20);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ 【C】正對照：真實隨機下上限根本碰不到 ⇒ 實戰行為與 BASE 相同');
{
  const s = setup('怪顎龍', '亂暴', NEUTRAL?.name);
  let maxFlips = 0, total = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const out = mod.applyAction(s.state, { type: 'ATTACK', attackIndex: s.idx }, pool);
    const f = (out._machineGunLastFlips ?? []).length;
    total += f; if (f > maxFlips) maxFlips = f;
  }
  const mean = total / N;
  console.log(`   ${N} 次真隨機：平均擲 ${mean.toFixed(2)} 次、最多 ${maxFlips} 次（上限 30）`);
  chk(`真隨機 ${N} 次從未接近 30 次上限（最多 ${maxFlips}）⇒ 新增的上限不改變實戰行為`, maxFlips < 20);
  chk(`  └ 平均擲幣次數 ${mean.toFixed(2)} 落在理論值 2.0 附近（證明擲幣沒被我改壞）`,
      mean > 1.7 && mean < 2.4);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑧ ⭐ 突變測試（沒有這一段，④⑤⑥可能只是恆真的安慰劑）');
{
  // 突變 M1：把【B】的新文案改回舊的 ⇒ ④ 必須變紅
  const m1 = await bundleMutated('m1', [[
    'lib/game/damage-estimate.ts',
    "      return e.min > 0\n        ? `預估 ${e.min} 起，傷害依擲幣次數而定`\n        : '預估：傷害依擲幣次數而定';",
    "      return `預估 ${e.min}+（擲到反面為止，無上限）`;",
  ]]);
  if (m1.err) chk('突變 M1 定位：' + m1.err, false);
  else {
    const s = setup(OPEN_ZERO.att, OPEN_ZERO.atk, NEUTRAL?.name);
    const txt = m1.mod.estimateShortText(m1.mod.estimateAttackDamage(s.state, s.idx, pool, 0));
    chk(`突變 M1：文案改回舊的 ⇒ ④ 的斷言確實不成立（實得「${txt}」）`,
        txt !== '預估：傷害依擲幣次數而定' && txt.includes('無上限'));
  }
}
{
  // 突變 M2：把中央 helper 的上限拿掉 ⇒ ⑥ 必須變紅（真的無窮迴圈）
  const m2 = await bundleMutated('m2', [[
    'lib/game/effects.ts',
    '  for (let i = 0; i < maxFlips; i++) {\n    const r = flipCoinsWithLog(s, 1, label, aIdx);',
    '  for (let i = 0; true; i++) {\n    void maxFlips;\n    const r = flipCoinsWithLog(s, 1, label, aIdx);',
  ]]);
  if (m2.err) chk('突變 M2 定位：' + m2.err, false);
  else {
    const s = setup('怪顎龍', '亂暴', NEUTRAL?.name);
    const r = runAllHeads(m2.mod, s);
    chk(`突變 M2：拿掉上限 ⇒ 固定全正面時真的停不下來（抽了 ${r.calls} 次亂數後被預算擋下）`,
        !r.ok && r.err.includes('COIN_RUNAWAY'));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑨ HEAD-FAIL ＋「計算未變」的逐位元組證明（需要完整 clone；淺複製 SKIP）');
if (!HAS_BASE) {
  console.log('  SKIP 本機物件庫沒有 BASE 這顆 commit（淺複製 / CI）⇒ 這一節只在完整 clone 才跑');
} else {
  const baseEngine = git(['cat-file', '-p', `${BASE}:src/lib/game/engine.ts`]);
  const baseEst = git(['cat-file', '-p', `${BASE}:src/lib/game/damage-estimate.ts`]);
  const baseV2355 = git(['cat-file', '-p', `${BASE}:src/lib/game/effects/cards/v2355_j_mark_batch.ts`]);
  chk('取得 BASE 的三個檔', baseEngine.ok && baseEst.ok && baseV2355.ok);
  // HEAD-FAIL：BASE 版本一定通不過②④⑤
  chk('HEAD-FAIL：BASE 的 engine.ts 用的是「屬性相剋」（②會紅）', baseEngine.out.includes("label: '屬性相剋'"));
  chk('HEAD-FAIL：BASE 的文案是「（擲到反面為止，無上限）」（④會紅）', baseEst.out.includes('擲到反面為止，無上限'));
  chk('HEAD-FAIL：BASE 的怪顎龍｜亂暴 是沒有上限的 while (true)（⑤⑥會紅）',
      /亂暴[\s\S]{0,400}while \(true\) \{/.test(baseV2355.out) && !baseV2355.out.includes(CENTRAL));
  // ⭐⭐ 計算未變的最強證明：把新增的那段 label 註解與字串**原樣回推**，
  //     必須與 BASE 的 engine.ts **逐位元組相同** ⇒ 這一版對 engine.ts 只動了顯示文字。
  const NEWBLOCK = SRC.engine.slice(
    SRC.engine.indexOf('        // v6.234：label 改用**卡面官方用語**'),
    SRC.engine.indexOf("label: '抵抗力' });") + "label: '抵抗力' });".length);
  const OLDLINE = "        formula.push({ sign: '-', value: Math.abs(resistDelta), label: '屬性相剋' });";
  chk('回推定位成功（找得到 v6.234 新增的那一段）', NEWBLOCK.length > 100 && SRC.engine.split(NEWBLOCK).length === 2);
  chk('⭐⭐ 把新 label 段回推成舊的一行後，engine.ts 與 BASE 逐位元組完全相同 ⇒ 計算行為不可能改變',
      SRC.engine.replace(NEWBLOCK, OLDLINE) === baseEngine.out);
}

console.log(`\n[v6234-resistance-label-and-coin-cap] PASS ${n - bad} / FAIL ${bad}`);
process.exit(bad ? 1 : 0);
