#!/usr/bin/env node
/**
 * v2.116 — 把 M-P.json 拆成 M-P-H/I/J 三個檔，依 regulationMark 分組。
 * 每張卡的 setCode 從 "M-P" 改為 "M-P-H" / "M-P-I" / "M-P-J"；
 * collectorNumber 保留（卡背印 "012/M-P" 不變，它是卡面真實編號）。
 *
 * 原 M-P.json 刪除，原 covers/M-P.png 由呼叫者自行處理。
 */
import fs from 'node:fs';
import path from 'node:path';

const CARDS_DIR = 'static/cards';
const SRC = path.join(CARDS_DIR, 'M-P.json');

const raw = fs.readFileSync(SRC, 'utf8');
const arr = JSON.parse(raw);
const hasTrailingNL = raw.endsWith('\n');

const groups = { H: [], I: [], J: [] };
for (const c of arr) {
  const m = c.regulationMark;
  if (!groups[m]) {
    console.error(`  unexpected mark ${m} on ${c.collectorNumber} ${c.name}`);
    continue;
  }
  const copy = { ...c, setCode: `M-P-${m}` };
  groups[m].push(copy);
}

for (const [mark, cards] of Object.entries(groups)) {
  const out = path.join(CARDS_DIR, `M-P-${mark}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(cards, null, 2) + (hasTrailingNL ? '\n' : ''),
    'utf8'
  );
  console.log(`${out}: ${cards.length} 張`);
}

fs.unlinkSync(SRC);
console.log(`${SRC}: 已刪除`);
