/**
 * audit-samename-collision — 偵測「同名招式/特性對應多張 LIVE 卡、但卡面效果不同」的 key 碰撞。
 *
 * 背景：引擎 handler 的 key = `卡名|招式名`（或卡名|特性名）。若同名招式跨 set 重印成不同效果
 *   （例：銅鏡怪|鏡面攻擊 M5 判【鋼】/ SV5K 判【超】），單一 key 只能掛一個 handler → 另一版被誤套
 *   （v5.685 真 bug）。本工具直接從 static/cards 掃出所有「同名、LIVE、卡面文字不同」的招式/特性，
 *   排除已知無害者（翻譯用字/ex寫法差異），列出需人工檢查的【新】碰撞。
 *
 * 用途：自主巡檢/新增卡後執行 `node scripts/audit-samename-collision.mjs`。
 *   非 CI gate（卡資料常更新、豁免需語意判斷），純人工 audit 工具（同 coverage-unimplemented.mjs 性質）。
 *   輸出 NEW=0 表示無新碰撞；有 NEW 表示新出現同名不同效果，需確認 handler 是否正確涵蓋所有版本。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));

// 正規化：去空白/零寬字元/全形括號【】「」，讓純排版差異不算「不同」。
const norm = (t) => (t || '').replace(/[\s​-‏﻿【】「」\[\]]/g, '');

// 已知無害（翻譯用字差異，或已用統一判據涵蓋）— 不視為待處理碰撞。
// 註：ex/【ex】寫法、零寬字元(ZWNJ)等純排版差異已被上方 norm 正規化消除（不進碰撞判定）。
//   此清單只列「正規化後仍不同、但人工確認無實質效果差異(翻譯用字)或已用統一判據涵蓋」者。
const KNOWN = new Set([
  // v6.241：捷拉奧拉|麻麻關節 的「可」字差異已消除（SVQP 13145 的卡面文字更正為「則將」，
  //   與 MC 16737／SV5M 9870 逐字相同）⇒ 這裡不再需要豁免，留著會是永遠命中不了的死條目。
  '洛托姆|配件秀',         // 「卡」字差異，效果同
  '葉伊布|嫩葉之恩',       // 「那張 / 這些」用字差異，效果同
  '美納斯|平穩境地',       // 「全部 / 所有」用字差異，效果同
  '銅鏡怪|鏡面攻擊',       // v5.685 已用「對手===自身屬性」統一涵蓋 M5鋼/SV5K超
]);

const groups = new Map(); // key → { texts:Set, rows:[] }
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  let arr;
  try { arr = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
  for (const c of arr) {
    const nm = c.name ?? '';
    const add = (kind, a) => {
      const key = `${nm}|${a.name}`;
      const raw = a.text || a.effect || '';
      if (!groups.has(key)) groups.set(key, { texts: new Set(), rows: [], kind });
      const g = groups.get(key);
      g.texts.add(norm(raw));
      g.rows.push(`${f.slice(0, -5)} ${c.id}: ${raw.slice(0, 80)}`);
    };
    for (const a of c.attacks ?? []) add('招式', a);
    for (const a of c.abilities ?? []) add('特性', a);
  }
}

let nNew = 0, nKnown = 0;
const newOnes = [];
for (const [key, g] of [...groups].sort()) {
  const distinct = [...g.texts].filter(Boolean);
  if (new Set(distinct).size < 2) continue; // 文字一致(或僅排版差) → 非碰撞
  if (KNOWN.has(key)) { nKnown++; continue; }
  nNew++;
  newOnes.push({ key, g });
}

console.log(`同名 key 碰撞 audit：已知無害 ${nKnown} 組、★需檢查(NEW) ${nNew} 組\n`);
for (const { key, g } of newOnes) {
  console.log(`★[NEW] ${g.kind} ${key}`);
  const seen = new Set();
  for (const r of g.rows) {
    const t = norm(r.split(': ').slice(1).join(': '));
    if (seen.has(t)) continue; seen.add(t);
    console.log(`    ${r}`);
  }
  console.log('');
}
if (nNew === 0) console.log('✅ 無新的同名不同效果碰撞（已知者已在豁免清單）。');
process.exit(0); // 純報告，不 fail CI
