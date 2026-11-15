// server v1.86 的逐位元還原表（單一來源，Rule 38）。PRE＝錦標賽區塊前、TAIL＝區塊內；由 difflib 產生、驗證可逐位元還原成 e8d902f0。
import assert from 'node:assert/strict';
export const PAIRS_V186_PRE = [];
export const PAIRS_V186_TAIL = [["          else if (!isComm && cut.top8.has(p.uid)) result = '8強';\n          s.events.push({ eventId: a.eventId || null, eventName: a.eventName || '錦標賽', date: evDate,   // ⭐v1.86 帶賽事代號：個人參賽紀錄可直接點開那場的賽程（/champion-bracket）\n             format: a.format || 'single-elim', communityEvent: isComm, wins: evW.get(p.email) || 0, losses: evL.get(p.email) || 0, result });\n        }\n", "          else if (!isComm && cut.top8.has(p.uid)) result = '8強';\n          s.events.push({ eventName: a.eventName || '錦標賽', date: evDate, format: a.format || 'single-elim', communityEvent: isComm, wins: evW.get(p.email) || 0, losses: evL.get(p.email) || 0, result });\n        }\n"]];
function _applyGroup(s, pairs, tag) {
  const hits = pairs.map(([a]) => s.split(a).length - 1);
  if (hits.every((n) => n === 0)) return s;
  hits.forEach((n) => assert.equal(n, 1, 'v186 還原錨點必須恰好命中一次（' + tag + '）'));
  for (const [a, b] of pairs) s = s.replace(a, () => b);
  return s;
}
/** 錦標賽區塊或整份補丁：有本版痕跡才還原（每組各自全有或全無；命中的組每條恰好一次，否則 throw）。 */
export function revertAdminV186IfPresent(source) {
  let s = String(source).replace(/\r\n/g, '\n');
  s = _applyGroup(s, PAIRS_V186_TAIL, 'tail');
  s = _applyGroup(s, PAIRS_V186_PRE, 'pre');
  return s;
}
