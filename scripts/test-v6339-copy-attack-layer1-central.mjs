// v6.339 守衛 —— 借招家族「第 1 層」的候選枚舉也收斂到中央（UI 不再自己手寫規則）
//
// v6.337 把**第 2 層以後**收斂進 `copyAttackCandidates`，但**第 1 層**仍有 6 份手寫規則：
//   暗黑底牌 `startsWith('N的')`／扮晶晶酒 `tags.includes('太晶')`／
//   耀閃挑戰 `supertype==='Pokemon' && !RULE_BOX`／揮指族 `a.name !== atk.name`
//   （只比招式名 ⇒ 將來進一張招式同名的卡就會誤排除）／技能大盜 `active+bench`／
//   高傲指令 `deck.slice(0,10)`。六份各自演化 ⇒「畫面畫得出來的」與「規則層認的」遲早對不上。
//
// v6.339：第 1 層也呼叫 `advanceBorrowChain(attackIndex, [], selfKey)`，
//   候選一律來自中央 `copyAttackCandidates`；各卡原本的專屬 modal 保留，只是清單換成中央那一份。
//
// 判準釘在**結構**上：
//   【A】+page.svelte 只能有**一個** copyAttackCandidates 呼叫點，而且必須在 advanceBorrowChain 裡。
//   【B】三個專屬 modal 的招式按鈕都要依 allowed 過濾（附突變測試，不是安慰劑）。
//   【C】行為端：8 個 key 都要真的被 isCopyAttackKey 認得，而且在代表性盤面上枚舉得出候選
//        —— 否則泛用分支不會觸發，那張卡會靜默退回「engine 自己挑最高傷害」。
//   【D】HEAD-FAIL：對 BASE(v6.338) 的 +page.svelte，【A】【B】必須紅。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
// ⚠ 判準要看**程式碼**，不能看註解 —— 這支守衛自己的說明文字裡就寫著
//   `startsWith('N的')` 之類的字樣，不剝註解的話會抓到自己的註解而誤紅。
import { stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '87f90e023137fa027ef6495a70f8008d8a08ea88';   // v6.338（v6.339 的上一版）
const PAGE_REL = 'src/routes/game/+page.svelte';

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; } else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};

const pageRaw = readFileSync(join(ROOT, PAGE_REL), 'utf8');
/** 所有判準一律套在**剝掉註解**的版本上（BASE 也一樣 ⇒ HEAD-FAIL 才對稱）。 */
const page = stripCommentsBlank(pageRaw);

// ── 共用的判準函式（同一份，HEAD 與 BASE 都套用它 ⇒ HEAD-FAIL 才有意義）──────────
/** 取出 `function name(` 到下一個同縮排 `\n  }` 為止的函式本文。 */
function fnBody(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return '';
  const j = src.indexOf('\n  }', i);
  return j > i ? src.slice(i, j) : '';
}
const CRITERIA = {
  /** copyAttackCandidates 只能被呼叫一次，而且必須在 advanceBorrowChain 裡。 */
  singleCallSite(src) {
    const n = src.split('copyAttackCandidates(').length - 1;
    const inFn = fnBody(src, 'function advanceBorrowChain(').includes('copyAttackCandidates(');
    return { ok: n === 1 && inFn, detail: `呼叫點 ${n} 個，在 advanceBorrowChain 裡＝${inFn}` };
  },
  /** 打招式的入口必須用泛用分支，不可以再有每張卡各自的 intercept。 */
  genericEntry(src) {
    const generic = /isCopyAttackKey\(_selfBorrowKey\)/.test(src)
      && /advanceBorrowChain\(attackIndex, \[\], _selfBorrowKey\)/.test(src);
    const perCard = ["atk.name === '暗黑底牌'", "atk.name === '扮晶晶酒'", "atk.name === '耀閃挑戰'",
      "atk.name === '技能大盜'", "atk.name === '揮指'", "atk.name === '高傲指令'"]
      .filter(s => src.includes(s));
    return { ok: generic && perCard.length === 0, detail: `泛用分支＝${generic}；殘留的每卡 intercept：${perCard.join('、') || '無'}` };
  },
  /** UI 不可以自己重寫「可以借誰」的卡面規則。 */
  noHandWrittenRule(src) {
    const bad = [
      ["startsWith('N的')", /startsWith\('N的'\)/],
      ['太晶 tag 檢查', /tags \?\? \[\]\)\.includes\('太晶'\)/],
      ['對手牌庫頂 10 張', /players\[1 - myIdx\]\.deck;[\s\S]{0,80}slice\(0, 10\)/],
      ['同名招式排除', /filter\(a => a\.name && a\.name !== atk\.name\)/],
    ].filter(([, re]) => re.test(src)).map(([n]) => n);
    return { ok: bad.length === 0, detail: bad.join('、') || '無' };
  },
  /** 三個專屬 modal 的招式按鈕都要依 allowed 過濾。 */
  modalsFiltered(src) {
    const miss = [
      ['暗黑底牌', /copyAttackPicker\.allowed\.get\(cand\.inst\.iid\)\?\.has\(aIdx\)/],
      ['扮晶晶酒', /personateAttackPicker\.allowed\.get\(op\.inst\.iid\)\?\.has\(aIdx\)/],
      ['耀閃挑戰', /brightChallengePicker\.allowed\.get\(tp\.inst\.iid\)\?\.has\(aIdx\)/],
    ].filter(([, re]) => !re.test(src)).map(([n]) => n);
    return { ok: miss.length === 0, detail: miss.join('、') || '無' };
  },
  /** 卡面寫「若希望」的借招不可以套用「只有 1 個候選就自動用」的 fast-path。 */
  optionalNoFastPath(src) {
    const gated = /if \(cands\.length === 1 && !OPTIONAL_BORROW_KEYS\.has\(borrowedKey\)\)/.test(src);
    const declared = /const OPTIONAL_BORROW_KEYS = new Set\(\[ROCKET_COMMAND_KEY\]\)/.test(src);
    return { ok: gated && declared, detail: `fast-path 有擋＝${gated}；集合有宣告＝${declared}` };
  },
  /** 高傲指令「翻到正面」的公開揭示不可以在收斂時弄丟。 */
  rocketReveal(src) {
    const ok = /function _rocketTop10All\(\)/.test(src)
      && /revealOnly: true/.test(src)
      && /top10All: _rocketTop10All\(\)/.test(src);
    return { ok, detail: String(ok) };
  },
};

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】第 1 層的候選枚舉必須來自中央（UI 只有一個呼叫點）');
for (const [k, label] of [
  ['singleCallSite', 'A1 copyAttackCandidates 在 +page.svelte 只有一個呼叫點，且在 advanceBorrowChain 裡'],
  ['genericEntry', 'A2 打招式的入口是泛用分支，沒有殘留的每卡 intercept'],
  ['noHandWrittenRule', 'A3 UI 不再自己重寫「可以借誰」的卡面規則'],
  ['optionalNoFastPath', 'A4 ⭐「若希望」的借招不可以只有 1 個候選就自動幫玩家複製（那等於剝奪「不複製」）'],
]) {
  const r = CRITERIA[k](page);
  chk(label, r.ok, r.detail);
}

console.log('\n【B】專屬 modal 畫出來的招式＝規則層認的');
{
  const r = CRITERIA.modalsFiltered(page);
  chk('B1 三個專屬 modal 的招式按鈕都依 allowed 過濾', r.ok, r.detail);
  const r2 = CRITERIA.rocketReveal(page);
  chk('B2 高傲指令「翻到正面」的 10 張公開揭示仍在（收斂時最容易弄丟的東西）', r2.ok, r2.detail);
  // 突變：拿掉扮晶晶酒那一行過濾 ⇒ B1 必須紅（證明 B1 不是安慰劑）
  const mutated = page.replace(
    /\{#if !personateAttackPicker\.allowed \|\| \(personateAttackPicker\.allowed\.get\(op\.inst\.iid\)\?\.has\(aIdx\) \?\? false\)\}\r?\n/, '');
  chk('B3 ⭐突變：拿掉扮晶晶酒的 allowed 過濾 ⇒ B1 必須紅（反安慰劑）',
    mutated !== page && CRITERIA.modalsFiltered(mutated).ok === false);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】行為端：8 個 key 都要被認得，而且枚舉得出候選');

const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });
async function bundleEngine() {
  const src = join(ROOT, 'src');
  const parent = dirname(src);
  const p = './' + src.slice(parent.length + 1).replace(/\\/g, '/');
  const S = join(parent, '.v6339-s.js'), E = join(parent, '.v6339-e.ts'), O = join(parent, '.v6339-o.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";');
  writeFileSync(E,
    `export { copyAttackCandidates, isCopyAttackKey, COPY_ATTACK_KEYS } from '${p}/lib/game/copy-attack';\n`
    + `import '${p}/lib/game/effects';\n`);
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(src, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}
const CA = await bundleEngine();

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, pred = () => true) => [...pool.values()].find(c => c.name === n && pred(c));
const DRAGA = byName('多龍巴魯托ex', c => (c.tags ?? []).includes('太晶') && (c.attacks ?? []).length >= 2);
const MIMIKYU = byName('火箭隊的謎擬Ｑ', c => (c.attacks ?? []).some(a => a.name === '扮晶晶酒'));
const NBENCH = [...pool.values()].find(c => c.name?.startsWith('N的') && c.name !== 'N的索羅亞克ex' && (c.attacks ?? []).length >= 2);
chk('C0 fixture：對照卡都抓得到', !!(DRAGA && MIMIKYU && NBENCH));

let seq = 0;
const inst = (id, extra = {}) => ({ cardId: String(id), iid: 'i' + (++seq), damage: 0, energyAttached: [], toolAttached: null, ...extra });
const board = ({ myBench = [], myDeck = [], myHand = [], oppBench = [], oppDeck = [] }) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  players: [
    { name: 'P1', active: inst(DRAGA.id), bench: myBench, hand: myHand, deck: myDeck, discard: [], prizes: [] },
    { name: 'P2', active: inst(DRAGA.id), bench: oppBench, hand: [], deck: oppDeck, discard: [], prizes: [] },
  ],
});

chk('C1 COPY_ATTACK_KEYS 剛好 8 個 key', CA.COPY_ATTACK_KEYS.length === 8, String(CA.COPY_ATTACK_KEYS.length));
chk('C2 8 個 key 都被 isCopyAttackKey 認得（認不得 ⇒ 泛用分支不觸發，那張卡靜默退回自動挑招）',
  CA.COPY_ATTACK_KEYS.every(k => CA.isCopyAttackKey(k)),
  CA.COPY_ATTACK_KEYS.filter(k => !CA.isCopyAttackKey(k)).join('、'));
{
  // 一個「什麼都有」的盤面：對手戰鬥場是太晶、對手備戰與牌庫頂都有寶可夢、
  // 自己牌庫頂是寶可夢、自己備戰有「N的」、自己手牌 0 張。
  const st = board({
    myBench: [inst(NBENCH.id)],
    myDeck: [inst(MIMIKYU.id)],
    myHand: [],
    oppBench: [inst(DRAGA.id)],
    oppDeck: Array.from({ length: 12 }, () => inst(DRAGA.id)),
  });
  const empty = CA.COPY_ATTACK_KEYS.filter(k => CA.copyAttackCandidates(k, st, 0, pool, 0).length === 0);
  chk('C3 ⭐在「什麼都有」的盤面上，8 個 key 都枚舉得出候選（0 個 ⇒ 那張卡的 picker 永遠不會開）',
    empty.length === 0, empty.join('、'));
}

{
  // ⭐ 把「哪些借招是『若希望』」這件事釘回**官方卡面文字**：
  //   未來進了第二張「若希望」的借招卡，這條會紅，提醒把它加進 OPTIONAL_BORROW_KEYS。
  const optionalByCardText = CA.COPY_ATTACK_KEYS.filter(k => {
    const [cn, an] = k.split('|');
    const c = byName(cn, x => (x.attacks ?? []).some(a => a.name === an));
    const eff = c?.attacks?.find(a => a.name === an)?.effect ?? '';
    return eff.includes('若希望');
  });
  chk('C4 ⭐卡面寫「若希望」的借招剛好只有「高傲指令」（UI 的 OPTIONAL_BORROW_KEYS 必須與卡面一致）',
    optionalByCardText.length === 1 && optionalByCardText[0] === '火箭隊的貓老大ex|高傲指令',
    optionalByCardText.join('、') || '一張都沒有 ⇒ 卡面文字抓錯了');
  const declared = [...(page.match(/const OPTIONAL_BORROW_KEYS = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '').matchAll(/ROCKET_COMMAND_KEY/g)].length;
  chk('C5 UI 宣告的「若希望」集合剛好 1 個（與 C4 的卡面結論一致）', declared === 1, String(declared));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】HEAD-FAIL：對 BASE(' + BASE_SHA.slice(0, 8) + ' ＝ v6.338) 的 +page.svelte');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【D】HEAD-FAIL 對 BASE 的比對', '需要歷史 commit；【A】【B】【C】不需要歷史，仍在守');
} else {
  const b = readBaseBlob(ROOT, BASE_SHA, PAGE_REL);
  chk('D0 讀得到 BASE 的 +page.svelte', b.ok === true);
  if (b.ok) {
    const base = stripCommentsBlank(b.out);
    const reds = [];
    for (const k of ['singleCallSite', 'genericEntry', 'noHandWrittenRule', 'optionalNoFastPath', 'modalsFiltered']) {
      if (!CRITERIA[k](base).ok) reds.push(k);
    }
    console.log('      BASE 上紅掉的判準：' + (reds.length ? reds.join('／') : '（無）'));
    chk('D1 ⭐⭐⭐ BASE 上 A1/A2/A3/A4/B1 五條**全部**必須紅（本版真的收斂了東西）',
      reds.length === 5, reds.join('／') || '一條都沒紅');
    chk('D2 ⭐Rule 41 哨兵：高傲指令的公開揭示在 BASE 上本來就存在（不是本版才加的）',
      /revealOnly: true/.test(base));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
{
  const v = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
  chk('E1 版本已 bump 到 6.339 以上', /VERSION = '6\.(339|3[4-9]\d|[4-9]\d\d)'/.test(v),
    v.match(/VERSION = '[^']+'/)?.[0] ?? '');
}

console.log(`\nv6.339 第 1 層借招收斂守衛：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
