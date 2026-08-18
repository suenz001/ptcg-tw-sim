// ⭐⭐⭐ v6.210 卡片述詞收斂鎖 —— 「基本能量屬性」與「Mega ex」不得再出現逐字複本
//
// 背景：v6.209 掃出兩族**卡名字串**判斷散在全站：
//   ① `supertype==='Energy' && subtype==='Basic' && name.includes('【X】')` ≈ 中央
//      `isBasicEnergyOfType`（selection-filter.ts）的逐字複本（基本能量 pokemonType 恒 null，
//      屬性只能從卡名【X】推 —— v6.008 事故）。
//   ② `name.startsWith('超級')` ≈ 中央 `isMegaExCard`。單獨用會誤判現役的
//      「超級信號」(Item)／「超級烈空坐帽子」(PokemonTool)，過去靠各站點自己再配
//      `subtype==='ex'` 擋住 —— 今天沒 bug，但是漂移溫床。
// v6.210 把兩族全部收斂到中央述詞。本檔是**防復發鎖**，四段：
//   A) 等價鎖：把被換掉的**歷史字面量表達式**逐一凍結，與中央述詞在全現役卡池逐張比對，
//      必須 0 mismatch —— 中央述詞日後若漂走（例如有人拿掉卡名 fallback），這裡先紅。
//   B) 禁複本掃描（否定型 ＋ 掃描器自我驗證正對照 ＋ 下限斷言 ＋ 剝註解/零寬字元）。
//   C) 消費端覆蓋：中央述詞的呼叫點數量下限 —— 防「改回去中央化」時 B 段照樣全綠（零偵測）。
//   D) 行為端接線：AI 的 `Energy:<T>` 牌庫搜尋必須真的選得到基本能量
//      （v6.210 修的真 bug：t 是英文 'Fire'，舊碼拼出「【Fire】」永遠對不上台灣卡名）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.cp-e.ts'), O = join(ROOT, '.cp-o.mjs'), S = join(ROOT, '.cp-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { isBasicEnergyOfType, isMegaExCard, isRulePokemon } from './src/lib/game/selection-filter';\n`
  + `export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { isBasicEnergyOfType, isMegaExCard, isRulePokemon, getAIAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const all = [], pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) { all.push(c); pool.set(String(c.id), c); } }

let pass = 0, fail = 0;
const ck = (l, c, e) => { if (c) { pass++; console.log('  PASS', l); } else { fail++; console.log('  FAIL', l, e ?? ''); } };

console.log('0) 下限斷言');
ck('0a 現役卡池 ≥4000 張（讀不到卡＝整份測試變安慰劑）', all.length >= 4000, '只有 ' + all.length);
ck('0b 現役有基本能量（8 屬性）＋特殊能量（卡名也含【X】，正是 Basic 護欄的理由）',
  all.some(c => c.supertype === 'Energy' && c.subtype === 'Basic' && /【火】/.test(c.name))
  && all.some(c => c.supertype === 'Energy' && c.subtype !== 'Basic' && /【/.test(c.name)));
ck('0c 現役有 Mega ex ＋ 以「超級」開頭的**非**寶可夢卡（超級信號／超級烈空坐帽子）',
  all.some(c => c.subtype === 'ex' && c.name.startsWith('超級'))
  && all.some(c => c.name.startsWith('超級') && c.supertype !== 'Pokemon'));

// ══════════════ A) 等價鎖：歷史字面量 vs 中央述詞（全卡池逐張） ══════════════
console.log('\nA) 等價鎖（v6.210 換掉的歷史表達式 × 全現役卡池）');
let cmpPoints = 0;
const eq = (label, oldF, newF) => {
  const bad = [];
  for (const c of all) { cmpPoints++; if (!!oldF(c) !== !!newF(c)) bad.push(`${c.name}#${c.id}`); }
  ck(`A ${label}`, bad.length === 0, bad.slice(0, 6).join(', '));
};
const nm = c => c.name ?? '';
const BE = t => c => isBasicEnergyOfType(c, t);
for (const [t, zh] of [['Grass', '草'], ['Fire', '火'], ['Water', '水'], ['Lightning', '雷'],
                       ['Psychic', '超'], ['Metal', '鋼'], ['Darkness', '惡']]) {
  eq(`型A ${t}：Energy&&Basic&&(pokemonType===T||name【${zh}】)`,
    c => c.supertype === 'Energy' && c.subtype === 'Basic' && (c.pokemonType === t || nm(c).includes(`【${zh}】`)), BE(t));
  eq(`型B ${t}：Energy&&Basic&&name【${zh}】（無 pokemonType 分支）`,
    c => c.supertype === 'Energy' && c.subtype === 'Basic' && nm(c).includes(`【${zh}】`), BE(t));
}
eq('型A Fighting（歷史版同時收【鬥】與【格】）',
  c => c.supertype === 'Energy' && c.subtype === 'Basic'
    && (c.pokemonType === 'Fighting' || nm(c).includes('【鬥】') || nm(c).includes('【格】')), BE('Fighting'));
eq('超級型1 Pokemon&&subtype ex&&startsWith超級', c => c.supertype === 'Pokemon' && c.subtype === 'ex' && nm(c).startsWith('超級'), isMegaExCard);
eq('超級型2 subtype ex&&startsWith超級', c => c.subtype === 'ex' && nm(c).startsWith('超級'), isMegaExCard);
eq('超級型3 endsWith(ex)&&startsWith超級', c => nm(c).endsWith('ex') && nm(c).startsWith('超級'), isMegaExCard);
eq('超級型4 (endsWith ex||EX)&&startsWith超級', c => (nm(c).endsWith('ex') || nm(c).endsWith('EX')) && nm(c).startsWith('超級'), isMegaExCard);
eq('超級型5 startsWith超級&&(subtype ex||endsWith ex)', c => nm(c).startsWith('超級') && (c.subtype === 'ex' || nm(c).endsWith('ex')), isMegaExCard);
eq('超級型6 Pokemon&&startsWith超級&&includes(ex)', c => c.supertype === 'Pokemon' && nm(c).startsWith('超級') && nm(c).includes('ex'), isMegaExCard);
eq('超級型7 startsWith超級&&/ex|ＥＸ/i（AI 評分那份）', c => nm(c).startsWith('超級') && /ex|ＥＸ/i.test(nm(c)), isMegaExCard);
eq('超級型8 prizesForKOLocal：isRulePokemon&&startsWith超級',
  c => isRulePokemon(c) && nm(c).startsWith('超級'), c => isRulePokemon(c) && isMegaExCard(c));
ck('A0 等價鎖比對點 ≥60000（掃太少＝卡池沒讀進來）', cmpPoints >= 60000, '只有 ' + cmpPoints);

// ══════════════ B) 禁複本掃描 ══════════════
console.log('\nB) 禁複本掃描（否定型 ＋ 自我驗證正對照）');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/.*$/gm, '').replace(/[\u200b-\u200d\ufeff]/g, '');
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p);
  if (st.isDirectory()) walk(p, out); else if (f.endsWith('.ts') || f.endsWith('.svelte')) out.push(p); } return out; };
const FILES = [...walk(join(ROOT, 'src/lib')), ...walk(join(ROOT, 'src/routes'))]
  .map(p => [relative(ROOT, p).split('\\').join('/'), readFileSync(p, 'utf8')]);
ck('B0 掃描器下限：掃到 ≥60 個 .ts/.svelte 檔（掃不到檔＝掃描器壞了）', FILES.length >= 60, '只有 ' + FILES.length);

/** ① 基本能量屬性逐字複本：`name.includes('【X】')` 且鄰近同時有 Energy ＋ Basic 判斷 */
const scanEnergyDup = files => {
  const hits = [];
  for (const [rel, text] of files) {
    const lines = stripComments(text).split('\n');
    lines.forEach((ln, i) => {
      if (!/\.name(\?)?\.includes\(\s*[`'][^`']*【/.test(ln)) return;
      const win = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
      if (/supertype\s*[!=]==\s*'Energy'/.test(win) && /subtype\s*[!=]==\s*'Basic'/.test(win)) {
        hits.push({ rel, line: i + 1, src: ln.trim().slice(0, 110) });
      }
    });
  }
  return hits;
};
/** ② Mega ex 逐字複本：`startsWith('超級')`（豁免＝中央定義本身 ＋ 兩處純字串去前綴） */
const MEGA_EXEMPT = new Map(Object.entries({
  'src/lib/game/selection-filter.ts': '中央述詞 isMegaExCard 的定義本身',
  'src/lib/cards/evolutionChain.ts': '不是在判「是不是 Mega ex」，是把「超級」前綴**切掉**求進化鏈同源名（n.slice(2)）',
  'src/lib/game/effects/_shared.ts': '同上：卡名去「超級」前綴（r.slice(2)），純字串處理',
}));
const scanMegaDup = files => {
  const hits = [];
  for (const [rel, text] of files) {
    const lines = stripComments(text).split('\n');
    lines.forEach((ln, i) => {
      if (!/startsWith\(\s*'超級'\s*\)/.test(ln)) return;
      hits.push({ rel, line: i + 1, src: ln.trim().slice(0, 110), exempt: MEGA_EXEMPT.has(rel) });
    });
  }
  return hits;
};
/**
 * ③ **同族的另一種寫法**：`/【X】/.test(name)`（正則形）。
 * ⚠ v6.210 的第一輪 opus 審查抓到：B1 的 `.includes('【X】')` 判準**看不到正則形**，
 *   而全站還有一批這樣寫的（多數同樣配了 Energy＋Basic 護欄）。
 *   本輪授權範圍只到 `.includes` 那一族（v6.209 列的清單），正則形**逐處判讀後留待下一輪**
 *   （其中至少 `ai.ts` 波動突刺那處**沒有** Basic 護欄，語義是「這張能量提不提供【鬥】」，
 *    不能一律換 —— 正是「不要一律換」的理由）。
 * ⇒ 這裡放**棘輪（ratchet）**：數量只准降不准升，讓這一族不會再長大，
 *   而不是假裝它已經乾淨（否則 B1 就是一個有系統性假陰性的安慰劑）。
 */
const scanEnergyRegexDup = files => {
  const hits = [];
  for (const [rel, text] of files) {
    const lines = stripComments(text).split('\n');
    lines.forEach((ln, i) => {
      if (!/\/[^/\n]*【[^/\n]*\/\s*\.\s*test\s*\(/.test(ln)) return;
      hits.push({ rel, line: i + 1, src: ln.trim().slice(0, 110) });
    });
  }
  return hits;
};
const REGEX_FORM_FROZEN = 44;   // v6.210 實測值（只准降不准升）
{
  const dup = scanEnergyDup(FILES);
  ck('B1 全站不得再有「基本能量屬性」逐字複本 → 一律改呼叫 isBasicEnergyOfType',
    dup.length === 0, dup.map(h => `${h.rel}:${h.line} ${h.src}`).join('\n    '));
  const mg = scanMegaDup(FILES);
  const bad = mg.filter(h => !h.exempt);
  ck('B2 全站不得再有 startsWith(\'超級\') 判 Mega ex → 一律改呼叫 isMegaExCard',
    bad.length === 0, bad.map(h => `${h.rel}:${h.line} ${h.src}`).join('\n    '));
  ck('B3 豁免表不得有死條目（該檔已不再出現 startsWith(\'超級\') ⇒ 應從表刪掉）',
    [...MEGA_EXEMPT.keys()].every(k => mg.some(h => h.rel === k)),
    '死條目：' + [...MEGA_EXEMPT.keys()].filter(k => !mg.some(h => h.rel === k)).join(', '));
  ck('B4 豁免的三處確實存在（掃描器看得到它們＝掃描器沒瞎）', mg.filter(h => h.exempt).length >= 3, '只有 ' + mg.filter(h => h.exempt).length);
  const rx = scanEnergyRegexDup(FILES);
  ck(`B4b 掃描器下限：正則形（/【X】/.test）掃得到 ≥30 處（掃到 0 ＝ 這條棘輪是死的）`, rx.length >= 30, '只有 ' + rx.length);
  ck(`B4c ★棘輪：正則形「基本能量屬性」判斷不得增加（凍結 ${REGEX_FORM_FROZEN}，實測 ${rx.length}）`
      + ' —— 收斂掉之後請把 REGEX_FORM_FROZEN 一起調降',
    rx.length <= REGEX_FORM_FROZEN,
    '新增了 ' + (rx.length - REGEX_FORM_FROZEN) + ' 處：\n    '
      + rx.map(h => `${h.rel}:${h.line} ${h.src}`).join('\n    '));
}
// ── 掃描器自我驗證（正對照：餵違規樣本必須抓到；餵合規樣本不得誤報）──
{
  const v1 = [['fake/a.ts', "const ok = card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【火】');"]];
  ck('B5 正對照：單行違規樣本必須被 B1 抓到', scanEnergyDup(v1).length === 1);
  const v2 = [['fake/b.ts', "if (card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;\nreturn card.name?.includes('【水】') ?? false;"]];
  ck('B6 正對照：跨行（先 !== 早退再 includes）違規樣本也要抓到', scanEnergyDup(v2).length === 1);
  const v3 = [['fake/c.ts', "return isBasicEnergyOfType(card, 'Fire');"]];
  ck('B7 反向：合規寫法不得被誤報', scanEnergyDup(v3).length === 0);
  const v4 = [['fake/d.ts', "// return card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【火】');\n"
    + "/* card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【草】') */"]];
  ck('B8 剝註解：註解裡的樣本不得被算進來', scanEnergyDup(v4).length === 0);
  const v5 = [['fake/e.ts', "return card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【火\u200b】');"]];
  ck('B9 剝零寬字元：混了零寬的違規樣本仍要抓到（v6.117 事故）', scanEnergyDup(v5).length === 1);
  const v6 = [['fake/f.ts', "if (c.name.startsWith('超級') && c.subtype === 'ex') return 3;"]];
  ck('B10 正對照：startsWith(\'超級\') 違規樣本必須被 B2 抓到（且不在豁免表）',
    scanMegaDup(v6).length === 1 && scanMegaDup(v6)[0].exempt === false);
  const v7 = [['fake/g.ts', "if (isMegaExCard(c)) return 3;"]];
  ck('B11 反向：合規寫法不得被誤報', scanMegaDup(v7).length === 0);
  const v8 = [['fake/h.ts', "return ec.pokemonType === 'Grass' || /【草】/.test(ec.name);"]];
  ck('B12 正對照：正則形樣本必須被 B4c 的掃描器抓到（B1 的 includes 判準看不到它）',
    scanEnergyRegexDup(v8).length === 1 && scanEnergyDup(v8).length === 0);
  // ⚠ 若 stripComments 壞掉（例如改成不剝註解），B8 會紅；若 regex 寫死行內，B6 會紅。
}

// ══════════════ C) 消費端覆蓋（防「去中央化」時 B 段假綠） ══════════════
console.log('\nC) 中央述詞的消費端覆蓋（B 段是否定型，沒有這段就會「全刪光也全綠」）');
{
  const count = re => FILES.reduce((n, [, t]) => n + (stripComments(t).match(re) ?? []).length, 0);
  const cBE = count(/\bisBasicEnergyOfType\s*\(/g);
  const cME = count(/\bisMegaExCard\s*\(/g);
  // ⚠ v6.210 第二輪審查：門檻原本訂在 45/22（實測 106/31）⇒ 「把一半改回手刻」照樣綠。
  //   改成**棘輪**（貼著實測值，只准升不准降）；日後合理增減請連同這兩個數字一起改，
  //   逼人回來說明「為什麼中央述詞的消費點變少了」。
  ck(`C1 ★棘輪：isBasicEnergyOfType 呼叫點 ≥100（實測 ${cBE}）`, cBE >= 100, '只有 ' + cBE);
  ck(`C2 ★棘輪：isMegaExCard 呼叫點 ≥30（實測 ${cME}）`, cME >= 30, '只有 ' + cME);
  // ⚠ 第二輪審查：C3 原本掃**整個檔**有沒有 `/【(.+?)】/` ⇒ 把 isBasicEnergyOfType 的
  //   fallback 拿掉後，getBasicEnergyType 裡同樣的正則仍讓它綠（安慰劑）。改成只看函式本體。
  const sf = FILES.find(([r]) => r === 'src/lib/game/selection-filter.ts')?.[1] ?? '';
  const bodyStart = sf.indexOf('export function isBasicEnergyOfType');
  const body = bodyStart > 0 ? sf.slice(bodyStart, sf.indexOf('\n}', bodyStart)) : '';
  ck('C3 中央述詞 isBasicEnergyOfType **本體**仍保有「卡名【X】」fallback（基本能量 pokemonType 恒 null）',
    bodyStart > 0 && body.length > 0 && body.length < 800 && /【\(\.\+\?\)】/.test(body),
    'body=' + JSON.stringify(body.slice(0, 200)));
  ck('C3b 正對照：判準抓得到「fallback 被拿掉」的樣本',
    !/【\(\.\+\?\)】/.test("export function isBasicEnergyOfType(ec, type) {\n  return ec?.pokemonType === type;"));
  // ⚠ 範圍聲明：本輪只收斂 `isBasicEnergyOfType` / `isMegaExCard` 兩族。
  //   `+page.svelte` / `MobilePortraitBattle.svelte` 內另有「卡名【X】→ EnergyType」的 zhMap
  //   （＝中央 `getBasicEnergyType` 的複本，用於能量計數顯示）＝**第三族**，不在本輪授權內，
  //   故本檔不掃它 —— 但 UI 那份 `isBasicEnergyOfType` 的本地定義（含自帶 ZH_BY_TYPE）必須已消失。
  const sv = stripComments(FILES.find(([r]) => r === 'src/routes/game/+page.svelte')?.[1] ?? '');
  ck('C4 UI 端不得再自帶一份 isBasicEnergyOfType 的完整實作（ZH_BY_TYPE 對照表已刪，改薄殼委派中央）',
    !/ZH_BY_TYPE/.test(sv) && /isBasicEnergyOfTypeCentral\s*\(/.test(sv),
    'ZH_BY_TYPE 還在？' + /ZH_BY_TYPE/.test(sv) + ' / 有委派中央？' + /isBasicEnergyOfTypeCentral\s*\(/.test(sv));
}

// ══════════════ D) 行為端接線（v6.210 修的真 bug） ══════════════
console.log('\nD) 行為端：AI 的 `Energy:<T>` 牌庫搜尋必須選得到基本能量');
{
  const FIRE = [...pool].find(([, c]) => c.name === '基本【火】能量')?.[0];
  const FILL = [...pool].find(([, c]) => c.name === '咕咕')?.[0];
  ck('D0 fixture 基本【火】能量／咕咕 都在現役卡池', !!FIRE && !!FILL);
  let n = 0; const I = cid => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [] });
  const mkSt = (filter) => {
    n = 0;
    const deck = [I(FILL), I(FIRE), I(FILL)];
    return { st: { phase: 'playing', turnPhase: 'main', activePlayerIndex: 1, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      log: [], setupDone: [true, true], pendingPrizes: [0, 0], activeStadium: null, stadiumUsedThisTurn: [true, true],
      players: [{ name: 'A', active: I(FILL), bench: [], hand: [], deck: [I(FILL)], discard: [], prizes: [] },
                { name: 'B', active: I(FILL), bench: [], hand: [], deck, discard: [], prizes: [] }],
      pendingSelection: { type: 'deck-search', actorIdx: 1, sourcePlayerIdx: 1, filter,
        minCount: 0, maxCount: 1, effectKey: 'v6210-probe', params: {} } }, fireIid: deck[1].iid };
  };
  const a1 = mkSt('Energy:Fire');
  const r1 = getAIAction(a1.st, pool, 1);
  ck('D1 ★AI `Energy:Fire` 牌庫搜尋：必須選中那張基本【火】能量（HEAD 選 0 張＝v6.210 修的 bug）',
    r1?.type === 'RESOLVE_SELECTION' && (r1.selectedIids ?? []).length === 1
    && r1.selectedIids[0] === a1.fireIid, JSON.stringify(r1));
  const a2 = mkSt('BasicEnergy:Fire');
  const r2 = getAIAction(a2.st, pool, 1);
  ck('D2 正對照：`BasicEnergy:Fire`（本來就走中央述詞的那條）行為一致',
    r2?.type === 'RESOLVE_SELECTION' && (r2.selectedIids ?? []).length === 1
    && r2.selectedIids[0] === a2.fireIid, JSON.stringify(r2));
  const a3 = mkSt('Energy:Water');
  const r3 = getAIAction(a3.st, pool, 1);
  ck('D3 反安慰劑：`Energy:Water`（牌庫沒有基本【水】能量）仍必須選 0 張',
    r3?.type === 'RESOLVE_SELECTION' && (r3.selectedIids ?? []).length === 0, JSON.stringify(r3));
}

console.log('\n中央卡片述詞收斂鎖 PASS ' + pass + ' / FAIL ' + fail);
console.log('SCRIPT_END_MARKER test-v6210-central-card-predicate-convergence');
process.exitCode = fail ? 1 : 0;
