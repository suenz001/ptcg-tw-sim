// ⭐v6.559 牌組編輯器「匯出套牌構築表」：產生可直接列印的 A4 構築表（道館賽報名用）。
//
// 版面比照官方紙本「套牌構築表」的精神：
//   ・上方：比賽名稱／舉辦地點／姓名／參賽編號／來自地區（留白給玩家手寫，姓名可預填）
//   ・寶可夢（名稱、擴充包角標、集換 NO.、張數）／能量／物品（含寶可夢道具）／支援者／競技場 各自小計，最後總計
//   ・注意事項
// 不使用官方商標圖（避免冒用），頁尾註明由本站產生。
//
// 純函式、只 import 型別與 leaf 模組 ⇒ 牌組頁與守衛都能直接呼叫。

import type { Card } from '$lib/cards/types';
import type { DeckEntry } from './types';
import { mergeTwoCardStadiumEntries } from './cardIdMigration';

export interface SheetPokemonRow { name: string; setCode: string; number: string; count: number }
export interface SheetNamedRow { name: string; count: number }
export interface DeckSheetModel {
  pokemon: SheetPokemonRow[];
  items: SheetNamedRow[];      // 物品＋寶可夢道具
  supporters: SheetNamedRow[];
  stadiums: SheetNamedRow[];
  energies: SheetNamedRow[];
  subtotal: { pokemon: number; items: number; supporters: number; stadiums: number; energies: number };
  total: number;
  /** 牌組裡有、但卡池找不到的卡（不應發生；有的話印在表上提醒玩家手寫補上） */
  unknown: SheetNamedRow[];
}

/** 卡面集換編號 "032/081" → 表上寫 "032"（與官方範例「AC1a 32」同義：只寫斜線前）。 */
export function sheetCollectorNo(collectorNumber: string | null | undefined): string {
  const s = String(collectorNumber ?? '').trim();
  if (!s) return '';
  // LEGEND 這種兩張一組的卡寫成 "151/103,152/103" ⇒ 兩段各取斜線前，表上寫 "151,152"
  return s.split(',').map((p) => { const t = p.trim(); const i = t.indexOf('/'); return i >= 0 ? t.slice(0, i) : t; }).filter(Boolean).join(',');
}

/**
 * 表上「擴充包角標」：卡面印的代碼。本站把特典卡依規則標記拆檔（M-P-J、SV-P-I…），
 * 後綴 -H／-I／-J 是內部用的、卡面上沒有（卡面是「059/M-P」）⇒ 特典卡印 M-P／SV-P（審查 P2，官方卡圖實查）。
 */
export function sheetSetCode(setCode: string | null | undefined): string {
  const s = String(setCode ?? '').trim();
  const m = /^((?:SV|M)-P)-[A-Z]$/.exec(s);
  return m ? m[1] : s;
}

/** 訓練家卡歸哪一欄（官方表只有 物品／支援者／競技場 三欄；寶可夢道具歸物品）。 */
export function trainerColumn(card: Pick<Card, 'subtype'>): 'items' | 'supporters' | 'stadiums' {
  const st = String(card.subtype ?? '');
  if (st === 'Supporter') return 'supporters';
  if (st === 'Stadium') return 'stadiums';
  return 'items';   // Item／PokemonTool／Tool／（空白的舊資料，例如化石）
}

/** 牌組 → 構築表資料。寶可夢依「名稱＋角標＋編號」合併；訓練家與能量依名稱合併（構築表不需寫編號）。 */
export function buildDeckSheetModel(entries: readonly DeckEntry[], pool: ReadonlyMap<string, Card>): DeckSheetModel {
  const merged = mergeTwoCardStadiumEntries(entries.map((e) => ({ ...e, count: Math.floor(Number(e?.count) || 0) })).filter((e) => e.count > 0));
  const pk = new Map<string, SheetPokemonRow>();
  const named = { items: new Map<string, number>(), supporters: new Map<string, number>(), stadiums: new Map<string, number>(), energies: new Map<string, number>() };
  const unknown: SheetNamedRow[] = [];
  const add = (m: Map<string, number>, name: string, n: number) => m.set(name, (m.get(name) ?? 0) + n);
  for (const e of merged) {
    const c = pool.get(String(e.cardId));
    if (!c) { unknown.push({ name: `（卡片 ${e.cardId}）`, count: e.count }); continue; }
    if (c.supertype === 'Pokemon') {
      const setCode = sheetSetCode(c.setCode), number = sheetCollectorNo(c.collectorNumber);
      const key = `${c.name}\u0000${setCode}\u0000${number}`;
      const row = pk.get(key);
      if (row) row.count += e.count; else pk.set(key, { name: c.name, setCode, number, count: e.count });
    } else if (c.supertype === 'Trainer') add(named[trainerColumn(c)], c.name, e.count);
    else add(named.energies, c.name, e.count);
  }
  const rows = (m: Map<string, number>) => [...m].map(([name, count]) => ({ name, count }));
  const pokemon = [...pk.values()];
  const items = rows(named.items), supporters = rows(named.supporters), stadiums = rows(named.stadiums), energies = rows(named.energies);
  const sum = (a: { count: number }[]) => a.reduce((s, r) => s + r.count, 0);
  const subtotal = { pokemon: sum(pokemon), items: sum(items), supporters: sum(supporters), stadiums: sum(stadiums), energies: sum(energies) };
  return { pokemon, items, supporters, stadiums, energies, subtotal,
    total: subtotal.pokemon + subtotal.items + subtotal.supporters + subtotal.stadiums + subtotal.energies + sum(unknown), unknown };
}

/** 名稱太長時縮小字級（格子固定寬度，避免被截掉）。 */
const fit = (name: string, wide: number) => (name.length > wide + 6 ? ' xxs' : name.length > wide + 3 ? ' xs' : name.length > wide ? ' s' : '');
/** 角標／編號格（約 15～19mm）：字多時縮小（LEGEND 的 "151,152"）。 */
const fitCode = (v: string) => (v.length > 7 ? ' class="c xs"' : v.length > 5 ? ' class="c s"' : '');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/** 表格列數：至少 min 列（留空白給手寫），內容多就照內容長。 */
function padRows<T>(rows: T[], min: number): (T | null)[] {
  const out: (T | null)[] = [...rows];
  while (out.length < min) out.push(null);
  return out;
}

export interface DeckSheetOptions {
  deckName?: string;
  playerName?: string;
  /** 產生日期（測試固定用）；預設今天 */
  date?: Date;
  siteName?: string;
  siteUrl?: string;
}

/** 構築表 → 完整 HTML 文件（A4 直式，開新視窗列印或另存 PDF）。 */
export function deckSheetHtml(m: DeckSheetModel, opt: DeckSheetOptions = {}): string {
  const d = opt.date ?? new Date();
  const ymd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const site = opt.siteName ?? 'PTCG 台灣模擬器';
  const siteUrl = opt.siteUrl ?? 'www.ptcg-tw-sim.com';   // ⭐站長 2026-10-13：註明網址，順便宣傳
  // ⭐列高自動縮放：預設版面最高的一欄是 24 列（物品 1＋22＋1；寶可夢＋能量 17＋7）。
  //   某一欄內容超過預設列數（例如物品種類很多）時，全表列高等比例縮小，維持 A4 一頁（E1 守衛實測）。
  const colRows = Math.max(
    (1 + Math.max(15, m.pokemon.length) + 1) + (1 + Math.max(5, m.energies.length) + 1),
    1 + Math.max(22, m.items.length) + 1,
    (1 + Math.max(14, m.supporters.length) + 1) + (1 + Math.max(4, m.stadiums.length) + 1),
  );
  const rowH = Math.max(3.4, Math.min(6.8, (6.8 * 24) / colRows));
  const dense = rowH < 5.6;
  const pkRows = padRows(m.pokemon, 15).map((r) => `<tr><td class="l${r ? fit(r.name, 9) : ''}">${r ? esc(r.name) : ''}</td><td${r ? fitCode(r.setCode) : ''}>${r ? esc(r.setCode) : ''}</td><td${r ? fitCode(r.number) : ''}>${r ? esc(r.number) : ''}</td><td class="n">${r ? r.count : ''}</td></tr>`).join('');
  const named = (rows: SheetNamedRow[], min: number, wide = 9) => padRows(rows, min).map((r) => `<tr><td class="l${r ? fit(r.name, wide) : ''}">${r ? esc(r.name) : ''}</td><td class="n">${r ? r.count : ''}</td></tr>`).join('');
  const sub = (label: string, n: number, span: number) => `<tr class="sub"><td colspan="${span}" class="r">小計</td><td class="n">${n}</td></tr>`;
  const unknownNote = m.unknown.length
    ? `<p class="warn">⚠ 以下卡片在本站卡表找不到資料，請手寫補上：${m.unknown.map((u) => `${esc(u.name)} ×${u.count}`).join('、')}</p>` : '';
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>套牌構築表${opt.deckName ? '－' + esc(opt.deckName) : ''}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif; color: #000; background: #fff; font-size: 10.5pt; }
  .sheet { width: 188mm; margin: 0 auto; }
  .top { display: flex; justify-content: space-between; align-items: stretch; gap: 6mm; margin-bottom: 5mm; }
  .brand { display: flex; flex-direction: column; justify-content: center; }
  .brand h1 { margin: 0; font-size: 22pt; letter-spacing: .15em; }
  .brand .deck { margin-top: 2mm; font-size: 11pt; }
  .brand .meta { margin-top: 1mm; font-size: 8.5pt; color: #444; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { border: .3mm solid #000; height: var(--rh, 6.8mm); padding: 0 1.2mm; text-align: center; vertical-align: middle; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  th { background: #c8c8c8; font-weight: 700; font-size: 9pt; padding: 0 .6mm; }
  td.l { text-align: left; }
  td.r { text-align: right; border-left-color: transparent; border-bottom-color: transparent; font-weight: 700; }
  td.n, th.n { width: 11mm; font-variant-numeric: tabular-nums; }
  tr.sub td { font-weight: 700; }
  .info { width: 83mm; flex-shrink: 0; }   /* 牌組名稱很長時不擠窄手寫區 */
  .brand { min-width: 0; overflow-wrap: anywhere; }
  .info th { width: 22mm; background: #eee; }
  .info th, .info td { height: 7mm; }   /* 手寫格不跟著列高縮放 */
  .info caption { border: .3mm solid #000; border-bottom: none; padding: 1.8mm; font-weight: 700; font-size: 12pt; }
  .grid { display: grid; grid-template-columns: 83mm 48mm 48mm; gap: 4mm; align-items: start; }
  .col > table + table { margin-top: 4mm; }
  .pk th:nth-child(2) { width: 19mm; } .pk th:nth-child(3) { width: 15mm; }
  td.c.s { font-size: 8.5pt; } td.c.xs { font-size: 7pt; padding: 0 .3mm; }
  td.l.s { font-size: 9pt; } td.l.xs { font-size: 8pt; } td.l.xxs { font-size: 6.6pt; letter-spacing: -.02em; }
  .dense td { font-size: 8pt; line-height: 1; }   /* 讓縮小的列高真的生效（字高不撐列） */ .dense td.l.s, .dense td.l.xs { font-size: 7pt; } .dense td.l.xxs { font-size: 6pt; } .dense th { font-size: 8pt; }
  .total { margin-top: 4mm; display: flex; justify-content: flex-end; }
  .total table { width: 48mm; }
  .notes { margin-top: 5mm; font-size: 9pt; line-height: 1.6; }
  .notes h2 { font-size: 10pt; margin: 0 0 1mm; }
  .notes ul { margin: 0; padding-left: 5mm; }
  .warn { color: #b00; font-size: 9pt; }
  .foot { margin-top: 4mm; text-align: center; font-size: 7.5pt; color: #555; }
  @media screen { body { background: #888; padding: 8mm 0; } .sheet { background: #fff; padding: 10mm; width: 210mm; box-shadow: 0 2mm 6mm rgba(0,0,0,.4); }
    .printbar { text-align: center; margin-bottom: 4mm; } .printbar button { font-size: 12pt; padding: 2mm 6mm; cursor: pointer; } }
  @media print { .printbar { display: none; } }
</style></head>
<body>
<div class="printbar"><button onclick="window.print()">🖨️ 列印／另存 PDF</button></div>
<div class="sheet${dense ? ' dense' : ''}" style="--rh:${rowH.toFixed(2)}mm">
  <div class="top">
    <div class="brand"><h1>套牌構築表</h1>
      ${opt.deckName ? `<div class="deck">牌組：${esc(opt.deckName)}</div>` : ''}
      <div class="meta">產生日期 ${ymd}</div></div>
    <table class="info"><caption>參賽資料</caption>
      <tr><th>比賽名稱</th><td></td></tr><tr><th>舉辦地點</th><td></td></tr>
      <tr><th>姓名</th><td class="l">${esc(opt.playerName ?? '')}</td></tr>
      <tr><th>參賽編號</th><td></td></tr><tr><th>來自地區</th><td></td></tr>
    </table>
  </div>
  <div class="grid">
    <div class="col">
      <table class="pk"><tr><th>寶可夢</th><th>擴充包角標</th><th>集換NO.</th><th class="n">張數</th></tr>${pkRows}${sub('寶可夢', m.subtotal.pokemon, 3)}</table>
      <table><tr><th>能量</th><th class="n">張數</th></tr>${named(m.energies, 5, 18)}${sub('能量', m.subtotal.energies, 1)}</table>
    </div>
    <div class="col">
      <table><tr><th>物品／寶可夢道具</th><th class="n">張數</th></tr>${named(m.items, 22)}${sub('物品', m.subtotal.items, 1)}</table>
    </div>
    <div class="col">
      <table><tr><th>支援者</th><th class="n">張數</th></tr>${named(m.supporters, 14)}${sub('支援者', m.subtotal.supporters, 1)}</table>
      <table><tr><th>競技場</th><th class="n">張數</th></tr>${named(m.stadiums, 4)}${sub('競技場', m.subtotal.stadiums, 1)}</table>
    </div>
  </div>
  <div class="total"><table><tr><th>總計</th><td class="n" style="width:auto">${m.total}</td></tr></table></div>
  ${unknownNote}
  <div class="notes"><h2>注意事項</h2><ul>
    <li>「寶可夢」請一定要寫下擴充包角標及集換編號。</li>
    <li>「寶可夢」如果有相同能力及敘述、但編號不同的卡牌，可以只寫其中一張的角標及編號。</li>
    <li>如果套牌與套牌構築表不符，或張數及構築規則不符合大會規定，將會有相應懲罰。</li>
    <li>請用繁體中文填寫並確保字跡能讓裁判辨識，否則可能影響比賽權益。</li>
    <li>本表由 ${esc(site)}（${esc(siteUrl)}）依牌組內容自動產生，送出前請再次核對實體牌組。</li>
  </ul></div>
  <div class="foot">本表非官方文件，格式依各賽事主辦單位規定為準。</div>
</div>
</body></html>`;
}
