// v6.192 守衛：「括號冠名的藝術版本」與本名**共用同一份 4 張額度**（站長 2026-08-15 裁定）
//
//   「老大的指令 和『老大的指令（烏羽）』算同名卡」
//
// ⚠⚠ 這支守衛一律**實跑 validateDeck**（v6.154 教訓：只驗字串存在／只驗「有呼叫某函式」
//     擋不住接線沒接上）。核心那條是：老大的指令×4 ＋（烏羽）×4 ⇒ **不合法**。
//
// ⚠⚠ 正對照同樣重要（防止修過頭）：
//   ・**前綴**冠名 —— 官方裁定 `PTCG RULES/PTCG_RULES.md` L2686
//     「達摩狒狒」和「N的達摩狒狒」視為兩種不同名稱 ⇒ 各 4 張，合計 8 張**必須仍然合法**。
//   ・ex / 非 ex 卡名不同 ⇒ 各自獨立 4 張。
//   ・兩張合一場地（傳說的◯◯）左右同名 ⇒ 合計 ≤4（＝2 套）的既有行為不變。
//   ・Reprint exception（G 標「老大的指令」等）不受影響。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6192-s.js'), E = join(ROOT, '.v6192-e.ts'), O = join(ROOT, '.v6192-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { validateDeck, sameNameTotal, remainingCapacity, sameNameKey, SAME_NAME_PAREN_EXCEPTIONS, isStandardReprintLegal } from './src/lib/decks/validation';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { validateDeck } = M;
// HEAD-FAIL 安全：BASE 沒有 sameNameKey，用「原樣回傳」當 fallback ⇒ 斷言會紅而不是爆炸
const sameNameKey = M.sameNameKey ?? ((n) => String(n ?? ''));
const sameNameTotal = M.sameNameTotal;
const remainingCapacity = M.remainingCapacity;
const PAREN_EXCEPTIONS = M.SAME_NAME_PAREN_EXCEPTIONS ?? new Set();

// ── 卡庫（只取 index.json 列出的 live 卡包，與站上載入的一致）──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const byId = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) byId.set(String(c.id), c);
}
const all = [...byId.values()];
const liveNames = new Set(all.map(c => c.name));
const pick = (name, extra) => all.find(c => c.name === name && (!extra || extra(c)));

let pass = 0, fail = 0;
const chk = (t, cond, extra = '') => { if (cond) { pass++; console.log('  OK', t); } else { fail++; console.log('  ❌', t, extra); } };

// 掃描器自驗（v6.125 教訓：先證明自己看得到東西，否則「全過」是假的）
chk('自驗：卡庫載到 ≥4000 張 / ≥1200 個卡名', all.length >= 4000 && liveNames.size >= 1200,
    `cards=${all.length} names=${liveNames.size}`);

const basicPoke = all.find(c => c.supertype === 'Pokemon' && !c.evolvesFrom && c.subtype !== 'Other' && ['H','I','J'].includes(c.regulationMark));
const basicEnergy = all.find(c => c.supertype === 'Energy' && c.subtype === 'Basic');
chk('自驗：找得到基礎寶可夢與基本能量（湊 60 張用）', !!basicPoke && !!basicEnergy);

/** 用 [{card,count}...] 湊成一副剛好 60 張的牌組（不足處用基本能量補、確保 ≥1 基礎寶可夢）*/
function mkDeck(parts) {
  const used = parts.reduce((n, p) => n + p.count, 0);
  const entries = parts.filter(p => p.count > 0).map(p => ({ cardId: String(p.card.id), count: p.count }));
  entries.push({ cardId: String(basicPoke.id), count: 1 });
  entries.push({ cardId: String(basicEnergy.id), count: 59 - used });
  return { id: 't', name: 't', entries, createdAt: 0, updatedAt: 0 };
}
const legalOf = (parts) => validateDeck(mkDeck(parts), byId);

// ══════════ ① 核心：老大的指令 ×4 ＋（烏羽）×4 ⇒ 不合法 ══════════
// ⚠⚠ v6.193：站長裁定把 M-P 215/M-P（id 19630）直接改名為「老大的指令」
//   ⇒ **卡庫裡已經一張括號冠名的卡都沒有**。但 sameNameKey 這條通則守衛要**保留**
//   （官方下次再發括號卡名時要立刻擋得住）⇒ 這裡改用**合成卡**（真卡複製一份、只換
//   name/id）來驗機制。合成卡只存在於本測試的 byId 副本，不會寫回卡庫。
const BOSS = '老大的指令', BOSS_U = '老大的指令（烏羽）';
const boss = pick(BOSS, c => ['H','I','J'].includes(c.regulationMark));
chk(`卡庫有「${BOSS}」（H/I/J 印刷）`, !!boss, boss && boss.id);
const SYNTH_ID = '__synthetic_paren__';
const bossU = boss ? { ...boss, id: SYNTH_ID, name: BOSS_U } : null;
if (bossU) byId.set(SYNTH_ID, bossU);
chk('合成卡自驗：只有 name 與 id 不同（其餘欄位逐字沿用真卡）',
    !!bossU && Object.keys(boss).every(k => k === 'id' || k === 'name' || JSON.stringify(boss[k]) === JSON.stringify(bossU[k])));
chk('自驗：卡庫本身已無任何括號冠名卡（v6.193 改名後）',
    [...liveNames].filter(n => /[（()）]/.test(n)).length === 0,
    [...liveNames].filter(n => /[（()）]/.test(n)).join(' / '));

if (boss && bossU) {
  {
    const r = legalOf([{ card: boss, count: 4 }, { card: bossU, count: 4 }]);
    chk('① 老大的指令×4 ＋（烏羽）×4 ⇒ **不合法**（站長裁定：算同名卡，共用 4 張額度）',
        r.legal === false && r.issues.some(s => s.includes('不得超過 4 張')),
        `legal=${r.legal} issues=${JSON.stringify(r.issues)}`);
    chk('① 錯誤訊息用本名「老大的指令」（玩家才看得懂）',
        r.issues.some(s => s.startsWith(BOSS + ' 不得超過')), JSON.stringify(r.issues));
  }
  // ② 合計 4 張（任意組合）⇒ 合法
  for (const [a, b] of [[4, 0], [3, 1], [2, 2], [1, 3], [0, 4]]) {
    const r = legalOf([{ card: boss, count: a }, { card: bossU, count: b }]);
    chk(`② 老大的指令×${a} ＋（烏羽）×${b}（合計 4）⇒ 合法`, r.legal === true, JSON.stringify(r.issues));
  }
  // 合計 5 ⇒ 不合法（邊界正好卡在 4/5 之間，不是「只要有兩種就擋」）
  for (const [a, b] of [[4, 1], [1, 4], [3, 2]]) {
    const r = legalOf([{ card: boss, count: a }, { card: bossU, count: b }]);
    chk(`② 邊界：×${a} ＋ ×${b}（合計 5）⇒ 不合法`, r.legal === false, JSON.stringify(r.issues));
  }
  // ③ UI 端的「＋按鈕還能加幾張」也要共用額度（不然畫面允許、存檔才報錯）
  {
    const d4 = mkDeck([{ card: boss, count: 4 }]);
    chk('③ 已放本名 4 張 ⇒ remainingCapacity(（烏羽）) === 0（UI ＋ 按鈕要擋）',
        remainingCapacity(d4, bossU, byId) === 0, String(remainingCapacity(d4, bossU, byId)));
    chk('③ sameNameTotal 跨藝術版本累計（本名 4 ＋（烏羽）0 ⇒ 查（烏羽）也是 4）',
        sameNameTotal(d4, BOSS_U, byId) === 4, String(sameNameTotal(d4, BOSS_U, byId)));
    const dU = mkDeck([{ card: bossU, count: 2 }, { card: boss, count: 1 }]);
    chk('③ sameNameTotal 反向（（烏羽）2 ＋ 本名 1 ⇒ 查本名是 3）',
        sameNameTotal(dU, BOSS, byId) === 3, String(sameNameTotal(dU, BOSS, byId)));
    chk('③ remainingCapacity(本名) 在 (烏羽)2+本名1 時 === 1',
        remainingCapacity(dU, boss, byId) === 1, String(remainingCapacity(dU, boss, byId)));
  }
  chk('sameNameKey：括號冠名併回本名', sameNameKey(BOSS_U) === BOSS, sameNameKey(BOSS_U));
  chk('sameNameKey：本名不變', sameNameKey(BOSS) === BOSS, sameNameKey(BOSS));
}

// ══════════ ④ 正對照：**前綴**冠名仍是不同名稱（PTCG_RULES.md L2686 官方裁定）══════════
{
  const dar = pick('達摩狒狒', c => ['H','I','J'].includes(c.regulationMark));
  const nDar = pick('N的達摩狒狒', c => ['H','I','J'].includes(c.regulationMark));
  chk('卡庫有「達摩狒狒」與「N的達摩狒狒」', !!dar && !!nDar);
  if (dar && nDar) {
    chk('④ sameNameKey 不會把前綴冠名併掉（達摩狒狒 ≠ N的達摩狒狒）',
        sameNameKey('達摩狒狒') !== sameNameKey('N的達摩狒狒'),
        `${sameNameKey('達摩狒狒')} vs ${sameNameKey('N的達摩狒狒')}`);
    const r = legalOf([{ card: dar, count: 4 }, { card: nDar, count: 4 }]);
    chk('④ 行為端：達摩狒狒×4 ＋ N的達摩狒狒×4（合計 8）⇒ **仍然合法**（官方：兩種不同名稱）',
        r.legal === true, JSON.stringify(r.issues));
  }
  // 前綴冠名整族：不可有任何一個被併進「去掉前綴」的本名
  const prefixed = [...liveNames].filter(n => /^(N的|赫普的|竹蘭的)/.test(n));
  chk('④ 前綴冠名樣本數 ≥ 20（自驗：真的掃到東西）', prefixed.length >= 20, String(prefixed.length));
  const merged = prefixed.filter(n => sameNameKey(n) !== n);
  chk('④ 前綴冠名一個都沒被改寫', merged.length === 0, merged.join(','));
}

// ══════════ ⑤ 正對照：ex / 非 ex 卡名不同 ⇒ 各自獨立 4 張 ══════════
{
  const pair = [...liveNames].find(n => n.endsWith('ex') && liveNames.has(n.slice(0, -2)) && !/^(N的|赫普的|竹蘭的)/.test(n));
  chk('⑤ 找得到 ex / 非 ex 同族卡名（自驗）', !!pair, String(pair));
  if (pair) {
    const exC = pick(pair, c => ['H','I','J'].includes(c.regulationMark));
    const baseC = pick(pair.slice(0, -2), c => ['H','I','J'].includes(c.regulationMark));
    if (exC && baseC) {
      const r = legalOf([{ card: exC, count: 4 }, { card: baseC, count: 4 }]);
      chk(`⑤ ${pair}×4 ＋ ${pair.slice(0, -2)}×4 ⇒ 仍合法（卡名不同、各自 4 張）`,
          r.legal === true, JSON.stringify(r.issues));
    }
  }
}

// ══════════ ⑥ 既有行為不變：兩張合一場地 / Reprint exception ══════════
{
  const L = pick('傳說的海溝', c => c.collectorNumber === '071/076');
  const R = pick('傳說的海溝', c => c.collectorNumber === '072/076');
  chk('卡庫有「傳說的海溝」左右兩半', !!L && !!R);
  if (L && R) {
    chk('⑥ 傳說的海溝 左2＋右2（＝2 套、合計 4）⇒ 合法（既有行為）',
        legalOf([{ card: L, count: 2 }, { card: R, count: 2 }]).legal === true);
    chk('⑥ 傳說的海溝 左3＋右3（合計 6 > 4）⇒ 不合法（既有行為）',
        legalOf([{ card: L, count: 3 }, { card: R, count: 3 }]).legal === false);
    chk('⑥ 傳說的海溝 左3＋右1（左右不成套）⇒ 不合法（既有行為）',
        legalOf([{ card: L, count: 3 }, { card: R, count: 1 }]).legal === false);
  }
  const bossG = pick('老大的指令', c => c.regulationMark === 'G');
  chk('卡庫有 G 標「老大的指令」', !!bossG, bossG && bossG.id);
  if (bossG) {
    chk('⑥ Reprint exception：G 標「老大的指令」×4 ⇒ 仍合法（既有行為）',
        legalOf([{ card: bossG, count: 4 }]).legal === true,
        JSON.stringify(legalOf([{ card: bossG, count: 4 }]).issues));
  }
  const badG = all.find(c => c.regulationMark && !['H','I','J'].includes(c.regulationMark)
    && !(c.supertype === 'Energy' && c.subtype === 'Basic') && !M.isStandardReprintLegal(c));
  chk('⑥ 否定對照：非例外的 G 標卡 ×1 ⇒ 不合法（沒有被放寬）',
      !!badG && legalOf([{ card: badG, count: 1 }]).legal === false, badG && badG.name);
}

// ══════════ ⑦ 枚舉守衛：卡庫裡每一個「帶括號的卡名」都必須被人工判讀過 ══════════
//   官方哪天發了新的括號卡名 → 這條直接紅燈，逼下一個人決定「併額度還是進例外表」。
{
  const REVIEWED = new Map([
    // 完整卡名 → 判讀結論（'merge' ＝ 藝術版本、與本名共用額度；'distinct' ＝ 另一張卡，要進 EXCEPTIONS）
    // v6.193：唯一一筆（「老大的指令（烏羽）」，M-P 215/M-P id 19630）已被站長裁定改名為
    //   「老大的指令」⇒ 卡庫沒有括號卡名了，清單清空（留著會被下面的「腐爛項」那條抓紅）。
  ]);
  // ⚠ 這裡刻意掃「**含任何括號字元**」而不是只掃「結尾括號」——
  //   守衛的網不可以比中央規則窄：括號在中間、巢狀、只有半邊，全部都要被人看到。
  const found = [...liveNames].filter(n => /[（()）]/.test(n)).sort();
  const unreviewed = found.filter(n => !REVIEWED.has(n));
  // ⚠ 正對照（v6.193 清單清空後尤其重要）：清單空 + 卡庫沒括號卡名時，⑦ 會變成
  //   「永遠 PASS」的安慰劑 ⇒ 用**同一條判準**（括號正則 ＋ REVIEWED 查表）餵樣本，
  //   證明它抓得到括號卡名、也證明它不會把沒括號的誤抓。
  const parenRe = (n) => /[（()）]/.test(n);
  const wouldFlag = (n) => parenRe(n) && !REVIEWED.has(n);
  chk('⑦ 正對照：假的括號卡名必須被判為「未判讀」', wouldFlag('老大的指令（赤日）') === true);
  chk('⑦ 反對照：沒有括號的卡名不得被誤抓', wouldFlag('老大的指令') === false && wouldFlag('') === false);
  chk('⑦ 沒有「未判讀」的括號卡名（有新卡就到這支守衛裡登記結論）',
      unreviewed.length === 0, unreviewed.join(' / '));
  const rotten = [...REVIEWED.keys()].filter(n => !liveNames.has(n));
  chk('⑦ 判讀清單沒有腐爛項（卡被刪掉／改名要一併清）', rotten.length === 0, rotten.join(' / '));
  for (const [n, verdict] of REVIEWED) {
    if (!liveNames.has(n)) continue;
    if (verdict === 'merge') {
      chk(`⑦ 「${n}」判為藝術版本 ⇒ sameNameKey 併回本名、且不在例外表`,
          sameNameKey(n) !== n && !PAREN_EXCEPTIONS.has(n), sameNameKey(n));
      chk(`⑦ 「${n}」的本名「${sameNameKey(n)}」確實是卡庫裡存在的卡`,
          liveNames.has(sameNameKey(n)), sameNameKey(n));
    } else {
      chk(`⑦ 「${n}」判為另一張卡 ⇒ 必須在 SAME_NAME_PAREN_EXCEPTIONS 內且原樣回傳`,
          PAREN_EXCEPTIONS.has(n) && sameNameKey(n) === n, sameNameKey(n));
    }
  }
}

// ══════════ ⑧ 單一來源：牌組頁不可以自己再寫一份「去括號」正則 ══════════
{
  const page = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
  chk('⑧ 牌組頁改用中央 sameNameKey', /import\s*\{[^}]*\bsameNameKey\b[^}]*\}\s*from\s*'\$lib\/decks\/validation'/.test(page));
  const localRe = page.match(/replace\(\s*\/\[（\(\]/g) || [];
  chk('⑧ 牌組頁沒有第二份「去括號」正則（兩份必然漂移）', localRe.length === 0, String(localRe.length));
}

console.log(`\nv6.192 same-name art-variant: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
