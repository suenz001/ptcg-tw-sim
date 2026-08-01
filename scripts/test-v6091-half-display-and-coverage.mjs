/**
 * v6.091 三件事的守衛
 *  A) 「傳說」兩張合一競技場的切半顯示擴到 picker／棄牌區／牌組編輯器（Wilson 交辦）
 *  B) 霸者咆哮 minCount：卡面「選擇1張」＋4 張已被玩家看過（已知資訊）→ 有候選時必選
 *  C) 補 4 個零測試覆蓋（M6 全卡 Fable 審查指出）：三個自傷招式 + 主持人的帶動
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  FAIL:', l); } };

// ══ A) 顯示端靜態守衛 ══════════════════════════════════════
{
  const page = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const mpb = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
  const decks = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');

  // A1 picker：sel-card 的 img 有接 half class + CSS 有 aspect-ratio（v6.087 教訓）
  ok(/class:legend-half-l=\{twoCardStadiumHalfIndex\(selectionItems/.test(page),
    '⭐ A1 picker 選擇盤的卡圖有接切半 class');
  ok(/\.sel-card img\.legend-half-l[^{]*\{[^}]*aspect-ratio/.test(page),
    '⭐ A1 .sel-card 的切半 CSS 有 aspect-ratio（少了它 object-fit:cover 不會裁 → 靜默失效）');
  ok(/\.sel-card img\.legend-half-l\s*\{\s*object-position:\s*0%/.test(page), 'A1 左半 object-position 0%');
  ok(/\.sel-card img\.legend-half-r\s*\{\s*object-position:\s*100%/.test(page), 'A1 右半 object-position 100%');

  // A2 棄牌區：兩張合一不聚合（Map key 用 iid）
  ok(/isTwoCardStadiumName\(card\?\.name\)\)\s*\{[\s\S]{0,200}map\.set\(inst\.iid/.test(page),
    '⭐ A2 桌機棄牌區：兩張合一競技場改用 iid 當 key（不聚合）');
  ok(/class:legend-half-l=\{g\.half === 0\}/.test(page), 'A2 桌機棄牌區卡圖有接切半 class');
  ok(/\{#if g\.half !== 0 && g\.half !== 1\}<span class="deck-cell-count">/.test(page),
    'A2 拆開後的半圖格不顯示 ×N 徽章');

  // A3 手機棄牌區：key 必須改掉，否則 each_key_duplicate 白屏
  ok(/groupDiscardList\(sheet\.list\) as g \(g\.key\)/.test(mpb),
    '⭐ A3 手機棄牌區 each key 改成 g.key（沿用 g.cardId 會 each_key_duplicate 白屏）');
  ok(/key: inst\.iid/.test(mpb) && /key: inst\.cardId/.test(mpb),
    'A3 兩張合一用 iid 當 key、一般卡仍用 cardId');
  ok(/\.mp-discard-img\.legend-half-l[^{]*\{[^}]*object-fit:\s*cover/.test(mpb),
    '⭐ A3 手機棄牌半圖有覆蓋成 object-fit:cover（該處預設是 contain）');

  // A4 牌組編輯器
  // ⚠ v6.092：清單縮圖曾嘗試「依份數把左右半並排」，但 .entry 第一個 grid 欄固定 40px
  //   → 會被壓成細條或整排溢出蓋到卡名，已撤回成單張左半（與選擇區一致）。
  //   這條守衛就是防止有人再把並排寫法加回來而沒有一併改 grid 軌。
  ok(!/\{#each Array\(entry\.count\) as _, i\}/.test(decks),
    '⭐ A4 牌組清單縮圖沒有多張並排（.entry 第一欄固定 40px，並排會爆版）');
  ok(!/\.entry-thumb\.legend-pair/.test(decks), 'A4 legend-pair flex 容器已移除');
  ok((decks.match(/class:legend-half-l=\{isTwoCardStadium\(card\)\}/g) || []).length === 2,
    '⭐ A4 牌組清單與卡片選擇區兩處縮圖都固定顯示左半');
  ok(/\.entry-thumb img\.legend-half-l, \.pick-thumb img\.legend-half-l/.test(decks), 'A4 兩處縮圖共用 object-position');
  ok(!/\.pick-thumb img\.legend-half-r/.test(decks), 'A4 沒有用不到的右半選擇器（dead CSS）');
  // 手機回放手牌要和桌機對稱
  ok(/class:legend-half-l=\{twoCardStadiumHalfIndex\(myPlayer\.hand/.test(mpb),
    '⭐ A4 手機回放手牌也有接切半（桌機有、手機漏掉會不對稱）');

  // 負對照：守衛確實在檢查字串（可失敗）
  ok(!/class:legend-half-l=\{twoCardStadiumHalfIndex\(selectionItemsXX/.test(page), 'A 負對照：守衛比對的是真實字串');
}

// ══ 引擎 harness ═══════════════════════════════════════════
const S = join(ROOT, '.v91-s.js'), E = join(ROOT, '.v91-e.ts'), O = join(ROOT, '.v91-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST, ATTACK_PRE, ABILITY_EFFECTS, TRAINER_EFFECTS, getAbilityFn } from './src/lib/game/effects/_shared';\n"
  + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, pred) => { for (const [, c] of pool) { if (c.name === n && ['H','I','J'].includes(c.regulationMark) && (!pred || pred(c))) return c; } return null; };
let iid = 1; const inst = (c, x = {}) => ({ iid: String(iid++), cardId: String(c.id), damage: 0, energyAttached: [], ...x });
const mkState = () => { const m = () => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [] });
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, setupDone: [true, true], players: [m(), m()] }; };

// ══ B) 霸者咆哮 minCount ═══════════════════════════════════
{
  const ray = byName('超級烈空坐ex');
  const fire = byName('基本【火】能量');
  const potion = byName('傷藥');
  const fn = mod.getAbilityFn?.('超級烈空坐ex', '霸者咆哮', 0);
  ok(!!ray && !!fire && !!fn, 'B 前置：找得到超級烈空坐ex／霸者咆哮');
  if (ray && fire && fn) {
    // 牌庫上方 4 張含基本能量 → 必選（minCount 1）
    const s1 = mkState();
    s1.players[0].active = inst(ray);
    s1.players[0].deck = [inst(fire), inst(potion), inst(potion), inst(potion), inst(potion)];
    const r1 = fn(s1, 0, pool, s1.players[0].active);
    ok(r1.pendingSelection?.minCount === 1,
      `⭐ B 上方4張有基本能量 → minCount=1（必選），實得 ${r1.pendingSelection?.minCount}`);
    ok(r1.pendingSelection?.maxCount === 1, 'B maxCount 仍是 1');
    // 上方 4 張完全沒有基本能量 → minCount 0（否則玩家會卡在關不掉的 picker）
    const s2 = mkState();
    s2.players[0].active = inst(ray);
    s2.players[0].deck = [inst(potion), inst(potion), inst(potion), inst(potion)];
    const r2 = fn(s2, 0, pool, s2.players[0].active);
    ok(r2.pendingSelection?.minCount === 0,
      `⭐ B 上方4張沒有基本能量 → minCount=0（不能把玩家卡住），實得 ${r2.pendingSelection?.minCount}`);
  }
}

// ══ C) 補零測試覆蓋 ════════════════════════════════════════
{
  // C1 三個自傷招式：卡面自傷值
  const cases = [['赫拉克羅斯', '十萬馬力', 30], ['風速狗', '熱力衝撞', 50], ['超級泥偶巨人ex', '巨兵拳', 30]];
  for (const [cardName, atk, selfDmg] of cases) {
    const card = byName(cardName, c => (c.attacks || []).some(a => a.name === atk));
    ok(!!card, `C1 找得到 ${cardName}｜${atk}`);
    if (!card) continue;
    // 卡面文字先對一次（唯一權威）
    const eff = (card.attacks.find(a => a.name === atk).effect || '');
    ok(eff.includes(String(selfDmg)),
      `⭐ C1 ${cardName}｜${atk} 卡面自傷 ${selfDmg}（卡面：${eff.slice(0, 24)}）`);
    // 行為：打完自己身上多 selfDmg
    const post = mod.ATTACK_POST.get(`${cardName}|${atk}`);
    ok(!!post, `C1 ${cardName}｜${atk} 有註冊 ATTACK_POST`);
    if (post) {
      const s = mkState();
      s.players[0].active = inst(card);
      s.players[1].active = inst(card);
      const r = post(s, 0, pool, {});
      ok(r.players[0].active.damage === selfDmg,
        `⭐ C1 ${cardName}｜${atk} 實際自傷 ${selfDmg}，實得 ${r.players[0].active.damage}`);
    }
  }
  // C2 主持人的帶動：抽2；對手獎賞≤3 則改抽4
  {
    const card = byName('主持人的帶動');
    const fn = mod.TRAINER_EFFECTS.get('主持人的帶動');
    ok(!!card && !!fn, 'C2 找得到主持人的帶動且有實作');
    if (card && fn) {
      const potion = byName('傷藥');
      const mk = (oppPrizes) => {
        const s = mkState();
        s.players[0].deck = Array.from({ length: 10 }, () => inst(potion));
        s.players[1].prizes = Array.from({ length: oppPrizes }, () => inst(potion));
        return s;
      };
      const a = fn(mk(6), 0, pool);
      ok(a.players[0].hand.length === 2, `⭐ C2 對手獎賞 6 張 → 抽 2 張，實得 ${a.players[0].hand.length}`);
      const b = fn(mk(3), 0, pool);
      ok(b.players[0].hand.length === 4, `⭐ C2 對手獎賞 3 張（≤3）→ 抽 4 張，實得 ${b.players[0].hand.length}`);
      const c = fn(mk(4), 0, pool);
      ok(c.players[0].hand.length === 2, `C2 邊界：對手獎賞 4 張 → 仍抽 2 張，實得 ${c.players[0].hand.length}`);
    }
  }
}

console.log(`v6091 切半顯示 + 霸者咆哮必選 + 補覆蓋：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
