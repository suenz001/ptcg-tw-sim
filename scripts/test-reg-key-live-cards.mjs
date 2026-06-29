/**
 * v5.760 一勞永逸守衛:所有 reg*('卡名|招式名') 註冊 key 必須對得到現役 static/cards
 * 的卡+招式/特性官方名。防止「卡片改名(如光子密碼→光子纜線、烈焰軍團→火焰軍團)但
 * handler 註冊 key 沒同步更新 → handler 配不到 → 招式/特性效果無聲失效」這類回歸。
 *
 * 白名單(已人工確認無害,需附理由):
 *  - 角色冠名語法 '<X的>...' (前端比對時特殊處理,非靜態卡名)。
 *  - 芳香精|踩踏 / 莉佳的蔓藤怪|藤蔓攻擊:非現役版本的舊招式 handler(現役版招式
 *    吸取之吻/芬香壓制、綁緊 各有官方名 handler);留著供該版若重返時使用,目前不觸發。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
const ROOT = process.env.PTCG_SRC_ROOT || fileURLToPath(new URL('..', import.meta.url));
const SC = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(SC, 'index.json'), 'utf8')).map(e => e.code));
const cm = {}; // cardName -> Set(move/ability names)（含隱形字原樣）
for (const f of readdirSync(SC)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  let cards; try { cards = JSON.parse(readFileSync(join(SC, f), 'utf8')); } catch { continue; }
  for (const c of cards) {
    if (!c?.name) continue;
    const s = (cm[c.name] ??= new Set());
    for (const a of (c.abilities || [])) s.add(a.name);
    for (const a of (c.attacks || [])) s.add(a.name);
  }
}
const WHITELIST = new Set(['芳香精|踩踏', '莉佳的蔓藤怪|藤蔓攻擊']);
// 遞迴收集 src/lib/game 下 .ts
function walk(dir) { const out = []; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else if (e.name.endsWith('.ts')) out.push(p); } return out; }
const reg = /reg[A-Za-z]*\('([^'|]+)\|([^']+)'/g;
const orphans = [];
for (const fp of walk(join(ROOT, 'src/lib/game'))) {
  const txt = readFileSync(fp, 'utf8');
  let m;
  while ((m = reg.exec(txt))) {
    const cn = m[1], an = m[2], key = `${cn}|${an}`;
    if (cn.startsWith('<')) continue;          // 角色冠名語法
    if (WHITELIST.has(key)) continue;
    if (!cm[cn]) orphans.push(`${key} (卡名不在現役)`);
    else if (!cm[cn].has(an)) orphans.push(`${key} (現役無此招式/特性名)`);
  }
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
T('所有 reg key 對得到現役 static/cards 官方名(否則改名漏改handler)', () => {
  assert.equal(orphans.length, 0, '孤兒 reg key:\n    ' + orphans.join('\n    '));
});
console.log('\nreg-key 對照現役卡守衛:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
