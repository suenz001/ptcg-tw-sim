// 瑞士制純函式回歸網：輪數/TopCut 表、配對(避重賽/Bye/覆蓋全員/N=2..17不卡)、破同分(OWP floor/Bye排除)、種子交叉。
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.sw-e.ts'), O = join(ROOT, '.sw-o.mjs');
process.on('exit', () => { for (const p of [E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export * from './src/lib/tournament/swiss';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error' });
const S = await import(pathToFileURL(O).href);
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// 建 player 輔助
let _i = 0;
const mk = (over = {}) => ({ uid: 'u' + (++_i), name: 'P' + _i, matchPoints: 0, opponents: [], results: [], byes: 0, ...over });
// 決定性 rng（可重現）
const seededRng = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

T('swissRoundsForCount 對照表', () => {
  const f = S.swissRoundsForCount;
  assert.equal(f(2), 3); assert.equal(f(8), 3); assert.equal(f(9), 4); assert.equal(f(16), 4);
  assert.equal(f(17), 5); assert.equal(f(32), 5); assert.equal(f(33), 6); assert.equal(f(128), 7); assert.equal(f(129), 8);
});
T('topCutSizeForCount 對照表(≤16→4 / ≥17→8)', () => {
  const f = S.topCutSizeForCount;
  assert.equal(f(3), 2); assert.equal(f(4), 4); assert.equal(f(16), 4); assert.equal(f(17), 8); assert.equal(f(64), 8);
});

// ── 配對：第1輪覆蓋全員、無自我配對、Bye 正確 ──
function validateRound(players, pairings, label) {
  const active = players.filter(p => !p.dropped);
  const seen = new Set();
  let byeCount = 0;
  for (const m of pairings) {
    assert(m.p1, label + ' p1 不可空');
    assert(!seen.has(m.p1), label + ' p1 重複配對:' + m.p1); seen.add(m.p1);
    if (m.p2 === null) { byeCount++; }
    else { assert(m.p1 !== m.p2, label + ' 不可自我配對'); assert(!seen.has(m.p2), label + ' p2 重複:' + m.p2); seen.add(m.p2); }
  }
  assert.equal(seen.size, active.length, label + ' 必須涵蓋所有在場玩家 (' + seen.size + '/' + active.length + ')');
  assert(byeCount <= 1, label + ' 至多 1 個 Bye');
  assert.equal(byeCount, active.length % 2, label + ' 奇數才有 Bye');
}
T('第1輪 N=2..17 都不卡、涵蓋全員、Bye 正確', () => {
  for (let n = 2; n <= 17; n++) {
    const players = Array.from({ length: n }, () => mk());
    const pr = S.pairSwissRound(players, 1, seededRng(n + 7));
    validateRound(players, pr, 'N=' + n);
  }
});
T('奇數場 Bye 給最低名次且未拿過 Bye 者', () => {
  // 5 人，名次由積分定；最低分 u 應拿 Bye；但若最低分已拿過 Bye，給次低未拿過者
  const ps = [mk({matchPoints:9}), mk({matchPoints:6}), mk({matchPoints:6}), mk({matchPoints:3}), mk({matchPoints:0, byes:1})];
  const pr = S.pairSwissRound(ps, 2, seededRng(3));
  const bye = pr.find(m => m.p2 === null);
  assert(bye, '應有 Bye');
  // 最低分(matchPoints:0)已拿過 Bye → Bye 應給「次低未拿過」= matchPoints:3 那位
  assert.equal(bye.p1, ps[3].uid, 'Bye 應給最低名次中未拿過 Bye 者(此處 matchPoints:3)，實際=' + bye.p1);
});
T('第2輪避免重賽(可避時不重配)', () => {
  // 4 人，u1 已跟 u2 打過、u3 跟 u4 打過；同分 → 應配成 u1-u3/u1-u4 類(不再 u1-u2)
  const ps = [
    mk({ matchPoints: 3, opponents: [] }), mk({ matchPoints: 3, opponents: [] }),
    mk({ matchPoints: 3, opponents: [] }), mk({ matchPoints: 3, opponents: [] }),
  ];
  ps[0].opponents = [ps[1].uid]; ps[1].opponents = [ps[0].uid];
  ps[2].opponents = [ps[3].uid]; ps[3].opponents = [ps[2].uid];
  const pr = S.pairSwissRound(ps, 2, seededRng(9));
  for (const m of pr) {
    if (m.p2 === null) continue;
    const a = ps.find(p => p.uid === m.p1);
    assert(!a.opponents.includes(m.p2), '不該重配已交手對手: ' + m.p1 + ' vs ' + m.p2);
  }
});
T('全員互相交手過 → 被迫 rematch 但仍涵蓋全員不崩', () => {
  const ps = [mk(), mk()]; ps[0].opponents = [ps[1].uid]; ps[1].opponents = [ps[0].uid];
  const pr = S.pairSwissRound(ps, 2, seededRng(1));
  validateRound(ps, pr, '強制rematch');
  assert.equal(pr.length, 1);
});
T('dropped 玩家不被配對', () => {
  const ps = [mk(), mk(), mk({ dropped: true })];
  const pr = S.pairSwissRound(ps, 2, seededRng(2));
  const ids = new Set(pr.flatMap(m => [m.p1, m.p2]).filter(Boolean));
  assert(!ids.has(ps[2].uid), 'dropped 不該出現');
  assert.equal(ids.size, 2);
});

// ── 破同分 OWP/OOWP ──
T('winPct 有 0.25 下限 + Bye 排除', () => {
  const allLoss = mk({ matchPoints: 0, results: ['L','L','L'] });
  assert.equal(S.winPct(allLoss), 0.25, '全敗應為下限 0.25');
  const oneWinTwoBye = mk({ matchPoints: 3 + 3 + 3, byes: 2, results: ['W','BYE','BYE'] });
  // 排除 2 個 Bye → 1 場、3 分 → 3/3=1.0
  assert.equal(S.winPct(oneWinTwoBye), 1.0, 'Bye 應排除，1勝→100%');
});
T('OWP/OOWP 計算 + Bye 不計入對手', () => {
  // u1 打贏 u2(強，全勝)、u3(弱)；u1 還有一個 Bye(不該計入 OWP)
  const u2 = mk({ uid: 'a', matchPoints: 6, results: ['W','W'] });          // winPct=1.0
  const u3 = mk({ uid: 'b', matchPoints: 0, results: ['L','L'] });          // winPct=0.25(下限)
  const u1 = mk({ uid: 'c', matchPoints: 9, byes: 1, results: ['W','W','BYE'], opponents: ['a','b'] });
  const st = S.computeStandings([u1, u2, u3]);
  const c = st.find(p => p.uid === 'c');
  assert(Math.abs(c.owp - (1.0 + 0.25) / 2) < 1e-9, 'OWP 應=(1.0+0.25)/2=0.625，實際=' + c.owp);
});
T('computeStandings 依積分→OWP 排序、rank 連號', () => {
  const a = mk({ uid: 'x', matchPoints: 9 }), b = mk({ uid: 'y', matchPoints: 6 }), c = mk({ uid: 'z', matchPoints: 6 });
  const st = S.computeStandings([b, c, a]);
  assert.equal(st[0].uid, 'x'); assert.deepEqual(st.map(p => p.rank), [1, 2, 3]);
});

// ── Top Cut 種子交叉 ──
const standOf = (uids) => uids.map((u, i) => ({ uid: u, name: u, matchPoints: 0, opponents: [], results: [], byes: 0, owp: 0, oowp: 0, rank: i + 1 }));
T('seedTopCut K=4 → 1v4, 2v3', () => {
  const pr = S.seedTopCut(standOf(['s1','s2','s3','s4']), 4);
  assert.equal(pr.length, 2);
  assert.deepEqual([pr[0].p1, pr[0].p2], ['s1','s4']);
  assert.deepEqual([pr[1].p1, pr[1].p2], ['s2','s3']);
});
T('seedTopCut K=8 → 1v8,4v5,2v7,3v6', () => {
  const pr = S.seedTopCut(standOf(['s1','s2','s3','s4','s5','s6','s7','s8']), 8);
  const pairs = pr.map(m => [m.p1, m.p2]);
  assert.deepEqual(pairs, [['s1','s8'],['s4','s5'],['s2','s7'],['s3','s6']]);
});
T('seedTopCut K=6(非2次方) → 種子1,2輪空 + 4v5,3v6', () => {
  const pr = S.seedTopCut(standOf(['s1','s2','s3','s4','s5','s6']), 6);
  // size=8: 種子1,2 對到 BYE → 輪空；4v5、3v6 對戰
  const byes = pr.filter(m => m.p2 === null).map(m => m.p1);
  assert.deepEqual(byes.sort(), ['s1','s2'], '前 2 種子應輪空，實際=' + byes);
  const games = pr.filter(m => m.p2 !== null).map(m => [m.p1, m.p2].sort().join('v'));
  assert(games.includes('s4v s5'.replace(' ','')) || games.includes('s4vs5'), '');
  assert(games.some(g => g === 's4vs5'), '應有 s4vs5，實際=' + games);
  assert(games.some(g => g === 's3vs6'), '應有 s3vs6，實際=' + games);
});


// ── 多輪完整模擬：跑滿輪數，驗證跨輪不變量(每人最多1 Bye、每輪涵蓋全員、積分累加正確) ──
T('完整模擬 N=10 跑 4 輪(跨輪 Bye≤1、每輪合法、積分一致)', () => {
  const rng = seededRng(42);
  let players = Array.from({ length: 10 }, () => mk());
  const rounds = S.swissRoundsForCount(10); // 4
  assert.equal(rounds, 4);
  for (let r = 1; r <= rounds; r++) {
    const pr = S.pairSwissRound(players, r, rng);
    validateRound(players, pr, 'sim R' + r);
    // 結算：隨機勝負(不容許平手)，Bye=+3
    const byUid = new Map(players.map(p => [p.uid, p]));
    for (const m of pr) {
      if (m.p2 === null) { const p = byUid.get(m.p1); p.matchPoints += 3; p.byes += 1; p.results.push('BYE'); continue; }
      const a = byUid.get(m.p1), b = byUid.get(m.p2);
      a.opponents.push(b.uid); b.opponents.push(a.uid);
      const aWin = rng() < 0.5;
      (aWin ? a : b).matchPoints += 3; (aWin ? a : b).results.push('W'); (aWin ? b : a).results.push('L');
    }
  }
  // 跨輪不變量
  for (const p of players) {
    assert(p.byes <= 1, p.uid + ' Bye 超過 1 次: ' + p.byes);
    assert.equal(p.results.length, rounds, p.uid + ' 場次數應=輪數');
    // 積分 = 3*(勝場+Bye場)
    const wins = p.results.filter(r => r === 'W' || r === 'BYE').length;
    assert.equal(p.matchPoints, wins * 3, p.uid + ' 積分與戰績不一致');
  }
  // 最終排名 + Top Cut 種子可順利產生
  const st = S.computeStandings(players);
  assert.equal(st.length, 10);
  const cut = S.seedTopCut(st, S.topCutSizeForCount(10)); // 取前4
  validateRound(st.slice(0,4).map(p=>({uid:p.uid})), cut, 'TopCut R1');
});


// ── buildSwissPlayersFromMatches：從對戰紀錄重建 standings ──
T('buildSwissPlayersFromMatches 重建積分/對手/Bye 正確', () => {
  const regs = [{uid:'a',name:'A'},{uid:'b',name:'B'},{uid:'c',name:'C'}];
  const matches = [
    { round:1, p1uid:'a', p2uid:'b', winnerUid:'a', bye:false },  // a 勝 b
    { round:1, p1uid:'c', p2uid:null, winnerUid:'c', bye:true },  // c 輪空
    { round:2, p1uid:'a', p2uid:'c', winnerUid:'c', bye:false },  // c 勝 a
  ];
  const ps = S.buildSwissPlayersFromMatches(matches, regs);
  const by = Object.fromEntries(ps.map(p=>[p.uid,p]));
  assert.equal(by.a.matchPoints, 3, 'a: 1勝=3'); assert.deepEqual(by.a.results.sort(), ['L','W']); assert.deepEqual(by.a.opponents.sort(), ['b','c']);
  assert.equal(by.b.matchPoints, 0, 'b: 1敗=0'); assert.deepEqual(by.b.opponents, ['a']);
  assert.equal(by.c.matchPoints, 6, 'c: Bye+1勝=6'); assert.equal(by.c.byes, 1); assert.deepEqual(by.c.results.sort(), ['BYE','W']); assert.deepEqual(by.c.opponents, ['a']);
  // 餵進 standings：c(6) > a(3) > b(0)
  const st = S.computeStandings(ps);
  assert.deepEqual(st.map(p=>p.uid), ['c','a','b']);
});
T('buildSwissPlayersFromMatches 無 winner(雙未進場) → 雙方記L不得分', () => {
  const ps = S.buildSwissPlayersFromMatches([{round:1,p1uid:'a',p2uid:'b',winnerUid:null,bye:false}], [{uid:'a',name:'A'},{uid:'b',name:'B'}]);
  const by = Object.fromEntries(ps.map(p=>[p.uid,p]));
  assert.equal(by.a.matchPoints,0); assert.equal(by.b.matchPoints,0);
  assert.deepEqual(by.a.results,['L']); assert.deepEqual(by.a.opponents,['b']);
});


// ── 完整端到端：瑞士→排名→Top Cut→冠軍（鏡射伺服器 advanceSwiss/checkRoundAdvance 編排）──
function fullSwissThenCut(N, rng) {
  // 建 N 人；matches 累積（{round,p1uid,p2uid,winnerUid,bye,phase}）
  let mk2 = [];
  for (let i=0;i<N;i++) mk2.push('p'+(i+1));
  const swissRounds = S.swissRoundsForCount(N);
  const topCut = S.topCutSizeForCount(N);
  const allMatches = [];
  const recordRound = (pairings, round, phase) => {
    for (const pr of pairings) {
      if (pr.p2 == null) { allMatches.push({round,p1uid:pr.p1,p2uid:null,winnerUid:pr.p1,bye:true,phase}); }
      else { const w = rng()<0.5?pr.p1:pr.p2; allMatches.push({round,p1uid:pr.p1,p2uid:pr.p2,winnerUid:w,bye:false,phase}); }
    }
  };
  // 第1輪（隨機）
  let players0 = mk2.map(u=>({uid:u,name:u,matchPoints:0,opponents:[],results:[],byes:0}));
  recordRound(S.pairSwissRound(players0, 1, rng), 1, 'swiss');
  // 後續瑞士輪
  for (let cur=1; cur<swissRounds; cur++) {
    const sw = allMatches.filter(m=>m.phase==='swiss');
    const players = S.buildSwissPlayersFromMatches(sw, mk2.map(u=>({uid:u,name:u})));
    recordRound(S.pairSwissRound(players, cur+1, rng), cur+1, 'swiss');
  }
  // 瑞士結束→standings→TopCut seed
  const swAll = allMatches.filter(m=>m.phase==='swiss');
  const players = S.buildSwissPlayersFromMatches(swAll, mk2.map(u=>({uid:u,name:u})));
  // 不變量：每人打滿 swissRounds、Bye≤1
  for (const pl of players) {
    assert.equal(pl.results.length, swissRounds, N+'人:'+pl.uid+' 瑞士場次應='+swissRounds+' 實='+pl.results.length);
    assert(pl.byes<=1, pl.uid+' Bye>1');
  }
  const standings = S.computeStandings(players);
  let cutRound = swissRounds+1;
  let alive = standings.slice(0, Math.min(topCut, standings.length)).map(p=>p.uid);
  let pairings = S.seedTopCut(standings, topCut);
  // 單淘汰直到剩 1 人
  let guard=0;
  while (true) {
    if (++guard>20) throw new Error('cut 迴圈未收斂');
    recordRound(pairings, cutRound, 'cut');
    const roundMatches = allMatches.filter(m=>m.phase==='cut'&&m.round===cutRound);
    const winners = roundMatches.map(m=>m.winnerUid).filter(Boolean);
    if (winners.length<=1) return { champ: winners[0], swissRounds, topCut, totalRounds: cutRound };
    // 下一 cut 輪：贏家相鄰配（單淘汰，奇數給 bye）
    const next=[]; let bye=null;
    let w=winners.slice();
    if (w.length%2===1) bye=w.pop();
    const ps=[]; for (let i=0;i<w.length;i+=2) ps.push({p1:w[i],p2:w[i+1]});
    if (bye) ps.push({p1:bye,p2:null});
    pairings=ps; cutRound++;
  }
}
T('端到端 瑞士→TopCut→冠軍：N=8/10/16/17 都收斂出唯一冠軍', () => {
  for (const N of [8,10,16,17]) {
    const r = fullSwissThenCut(N, seededRng(N*13+1));
    assert(r.champ, N+'人應產生冠軍'); 
    console.log('   N='+N+' → '+r.swissRounds+'瑞士輪, Top'+r.topCut+', 冠軍='+r.champ+' (共'+r.totalRounds+'輪)');
  }
});


T('雙方未進場(雙敗)跨輪累計：每場各記1敗,不重複不漏', () => {
  const regs=[{uid:'a',name:'A'},{uid:'b',name:'B'}];
  const matches=[
    {round:1,p1uid:'a',p2uid:'b',winnerUid:null,bye:false},
    {round:2,p1uid:'a',p2uid:'b',winnerUid:null,bye:false},
  ];
  const ps=S.buildSwissPlayersFromMatches(matches,regs);
  const by=Object.fromEntries(ps.map(p=>[p.uid,p]));
  assert.equal(by.a.results.filter(r=>r==='L').length, 2, 'a 兩場雙敗=2敗(非4非0)');
  assert.equal(by.a.matchPoints, 0, '雙敗 0 分');
  assert.equal(by.b.results.filter(r=>r==='L').length, 2);
});

console.log(`\n=== 瑞士制 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
