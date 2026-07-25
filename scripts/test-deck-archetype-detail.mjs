// admin 牌組原型明細（v0.91/v0.92）守衛。
//   直接從 oracle-admin/server_admin_patch.js 抽出實際函式來跑，避免測試與實作漂移。
//
// 覆蓋三塊：
//   A. buildCasualCleanFilter — Wilson 拍板的新淨化規則：
//      「中途離開致勝」的場只在 finalTurn <= 2 時排除；打到第 3 回合以後才離開的仍納入。
//      ⚠finalTurn 是「完整回合數」：engine 只在後攻方結束回合時 +1，
//        故雙方的第 1 回合 finalTurn 都是 1；turn >= 3 ⇔ 雙方各完成 2 個完整回合。
//   B. wilsonLower — 遺珠之憾指標用的 Wilson score 下界（壓抑小樣本高勝率假象）
//   C. normCardName — 卡名正規化（同名不同插畫要合併成同一張）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i > 0, name + ' 應存在於 server_admin_patch.js');
  const indent = ' '.repeat(src.slice(0, i).length - src.lastIndexOf('\n', i) - 1);
  const end = src.indexOf('\n' + indent + '}', i);
  assert.ok(end > i, name + ' 找不到結尾');
  return src.slice(i, end + indent.length + 2);
}
// CASUAL_LEAVE_RE 是 const，單獨抓那一行
const reLine = src.split('\n').find((l) => l.includes('const CASUAL_LEAVE_RE'));
assert.ok(reLine, 'CASUAL_LEAVE_RE 應存在');
const api = new Function(reLine + '\n' + grabFn('buildCasualCleanFilter') + '\n' + grabFn('wilsonLower')
  + '\n' + grabFn('normCardName')
  + '\nreturn { buildCasualCleanFilter, wilsonLower, normCardName, CASUAL_LEAVE_RE };')();

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

/** 用 filter 的 $or 條件模擬 mongo 比對一筆紀錄是否納入統計。 */
function included(filter, rec) {
  return filter.$or.some((cond) => {
    if (cond.winReason && cond.winReason.$not) return !cond.winReason.$not.test(rec.winReason || '');
    if (cond.finalTurn && cond.finalTurn.$gte !== undefined) {
      return typeof rec.finalTurn === 'number' && rec.finalTurn >= cond.finalTurn.$gte;
    }
    return false;
  });
}

// ── A. 淨化規則 ──────────────────────────────────────────────────────────────
T('一般對戰：正常結束的場一律納入', () => {
  const f = api.buildCasualCleanFilter({});
  assert.equal(included(f, { winReason: '取得所有獎賞卡', finalTurn: 12 }), true);
  assert.equal(included(f, { winReason: '對手牌庫抽完', finalTurn: 20 }), true);
});

T('⭐第 1 回合就中途離開 → 排除（房主開了局卻不在／一看開局就跑）', () => {
  const f = api.buildCasualCleanFilter({});
  assert.equal(included(f, { winReason: '對手中途離開', finalTurn: 1 }), false);
});

T('⭐第 2 回合離開 → 仍排除（Wilson 拍板：第 3 回合起才算）', () => {
  const f = api.buildCasualCleanFilter({});
  assert.equal(included(f, { winReason: '對手中途離開', finalTurn: 2 }), false);
});

T('⭐第 3 回合以後離開 → 納入（雙方各完成 2 個完整回合，都實際操作過）', () => {
  const f = api.buildCasualCleanFilter({});
  assert.equal(included(f, { winReason: '對手中途離開', finalTurn: 3 }), true);
  assert.equal(included(f, { winReason: '對手承認技不如人，先行離開了', finalTurn: 15 }), true);
});

T('離開措辭的各種變體都認得（v0.39 補的新措辭也要涵蓋）', () => {
  const f = api.buildCasualCleanFilter({});
  for (const r of ['對手中途離開', '離開房間', '對手斷線', '對手退出', '玩家不在場', 'disconnect', '技不如人', '先行離開']) {
    assert.equal(included(f, { winReason: r, finalTurn: 1 }), false, r + ' 在第1回合應被排除');
    assert.equal(included(f, { winReason: r, finalTurn: 9 }), true, r + ' 在第9回合應納入');
  }
});

T('舊資料沒有 finalTurn 欄位 → 離開場維持排除（向後相容，不會突然多出一堆場）', () => {
  const f = api.buildCasualCleanFilter({});
  assert.equal(included(f, { winReason: '對手中途離開' }), false);
});

T('excludeAI 預設只算有房號的對戰（本機與 AI 一律排除）', () => {
  assert.deepEqual(api.buildCasualCleanFilter({}).roomCode, { $type: 'string' });
  assert.equal(api.buildCasualCleanFilter({ excludeAI: false }).roomCode, undefined);
});

T('since 轉成 endedAt 條件', () => {
  assert.deepEqual(api.buildCasualCleanFilter({ since: 1700000000000 }).endedAt, { $gte: 1700000000000 });
  assert.equal(api.buildCasualCleanFilter({ since: 0 }).endedAt, undefined, 'since=0 代表全部時間，不該加條件');
});

// ── B. Wilson score 下界 ─────────────────────────────────────────────────────
T('⭐小樣本的高勝率會被大幅壓低（1勝0負不該被當成 100%）', () => {
  const small = api.wilsonLower(1, 1, 1.64);
  const big = api.wilsonLower(100, 100, 1.64);
  assert.ok(small < 0.5, '1戰1勝的下界應低於 50%，實際=' + small);
  assert.ok(big > 0.9, '100戰全勝的下界應該很高，實際=' + big);
  assert.ok(big > small);
});

T('樣本越多，下界越接近真實勝率', () => {
  const a = api.wilsonLower(6, 10, 1.64);     // 60%，n=10
  const b = api.wilsonLower(60, 100, 1.64);   // 60%，n=100
  const c = api.wilsonLower(600, 1000, 1.64); // 60%，n=1000
  assert.ok(a < b && b < c, '下界應隨樣本增加而上升：' + [a, b, c].join(' < '));
  assert.ok(c < 0.6 && c > 0.57, 'n=1000 時應很接近 0.6，實際=' + c);
});

T('n=0 回 0，不會除以零或回 NaN', () => {
  const v = api.wilsonLower(0, 0, 1.64);
  assert.equal(v, 0);
  assert.ok(!Number.isNaN(v));
});

T('全敗時下界為 0，不會是負數', () => {
  assert.equal(api.wilsonLower(0, 20, 1.64), 0);
});

// ── C. 卡名正規化 ────────────────────────────────────────────────────────────
T('去掉括號註解，讓同名不同插畫合併', () => {
  assert.equal(api.normCardName('老大的指令（烏羽）'), '老大的指令');
  assert.equal(api.normCardName('老大的指令(烏羽)'), '老大的指令');
  assert.equal(api.normCardName('裹蜜蟲'), '裹蜜蟲');
});
T('整個卡名都是括號時不會變成空字串', () => {
  assert.ok(api.normCardName('（測試）').length > 0);
});

// ── D. 結構：湊 60 張的 PTCG 規則不可被改掉 ──────────────────────────────────
T('結構：build60 有套用同名 4 張上限、ACE SPEC 1 張、基本能量無上限', () => {
  const i = src.indexOf('function build60(');
  assert.ok(i > 0, 'build60 應存在');
  const block = src.slice(i, i + 1600);
  assert.ok(block.includes('Math.min(copies, 4)'), '應有同名 4 張上限');
  assert.ok(block.includes('isAceSpec'), '應處理 ACE SPEC 每副 1 張');
  assert.ok(block.includes('isBasicEnergy'), '基本能量應排除於 4 張上限之外');
  assert.ok(block.includes('60 - total'), '應有湊滿/截斷到 60 張的處理');
});
T('結構：遺珠之憾排除必含卡與基本能量，且有雙側樣本門檻', () => {
  const i = src.indexOf('const gems = cards.filter');
  assert.ok(i > 0, '遺珠篩選應存在');
  const block = src.slice(i, i + 900);
  assert.ok(block.includes('!c.isInclude'), '必含卡(inclusion 恆 100%)必須排除');
  assert.ok(block.includes('isBasicEnergy'), '基本能量必須排除');
  assert.ok(block.includes('nWith >= 8') && block.includes('nWithout >= 8'), '有放與沒放兩側都要有樣本門檻');
  assert.ok(block.includes('wilsonLower'), '必須用 Wilson 下界而非勝率點估計');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
