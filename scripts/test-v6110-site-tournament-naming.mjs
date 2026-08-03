// v6.110 守衛：本站自辦賽事的**使用者可見名稱**一律「網站賽」，不得再叫「官方賽」。
//
// Wilson：「請幫我從官方賽更名為網站賽，避免誤導玩家以為我是寶可夢的官方，或是引起官方版權爭議。」
// 本站是非官方、非營利的同好站（首頁免責聲明白紙黑字寫「本站為非官方…」），
// 站內卻把自辦賽事叫「官方賽」，是自相矛盾也是實質風險。
//
// ⚠ 這條守衛只管**使用者看得到的字**。以下一律不碰、也不得被誤抓：
//   ① 資料欄位／API 契約：communityEvent、championsOfficial、篩選值 'official'、
//      變數名 tHofOfficialOpen / nOfficial —— 改了會壞既有歸檔資料。
//   ② 對**寶可夢官方**的正當引用：「官方規則」「PTCG 官方」「官方中文卡名」「官方素材」
//      「非官方」「支持官方數位生態系」—— 這些正是要表達「我們不是官方」。
//   ③ changelog 封存頁的歷史紀錄（保留原始敘述，鐵律）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// 被禁的具體詞（都是「把本站賽事叫官方」的樣態）。用具體詞而非「含『官方』」，
// 才不會把 ② 那類正當引用一起殺掉。
const BANNED = ['官方賽', '官方奪冠', '官方歷屆', '（官方）', '(官方)', '官方+社群', '官方＋社群'];

/** 去掉 // 行註解與 /* *\/ 區塊註解後的原始碼（註解裡寫「官方賽」是說明歷史，不算違規）。 */
function stripComments(src) {
  let out = '', st = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1] || '';
    if (st === 0) {
      if (c === '/' && n === '/') { st = 1; i++; out += '  '; continue; }
      if (c === '/' && n === '*') { st = 2; i++; out += '  '; continue; }
      if (c === '<' && src.slice(i, i + 4) === '<!--') { st = 3; i += 3; out += '    '; continue; }
      out += c; continue;
    }
    if (st === 1) { if (c === '\n') { st = 0; out += '\n'; } else out += ' '; continue; }
    if (st === 2) { if (c === '*' && n === '/') { st = 0; i++; out += '  '; continue; } out += (c === '\n' ? '\n' : ' '); continue; }
    if (st === 3) { if (src.slice(i, i + 3) === '-->') { st = 0; i += 2; out += '   '; continue; } out += (c === '\n' ? '\n' : ' '); continue; }
  }
  return out;
}

const FILES = [
  'src/routes/game/+page.svelte',
  'src/routes/+page.svelte',
  'oracle-admin/admin.html',
  'oracle-admin/server_admin_patch.js',
  'static/changelog.html',
];

console.log('① 使用者可見文字不得把本站賽事叫「官方」');

for (const f of FILES) {
  T(f, () => {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    const hits = [];
    for (const w of BANNED) {
      let i = code.indexOf(w);
      while (i >= 0) {
        const line = code.slice(0, i).split('\n').length;
        hits.push(`第 ${line} 行「${w}」`);
        i = code.indexOf(w, i + 1);
      }
    }
    ok(hits.length === 0, '仍有舊稱：\n        ' + hits.join('\n        ')
      + '\n      → 使用者可見的本站賽事名稱請改成「網站賽」；資料欄位（communityEvent／'
      + "'official'／championsOfficial）不要動。");
  });
}

console.log('② 正對照：判準真的會抓（不是永遠綠）');

T('含「官方賽」的樣本會被抓出來', () => {
  const probe = "const x = '🏛️ 官方賽';";
  const code = stripComments(probe);
  ok(BANNED.some(w => code.includes(w)), '判準抓不到明顯違規樣本 ⇒ 這條守衛是假綠');
});

T('註解裡的「官方賽」不算違規（說明歷史用）', () => {
  const probe = "// v1.60 官方賽 / 社群自辦賽 篩選\nconst x = 1;";
  const code = stripComments(probe);
  ok(!BANNED.some(w => code.includes(w)), '註解沒有被剝掉 ⇒ 會誤殺說明文字');
});

T('⭐ 對寶可夢官方的正當引用不得被誤殺', () => {
  const probe = "<p>本站為非官方、非營利之愛好者社群</p><p>依 PTCG 官方規則</p><p>官方中文卡名</p>";
  const code = stripComments(probe);
  ok(!BANNED.some(w => code.includes(w)),
    '「非官方」「官方規則」「官方中文卡名」被誤判成違規 —— 這些正是要表達本站不是官方');
});

console.log('③ 資料欄位／API 契約沒有被一起改掉（改了會壞既有歸檔）');

T('⭐ communityEvent / \'official\' 篩選值 / championsOfficial 仍在', () => {
  const sap = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
  const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  const gp = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  ok(/communityEvent/.test(sap), 'server 端 communityEvent 欄位不見了');
  ok(/'official'/.test(adm), "admin 的篩選值 'official' 被改掉了 —— 那是內部值，不該跟著文案改");
  ok(/championsOfficial/.test(gp), 'championsOfficial 欄位不見了（那是後端回傳的 key）');
});

console.log('\n=== v6.110 網站賽更名：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
