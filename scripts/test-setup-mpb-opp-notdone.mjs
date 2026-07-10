// v0.74 守衛:setup 開局「一方 mpb、對手還沒放出場(未setupDone)」時 currentActorSeat 應回 -1(雙方都可動作),
//   非把 mpb 擁有者當唯一該動作者(HEAD 回 0→誤判他閒置敗+對手放置UI被gate=deadlock,信諺vs慶仔實例)。
//   抽 server_admin_patch.js 的 currentActorSeat eval。HEAD-FAIL:HEAD 回 0。
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
const patchPath = process.argv[2] || 'oracle-admin/server_admin_patch.js';
const patch = readFileSync(patchPath, 'utf8');
const start = patch.indexOf('function currentActorSeat(gs) {');
assert(start >= 0, '找不到 currentActorSeat');
let i = patch.indexOf('{', start), depth = 0, end = -1;
for (; i < patch.length; i++) { if (patch[i] === '{') depth++; else if (patch[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } } }
const currentActorSeat = eval('(' + patch.slice(start, end) + ')');
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

// 信諺(seat0) mpb + 慶仔(seat1) 還沒放出場(setupDone[1]=false) — 比賽 dump 確切狀態
const bug = { phase:'setup', setupDone:[true,false], mulliganCounts:[0,1],
  pendingMulliganDraw:[0,0], mulliganRevealConfirmed:[true,true], mulliganPostBenchOpen:[true,false] };
T('信諺mpb+慶仔未放出場 → -1(雙方都可動作,不誤判信諺敗) [HEAD-FAIL:回0]', () => {
  assert.equal(currentActorSeat(bug), -1, '應回 -1;實際 '+currentActorSeat(bug));
});
// v5.911 保留:對手已 setupDone、我在 mpb → 我單獨該動作(回 mpb 擁有者)
const keep = { phase:'setup', setupDone:[true,true], mulliganCounts:[0,1],
  pendingMulliganDraw:[0,0], mulliganRevealConfirmed:[true,true], mulliganPostBenchOpen:[true,false] };
T('信諺mpb+慶仔已setupDone → 0(mpb擁有者單獨,v5.911保留)', () => {
  assert.equal(currentActorSeat(keep), 0, '應回 0;實際 '+currentActorSeat(keep));
});
// 收斂:慶仔放出場後(sd=[T,T]) mpb 清掉前仍先由信諺完成 mpb;若信諺先完成 mpb→放出場階段回 1(慶仔)
const afterPlace = { phase:'setup', setupDone:[true,false], mulliganCounts:[0,1],
  pendingMulliganDraw:[0,0], mulliganRevealConfirmed:[true,true], mulliganPostBenchOpen:[false,false] };
T('信諺mpb已完成(mpb清空)+慶仔未放出場 → 1(慶仔該放出場,重抽多需等已滿足)', () => {
  assert.equal(currentActorSeat(afterPlace), 1, '應回 1;實際 '+currentActorSeat(afterPlace));
});
// 雙方都 mpb → -1
const bothMpb = { phase:'setup', setupDone:[true,true], mulliganCounts:[1,1],
  pendingMulliganDraw:[0,0], mulliganRevealConfirmed:[true,true], mulliganPostBenchOpen:[true,true] };
T('雙方都 mpb → -1', () => { assert.equal(currentActorSeat(bothMpb), -1); });
console.log(`\n=== setup mpb-opp-notdone (v0.74): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
