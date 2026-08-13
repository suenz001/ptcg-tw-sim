// v1.64 守衛：牌組環境報告圖（匯出 PNG）。
//
// 這個功能有一整排「做錯了完全不會報錯、只會默默產出一張騙人的圖」的地方，
// 而且圖是要發給玩家看的，錯了比後台顯示錯更難收拾。本檔專門釘住這些：
//
//   ① **趨勢的窗長**。後端沒有時間序列，只能靠兩次查詢相減推導前期。
//      窗必須是 N 與 2N —— 若寫成 30 天 vs 90 天，相減得到的是 **60 天**窗，
//      跟本期 30 天不等長，佔比與絕對量都不可比，箭頭方向直接是錯的。
//   ② **寬窗含本期，一定要相減**。忘了減就等於拿「近 60 天」當「前 30 天」，
//      數字看起來都很合理，只是全錯。
//   ③ **後端查詢有上限**（休閒 20000 場、錦標賽 200 場賽事，皆依時間新到舊）。
//      撞到上限時舊資料根本沒被掃到，相減會憑空生出一整片「使用率下降」。
//   ④ **drawImage 一張尚未 decode 的 Image 會靜默不畫也不報錯** —— 成品就是
//      logo 憑空消失，沒有任何錯誤訊息可查。必須 await img.decode()。
//   ⑤ **樣本不足的勝率**：後端已給 sampleOk，圖上必須照做，否則
//      「1 勝 0 負 = 100%」會被玩家截圖傳開。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ── 先把 miTrend 抽出來真的跑，不只做字串比對 ──────────────────────────────
function loadMiTrend() {
  const a = adm.indexOf('const MI_SCAN_CAP');
  const b = adm.indexOf('/** 產生一張報告圖');
  assert.ok(a > 0 && b > a, '找不到 MI_SCAN_CAP … miTrend 這一段');
  return new Function(adm.slice(a, b) + '\nreturn miTrend;')();
}
// ⚠不要在 top-level 直接呼叫並讓它 throw：那樣對 HEAD 跑會變成一行 stack trace，
//   看不出「少了哪些保護」。改成記成一條 FAIL，其餘各項照常各自報。
let miTrend = null;
try { miTrend = loadMiTrend(); }
catch (e) { console.log('FAIL 前提：抽不到報告圖的趨勢推導程式碼 ::', e.message); fail++; }
const needTrend = () => { assert.ok(miTrend, '沒有 miTrend（報告圖趨勢推導尚未實作）'); return miTrend; };

/** 造一組資料：cur = 本期(N 天)，wide = 寬窗(2N 天，**含本期**)。 */
function mk(curDecks, wideDecks, rows, wideRows, extra) {
  const s = (d, m) => Object.assign({ casualDecks: d, casualMatches: m === undefined ? d : m }, extra || {});
  return {
    cur: { scanned: s(curDecks), casual: { rows } },
    wide: { scanned: s(wideDecks), casual: { rows: wideRows } },
  };
}

T('⭐⭐前期＝寬窗減本期（忘了相減會拿「近 2N 天」當「前 N 天」，數字全錯但看起來合理）', () => {
  // 本期 100 副中用了 20 副（20%）；寬窗 200 副中共 30 副 → 前期 = 30-20 = 10 副 / 100 副 = 10%
  const { cur, wide } = mk(100, 200, [{ ruleId: 'a', usage: 20 }], [{ ruleId: 'a', usage: 30 }]);
  const t = needTrend()(30, cur, wide, 'casual');
  assert.ok(t.ok, '應可推導：' + t.reason);
  const d = t.by.get('a');
  assert.equal(d.isNew, false);
  assert.ok(Math.abs(d.dPP - 10) < 1e-9,
    '應為 +10.0pp（20% − 10%），實得 ' + d.dPP + ' —— 若得 +5 代表沒相減（誤用 30/200=15%）');
});

T('⭐使用率比的是「佔比」不是絕對場數（兩期總對局數會因活動大幅波動）', () => {
  // 絕對數翻倍（20→40）但總量也翻倍 → 佔比不變 → 不該有趨勢
  const { cur, wide } = mk(200, 300, [{ ruleId: 'a', usage: 40 }], [{ ruleId: 'a', usage: 60 }]);
  const t = needTrend()(30, cur, wide, 'casual');
  assert.ok(t.ok);
  assert.ok(Math.abs(t.by.get('a').dPP) < 1e-9,
    '佔比同為 20% 應無變化，實得 ' + t.by.get('a').dPP + 'pp —— 比絕對場數的話會誤報大幅成長');
});

T('⭐新原型標 NEW 而非算出假暴漲（新彈發售週前期本來就接近 0）', () => {
  const { cur, wide } = mk(100, 200, [{ ruleId: 'a', usage: 18 }], [{ ruleId: 'a', usage: 20 }]);
  const t = needTrend()(30, cur, wide, 'casual');
  assert.equal(t.by.get('a').isNew, true, '前期僅 2 副應標 NEW，不該算 Δ');
});

T('⭐⭐撞到伺服器查詢上限時整張圖不顯示趨勢（否則會憑空生出一片下降）', () => {
  const { cur, wide } = mk(100, 200, [{ ruleId: 'a', usage: 20 }], [{ ruleId: 'a', usage: 30 }]);
  wide.scanned.casualMatches = 20000;        // 後端 limit(20000)
  const t = needTrend()(30, cur, wide, 'casual');
  assert.equal(t.ok, false, '應停用趨勢');
  assert.ok(/上限/.test(t.reason), '理由要說得出是查詢上限，實得：' + t.reason);
});

T('⭐前期樣本遠少於本期時不顯示趨勢（資料還沒累積滿兩期，會全面假上升）', () => {
  const { cur, wide } = mk(100, 110, [{ ruleId: 'a', usage: 20 }], [{ ruleId: 'a', usage: 22 }]);
  const t = needTrend()(30, cur, wide, 'casual');
  assert.equal(t.ok, false, '前期只有 10 副（本期的 10%）應停用趨勢');
});

T('選「全部時間」沒有可對比的前期', () => {
  const { cur, wide } = mk(100, 200, [{ ruleId: 'a', usage: 20 }], [{ ruleId: 'a', usage: 30 }]);
  assert.equal(needTrend()(0, cur, wide, 'casual').ok, false);
});

T('前期查詢失敗時降級為快照，不可整個炸掉', () => {
  const { cur } = mk(100, 200, [{ ruleId: 'a', usage: 20 }], []);
  const t = needTrend()(30, cur, null, 'casual');
  assert.equal(t.ok, false);
  assert.ok(t.reason, '要有可顯示的理由');
});

// ── 呼叫端：窗長必須是 N 與 2N ────────────────────────────────────────────
T('⭐⭐寬窗查詢用 days×2（寫死 90 天之類會讓窗長不等、箭頭方向錯）', () => {
  const i = adm.indexOf('window.openMetaImageExport');
  const body = adm.slice(i, adm.indexOf('\n};', i));
  assert.ok(/days\s*\*\s*2\s*\*\s*86400000/.test(body),
    '寬窗必須是 days*2 天 —— 用其他倍率會讓前期窗長與本期不等，佔比與絕對量都不可比');
});

// ── 繪圖：那些「錯了只會靜默出錯圖」的點 ──────────────────────────────────
T('⭐⭐logo 用 await img.decode()，不可只靠 onload/直接 drawImage', () => {
  const i = adm.indexOf('async function miLogo(');
  const body = adm.slice(i, adm.indexOf('\n}', i));
  assert.ok(/await\s+img\.decode\(\)/.test(body),
    'drawImage 一張還沒 decode 完的 Image 會**靜默不畫也不報錯**，成品就是 logo 消失');
  assert.ok(/catch/.test(body), 'logo 載入失敗要 fallback，不能讓整張圖產不出來');
});

T('⭐固定 2× 輸出，不可用 devicePixelRatio（輸出檔跟本機螢幕無關）', () => {
  assert.ok(/S:\s*2\b/.test(adm.slice(adm.indexOf('const MI = {'), adm.indexOf('const MI_SCAN_CAP'))),
    'MI.S 應固定為 2');
  const i = adm.indexOf('async function miDraw(');
  const body = adm.slice(i, i + 3000);
  assert.ok(!/devicePixelRatio/.test(body),
    '不可用 devicePixelRatio —— 圖是要傳給別人的，跟產圖者的螢幕 DPR 無關');
});

T('⭐textBaseline 明確設 middle（預設 alphabetic 對中文垂直偏移很明顯）', () => {
  const i = adm.indexOf('async function miDraw(');
  assert.ok(/textBaseline\s*=\s*'middle'/.test(adm.slice(i, i + 3000)), '應統一 middle');
});

T('⭐字體名含空白必須加引號，否則 canvas 整串 font 失效退回預設字體', () => {
  const i = adm.indexOf('F: ');
  const line = adm.slice(i, adm.indexOf('\n', i));
  assert.ok(/"Microsoft JhengHei/.test(line), '微軟正黑體名稱含空白，必須加引號');
  assert.ok(/sans-serif/.test(line), '最後要有泛型 fallback');
});

T('⭐中文截斷用 measureText 逐字量，不可用字數估算（原型名混半形 ex）', () => {
  const i = adm.indexOf('function miFit(');
  const body = adm.slice(i, adm.indexOf('\n}', i));
  assert.ok(/measureText/.test(body), '必須實際量測');
});

T('⭐樣本不足（sampleOk=false）的勝率一律顯示「—」，不管實際值多少', () => {
  const i = adm.indexOf('async function miDraw(');
  const body = adm.slice(i, adm.indexOf('\n  // ── 未分類帶', i));
  assert.ok(/!r\.sampleOk/.test(body),
    '必須判 sampleOk —— 1 勝 0 負 = 100% 被截圖傳開就收不回來了');
});

T('⭐佔比分母用 scanned 的副數，不可用 rows 的 usage 加總', () => {
  // v1.71：分母／佔比收斂到 miComputeRows（單頁版 miDraw 與完整版多頁共用同一份），
  //   判準因此從「miDraw 裡有沒有讀 scanned」改成「唯一那一份有沒有讀對 ＋ miDraw 有接上」。
  const j = adm.indexOf('function miComputeRows(');
  const one = adm.slice(j, adm.indexOf('\n}', j));
  assert.ok(/cur\.scanned/.test(one) && /miDeckKey\(/.test(one), '唯一的分母來源沒有讀 scanned 的副數');
  const k = adm.indexOf('function miDeckKey(');
  assert.ok(/casualDecks/.test(adm.slice(k, k + 200)), 'miDeckKey 沒有對到 casualDecks / tournDecks');
  assert.ok(!/rows[\s\S]{0,80}reduce\(/.test(one),
    '不可用 rows 加總當分母 —— 未分類那一大塊不在 rows 裡，會把每個原型的佔比灌水');
  const i = adm.indexOf('async function miDraw(');
  assert.ok(/miComputeRows\(/.test(adm.slice(i, i + 2000)),
    'miDraw 沒有接上 miComputeRows —— 兩份分母只要改一邊就會靜默漂移');
});

T('⭐未分類不進排行（它常是第一名，混進去會有一根巨大長條主宰整張圖）', () => {
  const i = adm.indexOf('async function miDraw(');
  const body = adm.slice(i, adm.indexOf('\n  // ── 未分類帶', i));
  assert.ok(!/unclassified/.test(body), '排行區不可含未分類');
  assert.ok(/unclassified/.test(adm.slice(adm.indexOf('// ── 未分類帶', i), i + 12000)),
    '未分類要另外誠實揭露一行');
});

T('⭐趨勢停用時圖上要說明原因，不可默默不畫箭頭（會被當成「大家都沒變」）', () => {
  const i = adm.indexOf('const foot =');
  const body = adm.slice(i, adm.indexOf('ctx.fillText(foot', i));
  assert.ok(/trend\.reason/.test(body), '頁腳要帶上停用理由');
  assert.ok(/未與上期比較/.test(body), '要明講沒有跟上期比較');
});

T('圖上要有網站網址與 logo（社群轉發的落款）', () => {
  assert.ok(/const MI_URL = 'www\.ptcg-tw-sim\.com'/.test(adm), '應有網址常數');
  const i = adm.indexOf('async function miDraw(');
  const body = adm.slice(i, adm.indexOf('\n}\n', i));
  assert.ok((body.match(/MI_URL/g) || []).length >= 2,
    '網址至少出現兩次（頂部＋頁腳）—— 被裁切時至少留一個');
  assert.ok((body.match(/drawImage\(logo/g) || []).length >= 1, '要畫 logo');
});

// ── 下載與防呆 ────────────────────────────────────────────────────────────
T('⭐revokeObjectURL 要延遲（立即 revoke 會讓部分瀏覽器取消下載）', () => {
  const i = adm.indexOf('window.downloadMetaImage');
  const body = adm.slice(i, adm.indexOf('\n};', i));
  assert.ok(/setTimeout\([\s\S]{0,80}revokeObjectURL/.test(body), 'revoke 必須包在 setTimeout 內');
  assert.ok(/toBlob\(/.test(body), '應用 toBlob（非同步 callback）');
  assert.ok(!/[\u4e00-\u9fff][^']*\.png/.test(body.slice(body.indexOf('a.download'), body.indexOf('a.download') + 200)),
    '檔名應為全 ASCII（中文檔名在部分聊天軟體上傳會有編碼問題）');
});

T('⭐連點防呆＋finally 復原按鈕（產圖含兩次 API 呼叫，延遲可感知）', () => {
  const i = adm.indexOf('window.openMetaImageExport');
  const body = adm.slice(i, adm.indexOf('\n};', i));
  assert.ok(/_miBusy/.test(body), '應有 in-flight flag');
  assert.ok(/finally\s*\{/.test(body), '必須 finally 復原，否則一次失敗按鈕就永遠卡在「產生中…」');
});

T('⭐產圖開頭先快照資料與參數（產圖期間使用者可能又動了時間下拉）', () => {
  const i = adm.indexOf('window.openMetaImageExport');
  const body = adm.slice(i, adm.indexOf('\n};', i));
  assert.ok(/const cur = _archStats/.test(body) && /const days = /.test(body),
    '應把 _archStats 與 days 快照成區域變數');
});

T('⭐inline on* 呼叫的函式都要掛 window（module 層級的 function 全域看不到）', () => {
  for (const fn of ['openMetaImageExport', 'renderMetaImageModal', 'downloadMetaImage']) {
    assert.ok(adm.includes('window.' + fn + ' ='), fn + ' 必須掛 window');
    assert.ok(adm.includes(fn + '('), fn + ' 應有 inline 呼叫點');
  }
});

T('有預覽再下載，而不是按一下直接存檔', () => {
  assert.ok(/renderMetaImageModal/.test(adm), '應有預覽 modal');
  const i = adm.indexOf('window.renderMetaImageModal');
  const body = adm.slice(i, adm.indexOf('\n};', i));
  assert.ok(/toDataURL/.test(body), '預覽用 img + dataURL（手機可長按儲存）');
  assert.ok(/downloadMetaImage/.test(body), 'modal 內要有下載鈕');
});

T('統計還沒算之前匯出鈕是 disabled', () => {
  assert.ok(/id="meta-img-btn"[\s\S]{0,200}disabled/.test(adm), '按鈕初始應 disabled');
  assert.ok(/_mib\.disabled = false/.test(adm), '統計渲染後才啟用');
});

// ══ v1.65 追加：圖是給「玩家」看的，不是給我看的 ═════════════════════════
T('⭐⭐落款用主站的 logo icon，不是 admin 自己的紫色 ADMIN icon', () => {
  const i = adm.indexOf('async function miLogo(');
  const body = adm.slice(i, adm.indexOf('\n}', i));
  assert.ok(/icons\/site-icon-192\.png/.test(body),
    '要用 icons/site-icon-192.png（主站 logo 的同源副本；v6.183 起是屬性色環識別）');
  assert.ok(!/icons\/icon-192\.png/.test(body),
    'admin 的 icon-192.png 是紫色 ADMIN 圖示 —— 發給玩家的圖不能用它當落款');
});

T('⭐⭐logo 不可直連主站網址（跨來源會讓 canvas tainted，toBlob 直接拋錯匯不出圖）', () => {
  const i = adm.indexOf('async function miLogo(');
  const body = adm.slice(i, adm.indexOf('\n}', i));
  assert.ok(!/https?:\/\//.test(body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')),
    '不可用絕對網址載 logo —— 必須是同源的相對路徑，否則 toBlob() 會拋 SecurityError');
});

T('⭐⭐圖上不得出現統計術語（pp / n= 一般玩家看不懂）', () => {
  const i = adm.indexOf('async function miDraw(');
  const body = adm.slice(i, adm.indexOf('\nlet _miBusy', i))
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');   // 註解裡可以解釋這些名詞
  const bad = [];
  if (/'[^']*\bpp\b[^']*'/.test(body) || /\+\s*'pp'/.test(body)) bad.push('pp（百分點）');
  if (/n=/.test(body)) bad.push('n=（樣本數）');
  if (/樣本/.test(body)) bad.push('樣本');
  assert.deepEqual(bad, [],
    '這張圖是要發給玩家的，不可出現：' + bad.join('、') + ' —— 請改成人話（如「較上期 +2.3%」「使用 142 次」）');
});

T('⭐排行有欄位表頭（不標的話玩家不知道長條與右邊的大數字各是什麼）', () => {
  const i = adm.indexOf('async function miDraw(');
  const body = adm.slice(i, adm.indexOf('\nlet _miBusy', i));
  assert.ok(/欄位表頭/.test(body) || (/'使用率/.test(body) && /'勝率'/.test(body)),
    '排行區上方要標出「使用率」與「勝率」兩欄');
});

// ══ v1.65 事故回歸鎖：POST 漏 Content-Type → body 靜默不被解析 ════════════
// 真實事故：點「吉雉雞ex」把它加進支援型清單，結果清單毫無變化。
//   根因不在後端邏輯，而是前端 POST **漏帶 Content-Type: application/json**，
//   express.json() 因此不解析 body → 後端拿到空的 req.body →
//   舊寫法「不是陣列就當空陣列」**靜默把整份清單存成空的、還回 ok:true**。
//   全程沒有任何錯誤訊息，使用者只看得到「點了沒反應」。
T('⭐⭐api() 送字串 body 時自動補 Content-Type（全站 20 個 POST 靠各自手寫遲早漏）', () => {
  const i = adm.indexOf('async function api(path');
  const body = adm.slice(i, adm.indexOf('\n}', i));
  assert.ok(/typeof options\.body === 'string'/.test(body) && /application\/json/.test(body),
    "api() 應在字串 body 時自動補 Content-Type");
  assert.ok(/typeof options\.body === 'string'/.test(body),
    '必須限定字串 body —— FormData 需要瀏覽器自己帶 boundary，手動指定會直接壞掉');
});

T('⭐⭐後端不可把「body 沒收到」靜默當成「使用者要清空清單」', () => {
  const i = pat.indexOf("app.post('/api/admin/support-pokemon'");
  const body = pat.slice(i, pat.indexOf('\n  });', i));
  assert.ok(/status\(400\)/.test(body), '應在 body 無法解析時回 400');
  assert.ok(/Content-Type/.test(body), '錯誤訊息要點出可能是漏帶 Content-Type，否則沒人查得到');
  assert.ok(!/Array\.isArray\(req\.body\.names\)\s*\)\s*\?\s*req\.body\.names\s*:\s*\[\]/.test(body),
    '不可用「不是陣列就當空陣列」—— 那會在 body 沒解析時把整份清單清空且無聲無息');
});

T('⭐所有帶 body 的 POST 都能送出 JSON（自動補或自己寫，兩者至少有一）', () => {
  const auto = /typeof options\.body === 'string'/.test(adm);
  const bad = [];
  for (const m of adm.matchAll(/api\(\s*['"`][^'"`]*['"`]\s*,\s*\{/g)) {
    const o = adm.indexOf('{', m.index + m[0].length - 1);
    let d = 0, end = o;
    for (let i = o; i < adm.length; i++) {
      if (adm[i] === '{') d++;
      else if (adm[i] === '}') { d--; if (d === 0) { end = i; break; } }
    }
    const opt = adm.slice(o, end + 1);
    if (!/method:\s*'(POST|PUT|PATCH)'/.test(opt) || !/body:/.test(opt)) continue;
    if (!auto && !/Content-Type/.test(opt)) bad.push(adm.slice(m.index, m.index + 60));
  }
  assert.deepEqual(bad, [], '這些 POST 帶了 body 卻沒有 Content-Type：\n  ' + bad.join('\n  '));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
