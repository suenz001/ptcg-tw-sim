#!/usr/bin/env node
/**
 * CI：npm ci 之後補裝平台 optional binary（npm#4828），**而且不讓相依樹漂移**。
 *
 * ⭐ 真因（v6.672，2026-11-27）：
 *   deploy.yml 原本在 npm ci 之後跑
 *     npm install @rollup/rollup-linux-x64-gnu @esbuild/linux-x64 --no-save --no-package-lock
 *   `--no-package-lock` 會**忽略 lock、依 package.json 的範圍重算整棵樹**（實測 changed 198 個套件）
 *   ⇒ CI 測的、建置的都不是 lock 釘住的版本，而是當天 npm 上的最新版。
 *   2026-11-25 svelte 5.59 上架後（lock 是 5.55.4），test-lib-strip-markup-sections D-4 的樣本
 *   在新版編譯不過 ⇒ v6.672 的 CI 紅，跟本版改動無關（本機與乾淨 npm ci 都綠）。
 *
 * 做法（一勞永逸）：
 *   1. 兩個平台 binary **只有缺的時候才補**，而且裝 lock 裡的那個版本、讓 npm 照 lock 解析（不加 --no-package-lock）。
 *   2. 補完驗證：node_modules 頂層每個套件的版本都必須等於 lock ⇒ 有任何漂移就讓 CI 紅（不再默默換版本）。
 *
 * 判準函式 export 給守衛（test-v6380 C 組）直接呼叫，不另抄一份（Rule 38）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const PLATFORM_BINARIES = ['@rollup/rollup-linux-x64-gnu', '@esbuild/linux-x64'];

/** lock 裡記的版本（找不到回 null） */
export function lockVersion(lock, name) {
  return lock?.packages?.['node_modules/' + name]?.version ?? null;
}

/**
 * 漂移清單：lock 裡有記、node_modules 也裝了、但版本不同的頂層套件。
 * @param lock  package-lock.json 物件
 * @param installedVersion (name) => 已安裝版本或 null（沒裝）
 */
export function findDrift(lock, installedVersion) {
  const out = [];
  for (const [key, meta] of Object.entries(lock?.packages ?? {})) {
    if (!key.startsWith('node_modules/') || key.indexOf('/node_modules/', 13) >= 0) continue;   // 只看頂層
    const name = key.slice('node_modules/'.length);
    const want = meta?.version;
    if (!want) continue;
    const got = installedVersion(name);
    if (got != null && got !== want) out.push({ name, want, got });
  }
  return out;
}

function main() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const installed = (name) => {
    const p = join(ROOT, 'node_modules', name, 'package.json');
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')).version ?? null; } catch { return null; }
  };
  const missing = PLATFORM_BINARIES.filter((n) => installed(n) == null);
  if (missing.length) {
    const specs = missing.map((n) => {
      const v = lockVersion(lock, n);
      if (!v) throw new Error('package-lock.json 沒有記 ' + n + ' 的版本');
      return n + '@' + v;
    });
    console.log('補裝平台 binary（照 lock 版本、不重算整棵樹）：' + specs.join(' '));
    execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', ...specs], { cwd: ROOT, stdio: 'inherit' });
  } else {
    console.log('平台 binary 都在（npm ci 已裝好），不用補裝');
  }
  const drift = findDrift(lock, installed);
  if (drift.length) {
    console.error('❌ node_modules 與 package-lock.json 不一致（' + drift.length + ' 個）：');
    for (const d of drift.slice(0, 30)) console.error('   ' + d.name + '：lock ' + d.want + '，裝到 ' + d.got);
    process.exit(1);
  }
  console.log('✅ node_modules 頂層版本全部等於 package-lock.json');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
