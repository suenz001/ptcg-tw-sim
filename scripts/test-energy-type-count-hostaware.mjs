/**
 * 「依/有/丟某屬性能量」host-aware 收斂（v5.683）
 * 麻麻羅網(雷gate)/惡棍墜落(場上惡≥3)/連鎖伏特(雷數×20)/泥巴伏特(鬥gate)/紅蓮引爆(丟火)
 * 原用 isEnergyOfType 漏特殊能量；古舊能量(全屬性 ACE SPEC)等「視為該屬性」應認列。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.et-s.mjs'), E = join(ROOT, '.et-e.ts'), O = join(ROOT, '.et-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame } from './src/lib/game/engine';\nexport { ATTACK_PRE, ATTACK_POST } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, ATTACK_PRE, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const SPIDER = '10584' /*電蜘蛛 麻麻羅網*/, ABSOL = '10612' /*阿勃梭魯 惡棍墜落*/, KNIGHT = '11201' /*紅蓮鎧騎 紅蓮引爆*/,
      ELEBALL = '16705' /*奇樹的霹靂電球 連鎖伏特*/, MUD = '13389' /*泥巴魚 泥巴伏特*/,
      ANCIENT = '17212' /*古舊能量(全屬性)*/, PSY = '11177' /*基本超(非火/雷/鬥/惡)*/, DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const en = (cid) => inst(cid);
function mkSelf(activeCid, activeEnergy, bench = []) {
  const s = createGame({ name: 'P1', entries: [{ cardId: activeCid, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(activeCid, { energyAttached: activeEnergy }), bench }, { ...s.players[1], active: inst(DEF), bench: [inst(DEF)] }] };
}
const dmg = (key, st) => ATTACK_PRE.get(key)(st, 0, pool).damage;

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('★麻麻羅網：附古舊能量(視為雷) → +80=130（HEAD 漏 → 50 FAIL）', () => {
  assert.equal(dmg('電蜘蛛|麻麻羅網', mkSelf(SPIDER, [en(ANCIENT)])), 130);
  assert.equal(dmg('電蜘蛛|麻麻羅網', mkSelf(SPIDER, [en(PSY)])), 50, '非雷 baseline');
});

T('★惡棍墜落：場上 3 古舊能量(視為惡) → 觸發 +50（HEAD 漏 → 不加成 FAIL）', () => {
  const withAncient = dmg('阿勃梭魯|惡棍墜落', mkSelf(ABSOL, [en(ANCIENT), en(ANCIENT), en(ANCIENT)]));
  const baseline = dmg('阿勃梭魯|惡棍墜落', mkSelf(ABSOL, []));
  assert.equal(withAncient - baseline, 50, '3 個惡(古舊) → +50');
});

T('★連鎖伏特：奇樹電球附 1 古舊(視為雷) → 20+20=40（HEAD 漏 → 20 FAIL）', () => {
  assert.equal(dmg('奇樹的霹靂電球|連鎖伏特', mkSelf(ELEBALL, [en(ANCIENT)])), 40);
  assert.equal(dmg('奇樹的霹靂電球|連鎖伏特', mkSelf(ELEBALL, [])), 20, 'baseline');
});

T('★泥巴伏特：附古舊(視為鬥) → 20+20=40（HEAD 漏 → 20 FAIL）', () => {
  assert.equal(dmg('泥巴魚|泥巴伏特', mkSelf(MUD, [en(ANCIENT)])), 40);
  assert.equal(dmg('泥巴魚|泥巴伏特', mkSelf(MUD, [en(PSY)])), 20, '非鬥 baseline');
});

T('★紅蓮引爆：附古舊(視為火) → 被當火丟棄（HEAD 漏 → 不丟）', () => {
  const ancient = en(ANCIENT), psy = en(PSY);
  const st = mkSelf(KNIGHT, [ancient, psy]);
  const out = ATTACK_POST.get('紅蓮鎧騎|紅蓮引爆')(st, 0, pool);
  // 古舊(視為火)應被丟到棄牌；基本超(非火)保留
  const act = out.players[0].active;
  const discardIids = out.players[0].discard.map(c => c.iid);
  assert.ok(discardIids.includes(ancient.iid), '古舊能量應被當火丟棄');
  assert.ok(act && act.energyAttached.some(e => e.iid === psy.iid), '基本超(非火)應保留');
});

console.log('\n依/有/丟某屬性能量 host-aware:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
