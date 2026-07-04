/** v5.868 魔牆人偶|相仿秀 修玩家回報：原「自動執行對手手牌第一張支援者」→ 沒讓玩家查看對手手牌、
 *  也沒讓玩家選。卡面：「查看對手的手牌。若希望，選擇1張其中的支援者卡，將那個效果作為這個招式的
 *  效果使用。」改為開 hand-choose picker(sourcePlayerIdx=對手 → 揭示對手手牌),validIids=支援者,
 *  minCount0=可不選。複製效果後該支援者卡留在對手手牌(卡面無棄牌字樣)。
 *
 *  HEAD-FAIL：修前 regPost 自動執行,不開 mrmime-copycat-pick picker → Test A FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.mm-s.js'), E = join(ROOT, '.mm-e.ts'), O = join(ROOT, '.mm-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const MRMIME = '9872' /*魔牆人偶*/, LILLIE = '14090' /*莉莉艾的決意=支援者(棄手牌抽6)*/,
      FILLER = '18519' /*基本水能量(當填充/牌庫)*/, POKE = '14319' /*走路草(對手非支援者手牌)*/;
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk() {
  const oppLillie = inst(LILLIE), oppPoke = inst(POKE);
  return {
    st: {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
      players: [
        { name: 'ATK', active: inst(MRMIME), bench: [], hand: [inst(FILLER), inst(FILLER)], deck: Array.from({length:10},()=>inst(FILLER)), discard: [], prizes: [1,1,1,1,1,1] },
        { name: 'OPP', active: inst(POKE), bench: [], hand: [oppLillie, oppPoke], deck: [inst(FILLER)], discard: [], prizes: [1,1,1,1,1,1] },
      ],
    }, oppLillie, oppPoke,
  };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★相仿秀開 hand-choose picker(查看對手手牌,選支援者,非自動執行)', () => {
  const { st } = mk();
  const out = ATTACK_POST.get('魔牆人偶|相仿秀')(st, 0, pool, {});
  const ps = out.pendingSelection;
  assert.ok(ps, '應開 pendingSelection(非自動執行)');
  assert.equal(ps.type, 'hand-choose', 'picker 型別 hand-choose');
  assert.equal(ps.effectKey, 'mrmime-copycat-pick', 'effectKey');
  assert.equal(ps.sourcePlayerIdx, 1, 'sourcePlayerIdx=對手(查看對手手牌)');
  assert.equal(ps.minCount, 0, 'minCount0=若希望可不選');
  // validIids 只含對手支援者(莉莉艾),不含走路草
  assert.equal(ps.params.validIids.length, 1, '候選只 1 張支援者');
});

T('★選對手支援者 → 複製其效果(攻擊方抽牌),且該支援者留在對手手牌(不棄)', () => {
  const { st, oppLillie } = mk();
  const opened = ATTACK_POST.get('魔牆人偶|相仿秀')(st, 0, pool, {});
  const out = applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: [oppLillie.iid] }, pool);
  // 莉莉艾:攻擊方手牌全回牌庫+抽6 → 攻擊方手牌應變多(>2)
  assert.ok(out.players[0].hand.length >= 5, `攻擊方應複製莉莉艾抽牌,手牌${out.players[0].hand.length}`);
  // 對手的莉莉艾卡仍在對手手牌(未進棄牌區)
  const stillInHand = out.players[1].hand.some(c => c.iid === oppLillie.iid);
  assert.ok(stillInHand, '對手支援者應留在對手手牌(卡面無棄牌)');
  assert.equal(out.players[1].discard.length, 0, '對手棄牌區不應多出被複製的支援者');
});

T('若希望=不選(RESOLVE 空) → 無效果,支援者留手牌', () => {
  const { st, oppLillie } = mk();
  const opened = ATTACK_POST.get('魔牆人偶|相仿秀')(st, 0, pool, {});
  const out = applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool);
  assert.ok(out.players[1].hand.some(c => c.iid === oppLillie.iid), '不選時支援者留手牌');
});

console.log('\n相仿秀查看對手手牌+選支援者複製(v5.868):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
