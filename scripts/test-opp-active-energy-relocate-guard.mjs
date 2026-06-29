/**
 * 守衛：凡卡面「搬移『對手』戰鬥位能量到『存活處』(改附對手備戰 / 放回對手手牌)」的招式,
 * 必須在已處理 allowlist 內(該招式 postFn/resolver 已用 _koDefenderSnapshot 處理 active=null)。
 * 新增同類卡 → FAIL,提醒:postFn 需處理對手已 KO(active=null)走 getKODefenderEnergyInDiscard 快照
 * + resolver 用 pluckOppEnergyActiveOrDiscard(source-agnostic)。見 reference-koed-defender-relocate-guard。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
// 已處理(postFn/resolver 已 KO-safe):cardName|attackName
const HANDLED = new Set(['耿鬼ex|戲法舞步','超能妙喵|戲法舞步','高傲雉雞|反轉之風','呆呆王|付諸東流','帕底亞 肯泰羅|上搗角擊','火箭隊的閃電鳥|阻礙之翼','章魚桶|水流清洗']);
// 搬「對手」戰鬥位能量到存活處(備戰/手牌)
const relocateRe = /對手.{0,10}戰鬥.{0,4}(場|寶可夢).{0,30}能量/;
const survivingRe = /(改附.{0,8}(對手|備戰).{0,8}備戰|改附於對手的備戰|放回對手的手牌|放回對手手牌)/;
const found = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    for (const a of (c.attacks || [])) {
      const eff = a.effect || '';
      if (relocateRe.test(eff) && survivingRe.test(eff)) found.push(`${c.name}|${a.name}`);
    }
  }
}
const set = new Set(found);
const unhandled = [...set].filter(k => !HANDLED.has(k));
const stale = [...HANDLED].filter(k => !set.has(k));
let fail = 0;
if (unhandled.length) { console.log('  FAIL 新增未處理的「搬對手戰鬥位能量到存活處」招式:', unhandled.join(', '), '\n    → postFn 需處理 active=null 走 getKODefenderEnergyInDiscard 快照 + resolver 用 pluckOppEnergyActiveOrDiscard'); fail++; }
else console.log('  OK 無新增未處理招式(已涵蓋', set.size, '個)');
if (stale.length) { console.log('  WARN allowlist 有卡面已不匹配(可能改名/輪替):', stale.join(', ')); }
console.log('\n搬對手戰鬥位能量守衛:' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
