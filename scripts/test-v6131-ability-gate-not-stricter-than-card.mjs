/**
 * v6.131 守衛：特性 gate（`getUsableAbilities` 裡的 per-card 條件）**不得比卡面嚴**。
 *
 * 玩家回報：三合一磁怪｜過度放電「棄牌區有能量、備戰有【雷】寶可夢，卻按不下去」。
 * 根因：卡面「從自己的棄牌區選擇最多3張**基本能量卡**，以任意方式附於自己的【雷】寶可夢身上」
 *   —— 屬性限制**只在附加目標**，不在來源能量；但 engine 的 gate 多要求「棄牌區有基本【雷】能量」。
 *   regA（真正執行的那段）v5.500 早就改對了，engine 的 gate 沒跟著改。
 * 同型第二張：金屬怪｜金屬製造者，卡面「附於自己的**寶可夢**身上」沒有屬性限制，
 *   gate 卻要求「場上有【鋼】寶可夢」（regA 端 v4.29 已移除該誤限制，gate 又沒跟著改）。
 *
 * ⇒ 這個 bug 型的本質：**「能不能按」與「按下去做什麼」是兩份獨立條件，改了一邊忘了另一邊。**
 *   後果不對稱且都很糟：
 *     gate 太嚴 → 玩家完全用不了（本次回報）
 *     gate 太鬆 → USE_ABILITY「先標記本回合已用、再執行」⇒ 白按一次、特性權被吃掉（v6.127）
 *
 * 本守衛用**卡面驅動**的單向判準（可自動化、不需人工逐條看）：
 *   gate 程式碼裡出現的每個屬性【X】，卡面該特性的 effect 必須也出現【X】。
 *   單向是刻意的 —— 卡面有、gate 沒有是「保守放行」，安全；反過來才會擋掉玩家。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超',
  Fighting: '鬥', Darkness: '惡', Metal: '鋼', Fairy: '妖', Dragon: '龍', Colorless: '無' };
// 「鬥」在部分卡面印作「格」，視為同一屬性
const ALIAS = { 鬥: ['鬥', '格'], 格: ['鬥', '格'] };

// ── 卡面（HIJ）：特性名 → effect 文字集合 ──────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const face = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.regulationMark == null || !'HIJ'.includes(c.regulationMark)) continue;
    for (const a of (c.abilities || [])) {
      if (!a?.name || !a?.effect) continue;
      if (!face.has(a.name)) face.set(a.name, []);
      face.get(a.name).push({ card: c.name, effect: a.effect });
    }
  }
}
ok(face.size > 100, `卡面特性表只掃到 ${face.size} 個 → 掃描器壞了，不是「乾淨」`);

// ── engine 的 per-card gate ────────────────────────────────────────────────
const ENGINE = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
ok(ENGINE.length > 300000, `engine.ts 只讀到 ${ENGINE.length} bytes → 疑似被 mount 截斷`);

// ⚠ 抽取器必須支援**複合條件**（`if (ab.name === 'A' || ab.name === 'B') {`）。
//   第一版只認 `if (ab.name === 'X') {` 這種單一形式 —— 那不只會對複合條件給假 FAIL，
//   更糟的是**日後有人把 gate 寫成複合條件時會被靜默漏掉（假 PASS）**，整條網對那條 gate 失效。
//   ⇒ 改成：以每個 `ab.name === 'NAME'` 為錨點，往前找最近的 `if (`、做括號配對找到條件結尾，
//     再配對 body；同一個 if 內的多個名稱各自 map 到同一份 body。
const gates = new Map();
for (const m of ENGINE.matchAll(/ab\.name === '([^']+)'/g)) {
  const ifPos = ENGINE.lastIndexOf('if (', m.index);
  if (ifPos < 0) continue;
  // 條件括號配對
  let d = 0, condEnd = -1;
  for (let i = ifPos + 3; i < ENGINE.length; i++) {
    if (ENGINE[i] === '(') d++;
    else if (ENGINE[i] === ')') { d--; if (d === 0) { condEnd = i; break; } }
  }
  if (condEnd < 0) continue;
  const after = ENGINE.slice(condEnd + 1, condEnd + 4);
  if (!after.trimStart().startsWith('{')) continue;   // 單行 if（無 body 大括號）→ 跳過
  const bodyStart = ENGINE.indexOf('{', condEnd);
  let bd = 0, bodyEnd = -1;
  for (let i = bodyStart; i < ENGINE.length; i++) {
    if (ENGINE[i] === '{') bd++;
    else if (ENGINE[i] === '}') { bd--; if (bd === 0) { bodyEnd = i; break; } }
  }
  if (bodyEnd < 0) continue;
  // ⚠ 同一個特性可能被**多條** gate 涵蓋（例：「在戰鬥場上」由一條複合 gate 管、
  //   「對手已處於該狀態」由另一條管）。用覆蓋語意會只留最後一條 ⇒ 對前面那條完全盲。
  //   （這個盲點在 v6.132 當場害我誤判「平靜之光完全沒有 gate」，差點寫進 changelog。）
  const prev = gates.get(m[1]);
  const body = ENGINE.slice(ifPos, bodyEnd + 1);
  gates.set(m[1], prev && !prev.includes(body) ? prev + '\n' + body : (prev ?? body));
}
ok(gates.size >= 60, `只掃到 ${gates.size} 條 per-card gate（預期 ≥60）→ 掃描器錨點失效`);

// ⚠ 剝註解：說明文字裡常引用卡面／舊寫法的屬性字樣，不剝會整片假 FAIL
//   （同型教訓：v6.130 守衛被註解裡的「<audio autoplay>」騙、v6.112 被舊寫法註解騙）
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

console.log('① gate 裡出現的屬性限制，卡面必須也有（gate 不得比卡面嚴）');
let checked = 0;
for (const [name, raw] of gates) {
  const entries = face.get(name);
  if (!entries) continue;              // G 標／已退環境／非特性 gate → 跳過
  const body = strip(raw);
  const inGate = new Set();
  for (const m of body.matchAll(/pokemonType\s*===\s*'([A-Za-z]+)'/g)) { const z = ZH[m[1]]; if (z) inGate.add(z); }
  for (const m of body.matchAll(/【([草火水雷超鬥格惡鋼妖龍無])】/g)) inGate.add(m[1]);
  if (inGate.size === 0) continue;
  checked++;
  const allText = entries.map(e => e.effect).join('　');
  for (const z of inGate) {
    const accept = ALIAS[z] ?? [z];
    ok(accept.some(a => allText.includes(`【${a}】`)),
      `特性「${name}」的 gate 檢查了【${z}】，但卡面沒有這個屬性限制 ⇒ gate 比卡面嚴、玩家會按不下去。`
      + `\n         卡面：${entries[0].effect}`
      + `\n         （若卡面的屬性限制只在「附加目標」而不在「來源」，gate 也只能檢查目標那一側）`);
  }
}
ok(checked >= 15, `只有 ${checked} 條 gate 帶屬性判斷被檢查（預期 ≥15）→ 掃描器可能失效`);

console.log('② 逐卡回歸：本次修的兩張，gate 不得再出現卡面沒有的限制');
{
  const overvolt = strip(gates.get('過度放電') ?? '');
  ok(overvolt.length > 0, '找不到過度放電的 gate');
  ok(!/discard[\s\S]{0,300}?【雷】/.test(overvolt) && !/discard[\s\S]{0,300}?Lightning/.test(overvolt),
    '過度放電：gate 不得再要求「棄牌區有基本【雷】能量」—— 卡面只寫「基本能量卡」，'
    + '屬性限制只在附加目標');
  ok(/Lightning/.test(overvolt),
    '過度放電：gate 仍必須檢查「場上有【雷】寶可夢」（卡面「附於自己的【雷】寶可夢身上」）');
  // ⚠⚠ 官方 Q&A（PTCG RULES/PTCG_RULES.md:1959-1960 §17.29.F）：
  //   「使用『過度放電』時，可以將基本能量卡附加給使用了特性的三合一磁怪**自己**嗎？→ 可以。」
  //   ⇒ gate **不得**排除即將昏厥的自己。（我一度加了 `c.iid !== pk.iid`，是與官方相反的，Fable 5 審出。）
  //   這條斷言的用途就是把那個直覺釘死：看起來很合理（自己都要昏厥了怎麼當目標），但官方說可以。
  ok(!/iid !== pk\.iid/.test(overvolt),
    '過度放電：gate 判「場上有【雷】寶可夢」時**不得排除自己** —— 官方 L1959 明文「可以附加給使用了特性的'
    + '三合一磁怪自己」。排除自己會誤擋「場上只有這隻磁怪是【雷】」的合法使用。');

  const metal = strip(gates.get('金屬製造者') ?? '');
  ok(metal.length > 0, '找不到金屬製造者的 gate');
  ok(!/Metal|【鋼】/.test(metal),
    '金屬製造者：gate 不得要求「場上有【鋼】寶可夢」—— 卡面「以任意方式附於自己的**寶可夢**身上」沒有屬性限制');
  ok(/deck\.length === 0/.test(metal), '金屬製造者：gate 仍必須檢查牌庫非空（卡面「查看自己的牌庫上方4張卡」）');
}

console.log('②c ⭐ 站長裁定（v6.132）：四條 gate');
{
  // 燈罩夜菇｜平靜之光「**若這隻寶可夢在戰鬥場上**，則在自己的回合時可使用1次。將對手的戰鬥寶可夢【睡眠】。」
  // 波爾凱尼恩ex｜燒灼蒸汽「**若這隻寶可夢在戰鬥場上**，…將對手的戰鬥寶可夢【灼傷】。」
  //   ⚠ 這兩張原本**完全沒有 gate** —— regA 的註解寫著「gate：cardInst 必須在戰鬥場（engine 加 gate）」，
  //     但 engine 從來沒加 ⇒ 備戰區也能發動，直接違反卡面。這條斷言把那張空頭支票釘成真的。
  const calm = strip(gates.get('平靜之光') ?? '') + '\n' + strip(gates.get('燒灼蒸汽') ?? '');
  ok(calm.trim().length > 0, '平靜之光／燒灼蒸汽 必須有 gate');
  ok(/player\.active\?\.iid !== pk\.iid/.test(calm),
    '平靜之光／燒灼蒸汽：必須 gate「這隻寶可夢在戰鬥場上」（卡面白紙黑字）—— 由既有的複合 gate'
    + '（瞬間移動者/平靜之光/燒灼蒸汽/勸誘羽）負責，這條斷言確保它不會在重構時被拆掉');
  ok(/hasStatusInAnySlot/.test(calm),
    '平靜之光／燒灼蒸汽：判「對手已處於該狀態」必須用 hasStatusInAnySlot（跨三槽），'
    + '直接讀 .status 會漏掉 secondary/tertiary');
  ok(/'asleep'/.test(calm) && /'burned'/.test(calm),
    '平靜之光→asleep、燒灼蒸汽→burned 兩種狀態都要判');
  // ⚠ 免疫不算進 gate（沿用 v6.127 站長對暗黑鈴的裁定：免疫是防禦方能力，不該讓攻擊方連按都不能按）
  ok(!/immune|canApplyEffectToTarget/i.test(calm),
    '平靜之光／燒灼蒸汽：gate **不得**把「對手對該狀態免疫」算進去（v6.127 站長裁定）');

  for (const [nm, zh] of [['頸傘發電', '基本【雷】能量'], ['惡棍衝天', '基本【惡】能量']]) {
    const g = strip(gates.get(nm) ?? '');
    ok(g.length > 0, `找不到 ${nm} 的 gate`);
    ok(/player\.deck\.length === 0/.test(g),
      `${nm}：站長裁定牌庫 0 時不能使用（卡面「從自己的牌庫選擇…${zh}…並且重洗牌庫」，`
      + `牌庫空＝整個效果無事可做，而這是每回合1次，白按會吃掉特性權）`);
  }
}

console.log('②b gate 不得讀「隱藏區的內容」（對手手牌／任一方牌庫）—— 按鈕亮暗會洩漏');
//   判準來源：對手手牌與牌庫的**張數是公開的、內容是隱藏的**。
//   官方 L821（電氣發生器牌庫 0 張「不可以」）能成立正是因為張數公開；
//   而 v2.324 對「金屬信號／王者呼聲」明寫 `no gate needed — deck content is hidden info`。
//   ⇒ gate 可以判 `.length === 0`，但不可以 `.some(...)` 去看裡面有什麼。
{
  const HIDDEN = [
    ['opp.hand', /opp\.hand\s*\.\s*some|opp\.hand\.some|opp\.hand\.filter/],
    ['player.deck', /player\.deck\.some|player\.deck\.filter/],
    ['opp.deck', /opp\.deck\.some|opp\.deck\.filter/],
  ];
  let scanned = 0;
  for (const [name, raw] of gates) {
    const body = strip(raw);
    scanned++;
    for (const [zone, re] of HIDDEN) {
      const why = zone === 'opp.hand'
        ? '對手手牌是隱藏區，按鈕的亮/暗會把裡面有什麼洩漏給使用者'
        : '牌庫是隱藏區，帶條件的搜尋可以宣告「找不到」（官方 fail-to-find，L832）⇒ 沒有目標時玩家仍可使用';
      ok(!re.test(body),
        `特性「${name}」的 gate 讀了 ${zone} 的**內容** —— ${why}。`
        + `只能判張數（.length === 0，張數是公開資訊，官方 L821 電氣發生器同判準）。`);
    }
  }
  ok(scanned >= 60, `隱藏區掃描只跑了 ${scanned} 條 gate → 掃描器失效`);
}

console.log('③ 掃描器自我驗證（防安慰劑）');
{
  const bad = `if (ab.name === 'X') { const h = player.discard.some(c => pool.get(c.cardId)?.pokemonType === 'Lightning'); }`;
  const got = new Set();
  for (const m of strip(bad).matchAll(/pokemonType\s*===\s*'([A-Za-z]+)'/g)) got.add(ZH[m[1]]);
  ok(got.has('雷'), '正對照：判準必須抓得到 pokemonType === \'Lightning\'');
  ok(strip("  // pokemonType === 'Lightning'\nreal").includes('Lightning') === false,
    '正對照：strip 必須剝掉 // 註解（否則說明文字會造成整片假 FAIL）');
  // 抽取器對複合條件的正對照（第一版就是敗在這）
  {
    const sample = `if (ab.name === 'A' || ab.name === 'B') {\n  doSomething();\n}`;
    const found = [];
    for (const mm of sample.matchAll(/ab\.name === '([^']+)'/g)) found.push(mm[1]);
    ok(found.length === 2 && found[0] === 'A' && found[1] === 'B',
      '正對照：抽取器必須從複合條件 `ab.name === \'A\' || ab.name === \'B\'` 抽出兩個名稱');
  }
  const alias = ALIAS['鬥'];
  ok(alias.includes('格'), '正對照：【鬥】必須接受卡面印作【格】的別名');
}

console.log(`\nv6131 特性 gate 不得比卡面嚴：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
