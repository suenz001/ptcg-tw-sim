#!/usr/bin/env node
/**
 * v2.114 regulation migration — Leon 指定的 38 張個別卡 + SVC/SVD 兩個 set 全卡 G 標。
 * 原因：scraper 從 .alpha 抓時某些 compilation set（SVC/SVD 初階牌組、svhk/svhm/SVK/
 * SVQL/SVOD/SVOM/SVM 等）裡的 G 標複刻卡被錯標為 H/I/J，要依 Leon 卡面真相修正。
 */
import fs from 'node:fs';
import path from 'node:path';

const CARDS_DIR = 'static/cards';

// 按 set 分組的個別卡修正（Leon 手動列出）
const fixes = {
  svhk: { G: ['013/022', '014/022', '022/022'] },
  svhm: { G: ['013/022', '014/022', '022/022'] },
  SVK:  { G: ['008/042', '018/042', '019/042', '021/042', '036/042'] }, // 021 含寶可裝置3.0+寶可夢交替兩張
  SVQL: { G: ['012/022', '016/022'] },
  SVOD: { G: ['012/020', '013/020', '014/020', '019/020'] },
  SVOM: { G: ['013/021', '014/021', '015/021', '020/021'] },
  SVM:  { G: ['125/175', '127/175', '134/175', '135/175', '136/175', '172/175'] },
  MBD:  { H: ['003/022', '010/022', '011/022', '013/022', '014/022', '016/022'] },
  MBG:  { H: ['009/022', '010/022', '011/022', '012/022', '013/022', '014/022', '015/022', '017/022'] },
};

// 整 set 轉 G 標（Leon 確認 SVC/SVD 本來就全 G）
const fullSetG = ['SVC', 'SVD'];

let totalFixed = 0;

for (const code of fullSetG) {
  const p = path.join(CARDS_DIR, code + '.json');
  const raw = fs.readFileSync(p, 'utf8');
  const arr = JSON.parse(raw);
  let n = 0;
  for (const c of arr) {
    if (c.regulationMark !== 'G') { c.regulationMark = 'G'; n++; }
  }
  if (n > 0) {
    const hasNL = raw.endsWith('\n');
    fs.writeFileSync(p, JSON.stringify(arr, null, 2) + (hasNL ? '\n' : ''), 'utf8');
  }
  console.log(`${code} 全 G：修 ${n}/${arr.length} 張`);
  totalFixed += n;
}

for (const [code, markMap] of Object.entries(fixes)) {
  const p = path.join(CARDS_DIR, code + '.json');
  const raw = fs.readFileSync(p, 'utf8');
  const arr = JSON.parse(raw);
  let n = 0;
  for (const [targetMark, cns] of Object.entries(markMap)) {
    for (const c of arr) {
      if (cns.includes(c.collectorNumber) && c.regulationMark !== targetMark) {
        console.log(`  ${code} ${c.collectorNumber} ${c.name}: ${c.regulationMark} → ${targetMark}`);
        c.regulationMark = targetMark;
        n++;
      }
    }
  }
  const hasNL = raw.endsWith('\n');
  fs.writeFileSync(p, JSON.stringify(arr, null, 2) + (hasNL ? '\n' : ''), 'utf8');
  console.log(`${code}：修 ${n} 張`);
  totalFixed += n;
}

console.log(`\n共修正 ${totalFixed} 張`);
