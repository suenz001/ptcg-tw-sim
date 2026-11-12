// 本機雙人視角：執行對戰頁真正的 myIdx 運算式，不在測試複製判準。
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = '262d3b5f89ce10638efe399e68c521b44ec38d6d';
const REL = 'src/routes/game/+page.svelte';
const dir = mkdtempSync(join(tmpdir(), 'v6639-'));
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { if (!(e instanceof assert.AssertionError)) throw e; fail++; console.log('FAIL ' + name + ': ' + e.message.slice(0, 220)); }
}
export function viewDeclaration(source) {
  const start = /  const myIdx\s+= \$derived<0 \| 1>\(/g;
  const matches = [...source.matchAll(start)];
  assert.equal(matches.length, 1, 'myIdx 宣告必須唯一');
  const a = matches[0].index, b = source.indexOf('  const oppIdx', a);
  assert.ok(b > a, 'myIdx 結束錨點缺失');
  return source.slice(a, b);
}
async function load(source) {
  const decl = viewDeclaration(source);
  const code = `import { actionResponsibility } from './src/lib/game/action-responsibility';
    import { promoteModalSeats } from './src/lib/game/modal-slots';
    export { applyAction, createGame } from './src/lib/game/engine';
    export { GameActions } from './src/lib/game/actions';
    export function view(ctx) {
      const {game, mode='local', aiPlayerIndex=null, myPlayerIndex=null, isSpectator=false, spectatorView='auto'}=ctx;
      const aIdx=game?.activePlayerIndex??0; const $derived=x=>x;
      ${decl}
      return myIdx;
    }`;
  const out = await build({ stdin: { contents: code, resolveDir: ROOT, loader: 'ts' }, bundle: true,
    platform: 'node', format: 'cjs', write: false, logLevel: 'silent', tsconfigRaw: {},
    alias: { $lib: join(ROOT, 'src/lib') },
    plugins: [{ name: 'app-paths', setup(b) {
      b.onResolve({ filter: /^\$app\/paths$/ }, () => ({ path: 'paths', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const base="";export const assets="";' }));
    }}] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, createRequire(import.meta.url));
  return m.exports;
}
async function reactiveFixture(source) {
  // 原頁的視角宣告交給真正 Svelte 編譯器；fixture 只提供輸入及可觀察的手牌 DOM。
  const app = `<script lang="ts">
    import {tick} from 'svelte';
    import {actionResponsibility} from '$lib/game/action-responsibility';
    import {promoteModalSeats} from '$lib/game/modal-slots';
    let ctx = $state({game:null,mode:'local',aiPlayerIndex:null,myPlayerIndex:null,isSpectator:false,spectatorView:'auto'});
    window.__hotseatSet = value => { ctx = value; return tick(); };
    const game=$derived(ctx.game),mode=$derived(ctx.mode),aiPlayerIndex=$derived(ctx.aiPlayerIndex),myPlayerIndex=$derived(ctx.myPlayerIndex);
    const isSpectator=$derived(ctx.isSpectator),spectatorView=$derived(ctx.spectatorView),aIdx=$derived(game?.activePlayerIndex??0);
    ${viewDeclaration(source)}
    const myPlayer=$derived(game?game.players[myIdx]:null);
    </script><main data-seat={myIdx}>{#each myPlayer?.hand??[] as card (card.iid)}<span data-hand={card.iid}>{card.iid}</span>{/each}</main>`;
  const js = compile(app, { generate: 'client', filename: 'HotseatFixture.svelte' }).js.code;
  // 同一 bundle 內 mount，避免載入兩份 Svelte runtime。
  const mounted = await build({ stdin: { contents: `import {mount} from 'svelte';\n${js}\nmount(HotseatFixture,{target:document.body});`, resolveDir: ROOT, loader: 'js' },
    bundle: true, write: false, format: 'iife', conditions: ['browser'], logLevel: 'silent', tsconfigRaw: {}, alias: { $lib: join(ROOT, 'src/lib') } });
  return mounted.outputFiles[0].text;
}
const state = (active = 0) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: active, firstPlayerIdx: active,
  turn: 2, pendingSelection: null, pendingPrizes: [0, 0], setupDone: [true, true],
  players: [0, 1].map(i => ({ active: { iid: 'active-' + i }, bench: [{ iid: 'bench-' + i }], hand: [{ iid: 'hand-' + i }] })) });
const context = game => ({ game });
function cases(M) {
  const result = {};
  for (const a of [0, 1]) {
    const other = 1 - a;
    const g = state(a);
    result['普通回合' + a] = M.view(context(g)) === a;
    const ko = structuredClone(g); ko.players[other].active = null;
    result['防守方補位' + a] = M.view(context(ko)) === other;
    ko.pendingPrizes[a] = 1;
    result['攻擊方取獎與防守方補位並行' + a] = M.view(context(ko)) === other;
    const self = structuredClone(g); self.players[a].active = null; self.pendingPrizes[other] = 1;
    result['自己昏厥且對方待取獎' + a] = M.view(context(self)) === a;
    const both = structuredClone(ko); both.players[a].active = null; both.pendingPrizes = [1, 1];
    result['雙昏厥下一回合方先補位' + a] = M.view(context(both)) === other;
    both.players[other].active = { iid: 'promoted' };
    result['雙昏厥第二位跟隨' + a] = M.view(context(both)) === a;
    const ps = structuredClone(ko); ps.pendingSelection = { actorIdx: a, sourcePlayerIdx: other };
    result['選牌優先於補位與獎賞' + a] = M.view(context(ps)) === a;
    ps.pendingSelection = { actorIdx: other, sourcePlayerIdx: a };
    result['非回合方選牌按actor而非來源' + a] = M.view(context(ps)) === other;
    const end = structuredClone(ko); end.turnPhase = 'end'; end.endTurnContinueAfterKO = a;
    result['檢查後補位' + a] = M.view(context(end)) === other;
    const prize = structuredClone(g); prize.pendingPrizes[other] = 1;
    result['原對方獎賞視角保留' + a] = M.view(context(prize)) === other;
    prize.pendingPrizes[other] = 0;
    result['必要選擇完成回回合方' + a] = M.view(context(prize)) === a;
    for (const seat of [0, 1]) {
      result[`線上座位固定${a}/${seat}`] = M.view({ ...context(ko), mode: 'online', myPlayerIndex: seat, aiPlayerIndex: 1 }) === seat;
      result[`AI人類視角固定${a}/${seat}`] = M.view({ ...context(ko), aiPlayerIndex: 1 - seat }) === seat;
      result[`觀戰手動視角${a}/${seat}`] = M.view({ ...context(ko), mode: 'online', isSpectator: true, spectatorView: seat ? 'p2' : 'p1' }) === seat;
    }
    result['觀戰自動仍跟回合方' + a] = M.view({ ...context(ko), mode: 'online', isSpectator: true }) === a;
    result['終局不亂翻' + a] = M.view(context({ ...ko, phase: 'game-over' })) === a;
    const before = JSON.stringify(ko); M.view(context(ko));
    result['視角不改盤面' + a] = JSON.stringify(ko) === before;
  }
  const setup = { ...state(), phase: 'setup', setupDone: [false, false] };
  result['開局原先P1'] = M.view(context(setup)) === 0;
  setup.setupDone[0] = true; result['開局原先P2'] = M.view(context(setup)) === 1;
  setup.openingChoicePending = [false, true]; result['開局互動選擇不變'] = M.view(context(setup)) === 1;
  result['空盤面仍有預設視角'] = M.view({ game: null }) === 0;
  return result;
}
try {
  const pageArg = process.argv.find(x => x.startsWith('--page-source='));
  const src = readFileSync(pageArg ? pageArg.slice('--page-source='.length) : join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
  const M = await load(src), current = cases(M);
  const pool = new Map();
  for (const set of JSON.parse(readFileSync(join(ROOT, 'static/cards/index.json'), 'utf8')))
    for (const c of JSON.parse(readFileSync(join(ROOT, 'static/cards', set.code + '.json'), 'utf8'))) pool.set(String(c.id), c);
  const basic = [...pool.values()].find(c => c.supertype === 'Pokemon' && c.stage === 'Basic' && !c.abilities?.length && c.hp >= 120);
  let seq = 0;
  const instance = () => ({ iid: 'v6639-' + ++seq, cardId: String(basic.id), damage: 0, energyAttached: [] });
  const real = M.createGame({ name: 'P1', entries: [{ cardId: basic.id, count: 60 }] }, { name: 'P2', entries: [{ cardId: basic.id, count: 60 }] }, pool);
  Object.assign(real, { phase: 'playing', turnPhase: 'end', turn: 4, activePlayerIndex: 0, firstPlayerIdx: 0,
    setupDone: [true, true], pendingSelection: null, pendingPrizes: [1, 0], log: [] });
  real.players = real.players.map((p, i) => ({ ...p, active: i ? null : instance(), bench: [instance(), instance()],
    hand: [instance()], deck: Array.from({ length: 10 }, instance), prizes: Array.from({ length: 6 }, instance), discard: [] }));
  check('真引擎補位前正確手牌座位', () => assert.equal(M.view(context(real)), 1));
  const promoted = M.applyAction(real, M.GameActions.sendNewActive(real.players[1].bench[1].iid, 1), pool);
  check('真引擎派出所選寶可夢', () => assert.equal(promoted.players[1].active?.iid, real.players[1].bench[1].iid));
  check('補位後切回仍待領獎賞玩家', () => assert.equal(M.view(context(promoted)), 0));
  check('補位不偷換原盤面或拿獎賞', () => { assert.equal(real.players[1].active, null); assert.equal(promoted.pendingPrizes[0], 1); });
  const rewarded = M.applyAction(promoted, M.GameActions.takePrizes(1, 0, 0), pool);
  check('真引擎取獎合法完成', () => { assert.equal(rewarded.pendingPrizes[0], 0); assert.equal(rewarded.players[0].prizes.length, 5); });
  check('取獎後跟隨引擎目前回合方', () => assert.equal(M.view(context(rewarded)), rewarded.activePlayerIndex));
  for (const [name, ok] of Object.entries(current)) check(name, () => assert.equal(ok, true));
  // 視角輸出真正接到雙端手牌，不只留一個沒有消費者的函式。
  check('手機仍接中央myIdx', () => assert.match(src, /<MobilePortraitBattle\s+[\s\S]*?\{myIdx\}/));
  check('桌機手牌仍讀myPlayer', () => assert.match(src, /\{#each dedupeByIid\(myPlayer\?\.hand\)/));
  const mobile = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
  check('手機myPlayer由同一視角取得', () => assert.match(mobile, /myPlayer = \$derived\(game\.players\[myIdx\]\)/));
  check('手機手牌實際讀myPlayer', () => assert.match(mobile, /\{#each dedupeByIid\(myPlayer\.hand\)/));
  let baseSource = null;
  if (!process.argv.includes('--no-base')) {
    if (!hasBaseCommit(ROOT, BASE)) shallowSkip('v6639 HEAD-FAIL', '需要v6.638 BASE');
    else {
      const blob = readBaseBlob(ROOT, BASE, REL); assert.equal(blob.ok, true);
      baseSource = blob.out;
      const old = cases(await load(blob.out));
      for (const name of Object.keys(current)) {
        const changed = /防守方補位|攻擊方取獎與防守方補位並行|自己昏厥且對方待取獎|雙昏厥第二位跟隨|非回合方選牌按actor而非來源|檢查後補位/.test(name);
        check((changed ? 'HEAD-FAIL ' : '正對照 BASE/HEAD ') + name, () => {
          assert.equal(current[name], true); assert.equal(old[name], !changed);
        });
      }
    }
  }
  if (!process.argv.includes('--no-browser')) {
    const chromium = pwChromium('v6639 真Svelte視角響應');
    const browser = chromium && await pwLaunchWith(chromium, 'v6639 真Svelte視角響應');
    if (browser) try {
      for (const [tag, source] of [['HEAD', src], ...(baseSource ? [['BASE', baseSource]] : [])]) {
        const code = await reactiveFixture(source);
        for (const width of [390, 1366]) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          const errors = []; page.on('pageerror', e => errors.push(e.message));
          await page.setContent('<!doctype html><html><body></body></html>');
          await page.addScriptTag({ content: code });
          for (const [label, g, seat, changed] of [
            ['原回合', state(), 0, false],
            ['昏厥且攻擊方有獎賞', { ...state(), players: [state().players[0], { ...state().players[1], active: null }], pendingPrizes: [1, 0] }, 1, true],
            ['非回合方選牌', { ...state(), pendingSelection: { actorIdx: 1, sourcePlayerIdx: 0 } }, 1, true],
            ['選擇完成返回', state(), 0, false],
          ]) {
            await page.evaluate(game => window.__hotseatSet({ game, mode: 'local', aiPlayerIndex: null, myPlayerIndex: null, isSpectator: false, spectatorView: 'auto' }), g);
            const actual = await page.locator('main').getAttribute('data-seat');
            const hands = await page.locator('[data-hand]').evaluateAll(es => es.map(e => e.getAttribute('data-hand')));
            check(`真Svelte ${tag}/${width} ${label}`, () => {
              const expected = tag === 'BASE' && changed ? 0 : seat;
              assert.equal(Number(actual), expected); assert.deepEqual(hands, ['hand-' + expected]);
            });
          }
          check(`真Svelte ${tag}/${width} 無執行錯誤`, () => assert.deepEqual(errors, []));
          await page.close();
        }
      }
    } finally { await browser.close(); }
  }
  console.log(`v6.639 本機雙人視角：${pass} PASS / ${fail} FAIL`);
  if (fail) process.exitCode = 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
