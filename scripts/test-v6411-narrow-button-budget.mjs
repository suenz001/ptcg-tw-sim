// v6.411 守衛：好友列在**最窄裝置（320×568）**的「按鈕群預算」契約。
//
// 【問題】v6.406 把按鈕群包成 wrapper ＋「更多」二層選單之後，375／390 都回到一行；
//   但站長的 Windows 實測 320×568 的「錦標賽對戰中」那一列**仍然換行**（列高 115，其他列 77）。
//   根因是**字型差異**：同一顆按鈕在站長的 Windows 量到 129.69px，本機／CI 的 Linux 只有 123.98px
//   （差 5.71px），而那一列的餘裕只剩 4.61px ⇒ Linux 剛好放得下、Windows 剛好放不下。
//   ⇒ **這種 bug 在 Linux CI 上永遠量不到**。v6.406 就是這樣漏掉的。
//
// 【收斂】不逐列調文案，而是把「窄畫面的按鈕群預算」變成**一份中央契約**：
//   餘裕 = 列的內容可用寬 − 按鈕群總寬（各按鈕寬 ＋ gap×(n−1)）
//   必須 ≥ 安全門檻 = 按鈕文字的**中文字數 × 1.2px**
//   （依據：站長的 Windows 實測，「錦標賽對戰中」6 個中文字比 Linux 寬 5.71px ≈ 0.95px/字；
//     取 1.2 當保守值。這是**推估**，真正的驗收仍然是站長在 Windows 上看那一列有沒有換行。）
//
// 【v6.411 的修正】站長裁示：「🏆 錦標賽對戰中」→「🏆 錦標賽中」。
//   實測結果：95.98px，與「🚪 加入房間」**完全同寬** ⇒ 錦標賽列與一般對戰列的版面從此一模一樣。
//
// 【HEAD-FAIL】BASE（v6.410）上那一列的餘裕 4.61 < 門檻 13.2 ⇒ 主判準 B1 必紅。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };

// ── 【A】靜態：按鈕字樣的單一來源 ────────────────────────────────────────────
const FR = readFileSync(join(ROOT, 'src/lib/friends/friend-rooms.ts'), 'utf8');
T('A1. 按鈕字樣是「🏆 錦標賽中」（v6.411 縮字；HEAD-FAIL：BASE 上是「錦標賽對戰中」）', () => {
  assert.ok(/case 'tournament': return '🏆 錦標賽中';/.test(FR), 'friendRoomLabel 的錦標賽字樣不是「🏆 錦標賽中」');
  assert.ok(!/return '🏆 錦標賽對戰中'/.test(FR), '舊字樣還在（縮字沒生效）');
});
T('A2. 完整說明**沒有**跟著縮短：滑鼠提示仍逐字保留「正在錦標賽對戰中」', () => {
  // ⚠ 縮的是按鈕、不是資訊。這一條擋住「順手把 title 也縮掉」。
  assert.ok(/case 'tournament': return '這位好友最近正在錦標賽對戰中，無法從這裡加入';/.test(FR),
    'friendRoomTitle 的完整說明被改掉了 ⇒ 資訊真的變少了');
});

// ── 【B】行為端：320×568 的按鈕群預算 ────────────────────────────────────────
const chromium = pwChromium('v6.411 【B】320×568 按鈕群預算量測');
if (chromium) {
  const { compile } = await import('svelte/compiler');
  const esbuild = require_('esbuild');
  const P_FRP = join(ROOT, 'src/lib/friends/FriendsPanel.svelte');
  const LIST = {
    friendsApi: 1, me: { uid: 'me', nick: '我' },
    friends: [
      { fid: 'f1', status: 'accepted', nick: '小明', alias: null, uid: 'u1', uids: [], requestedByMe: true, blockedByMe: false, via: 'battle', at: 1 },
      { fid: 'f2', status: 'accepted', nick: '阿華', alias: null, uid: 'u2', uids: [], requestedByMe: false, blockedByMe: false, via: 'battle', at: 2 },
      { fid: 'f3', status: 'accepted', nick: '小賽', alias: null, uid: 'nobody', uids: [], requestedByMe: false, blockedByMe: false, via: 'email', at: 3, inTournament: true },
      { fid: 'f4', status: 'accepted', nick: '阿宅', alias: null, uid: null, uids: [], requestedByMe: false, blockedByMe: false, via: 'email', at: 4 },
      { fid: 'f5', status: 'accepted', nick: '老王', alias: null, uid: 'gone', uids: ['nope', 'u5'], requestedByMe: false, blockedByMe: false, via: 'battle', at: 5 },
    ],
    incoming: [{ fid: 'g1', status: 'pending', nick: '路人甲', alias: null, uid: null, uids: [], requestedByMe: false, blockedByMe: false, via: 'email', at: 6 }],
    outgoing: [{ fid: 'o1', status: 'pending', nick: '等回覆的人', alias: null, uid: null, uids: [], requestedByMe: true, blockedByMe: false, via: 'email', at: 8 }],
    blocked: [{ fid: 'b1', status: 'blocked', nick: '壞人', alias: null, uid: 'u1', uids: [], requestedByMe: true, blockedByMe: true, via: null, at: 7 }],
    limit: 100, truncated: false,
  };
  const ROOMS = [
    { roomId: 'AAAA', status: 'lobby', roomName: '小明的練習房', hostName: '小明', seats: [{ uid: 'u1' }, { uid: null }] },
    { roomId: 'BBBB', status: 'playing', roomName: '華山論劍', hostName: '路人', seats: [{ uid: 'zz' }, { uid: 'u2' }] },
    { roomId: 'EEEE', status: 'lobby', roomName: '老王的房', hostName: '老王', seats: [{ uid: 'u5' }, { uid: null }] },
  ];
  const dir = mkdtempSync(join(tmpdir(), 'v6411-'));
  writeFileSync(join(dir, 'FriendsPanel.js'), compile(readFileSync(P_FRP, 'utf8'),
    { generate: 'client', filename: 'FriendsPanel.svelte', runes: true, css: 'injected' }).js.code);
  writeFileSync(join(dir, 'fb.js'), 'export const auth = globalThis.__auth;\n');
  writeFileSync(join(dir, 'fbauth.js'), 'export function onAuthStateChanged(a, cb){ setTimeout(()=>cb(globalThis.__auth.currentUser),0); return ()=>{}; }\n');
  writeFileSync(join(dir, 'entry.js'),
    "import { mount } from 'svelte';\nimport P from './FriendsPanel.js';\nglobalThis.__mount = (t, p) => mount(P, { target: t, props: p });\n");
  await esbuild.build({
    entryPoints: [join(dir, 'entry.js')], bundle: true, format: 'iife', outfile: join(dir, 'bundle.js'), logLevel: 'silent',
    alias: {
      '$lib/firebase': join(dir, 'fb.js'), 'firebase/auth': join(dir, 'fbauth.js'),
      '$lib/friends/friends-api': join(ROOT, 'src/lib/friends/friends-api.ts'),
      '$lib/friends/auth-ctx': join(ROOT, 'src/lib/friends/auth-ctx.ts'),
      '$lib/friends/friend-rooms': join(ROOT, 'src/lib/friends/friend-rooms.ts'),
      '$lib/ui/stale-keep': join(ROOT, 'src/lib/ui/stale-keep.ts'),
    },
    nodePaths: [join(ROOT, 'node_modules')], loader: { '.ts': 'ts' },
    define: { 'import.meta.env': JSON.stringify({ VITE_ORACLE_API_URL: 'https://t.local' }) },
  });
  const bundle = readFileSync(join(dir, 'bundle.js'), 'utf8');
  const browser = await pwLaunchWith(chromium, 'v6.411 【B】320×568 按鈕群預算量測');
  if (browser) {
    try {
      /** 量一次：回每一列的 {nick, 按鈕群總寬, 可用寬, 餘裕, 中文字數, 行數} */
      const measure = async (w, h, { openMore = false, extraCss = '' } = {}) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        const pg = await ctx.newPage();
        await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>' }));
        await pg.goto('https://t.local/');
        await pg.evaluate((L) => {
          window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => L });
          window.__auth = { currentUser: { uid: 'me', isAnonymous: false, getIdToken: async () => 'tok' } };
        }, LIST);
        await pg.addScriptTag({ content: bundle });
        await pg.evaluate((rs) => { window.__mount(document.getElementById('app'), { embedded: true, rooms: rs, onjoinroom: () => {}, ondm: () => {} }); }, ROOMS);
        await pg.waitForTimeout(350);
        if (extraCss) { await pg.addStyleTag({ content: extraCss }); await pg.waitForTimeout(150); }
        if (openMore) {
          await pg.evaluate(() => { const b = [...document.querySelectorAll('.fr-panel .row button')].find((x) => x.textContent.trim() === '更多'); if (b) b.click(); });
          await pg.waitForTimeout(250);
        }
        const out = await pg.evaluate(() => {
          const rows = [...document.querySelectorAll('.fr-panel .row')];
          return {
            docW: document.documentElement.scrollWidth, winW: window.innerWidth,
            rows: rows.map((x) => {
              const acts = x.querySelector('.acts');
              const isMore = !!x.querySelector('.acts-more');
              const cs = acts ? getComputedStyle(acts) : getComputedStyle(x);
              const btns = [...(acts || x).querySelectorAll('button')]
                .map((b) => ({ txt: b.textContent.trim(), w: +b.getBoundingClientRect().width.toFixed(2), t: +b.getBoundingClientRect().top.toFixed(2) }));
              const rcs = getComputedStyle(x);
              const inner = x.getBoundingClientRect().width
                - parseFloat(rcs.paddingLeft) - parseFloat(rcs.paddingRight)
                - parseFloat(rcs.borderLeftWidth) - parseFloat(rcs.borderRightWidth);
              return {
                nick: (x.querySelector('.nick') || {}).textContent || '(?)',
                isMore,
                rowH: +x.getBoundingClientRect().height.toFixed(2),
                inner: +inner.toFixed(2),
                gap: parseFloat(cs.columnGap),
                btns,
                lines: new Set(btns.map((b) => b.t)).size,
              };
            }),
          };
        });
        await ctx.close();
        // 補上預算欄位（在 node 這一側算，判準只有這一份）
        for (const r of out.rows) {
          r.sum = +(r.btns.reduce((a, b) => a + b.w, 0) + r.gap * Math.max(0, r.btns.length - 1)).toFixed(2);
          r.slack = +(r.inner - r.sum).toFixed(2);
          // 中文字數（CJK 統一表意文字）——字型差異幾乎只來自這些字
          r.cjk = r.btns.reduce((a, b) => a + (b.txt.match(/[一-鿿]/g) || []).length, 0);
          r.need = +(r.cjk * 1.2).toFixed(2);
        }
        return out;
      };
      const norm = await measure(320, 568);
      const more = await measure(320, 568, { openMore: true });
      const wide = await measure(375, 812);
      const show = (d) => d.rows.map((r) => `${r.nick}:${r.slack}/${r.need}`).join(' ');

      T('B0. 掃描器下限：量到 8 列、每一列都有按鈕（盤面真的搭起來了）', () => {
        assert.strictEqual(norm.rows.length, 8, '列數不是 8：' + norm.rows.length);
        assert.ok(norm.rows.every((r) => r.btns.length > 0), '有列量不到按鈕');
        assert.ok(norm.rows.some((r) => r.btns.some((b) => b.txt.includes('錦標賽'))), '找不到錦標賽那一列');
      });
      T('B1.【主判準】320×568 一般狀態：每一列的按鈕群餘裕 ≥ 中文字數×1.2px（HEAD-FAIL：BASE 上錦標賽列 4.61 < 13.2）', () => {
        const bad = norm.rows.filter((r) => r.slack < r.need)
          .map((r) => `${r.nick}（餘裕 ${r.slack} < 門檻 ${r.need}；按鈕 ${r.btns.map((b) => b.txt + '=' + b.w).join('、')}）`);
        assert.deepStrictEqual(bad, [],
          '這幾列在站長的 Windows 字型下會換行（本機 Linux 看不出來）：\n    ' + bad.join('\n    ') + '\n    全部：' + show(norm));
      });
      T('B2. 320×568 一般狀態：每一列的按鈕都在**同一行**（本機 Linux 端的直接證據）', () => {
        const bad = norm.rows.filter((r) => r.lines > 1).map((r) => `${r.nick}(${r.lines} 行)`);
        assert.deepStrictEqual(bad, [], '這幾列在本機就已經換行了：' + bad.join('、'));
      });
      T('B3. 320×568 沒有水平捲軸（窄畫面的底線）', () => {
        assert.ok(norm.docW <= norm.winW, `docW=${norm.docW} > winW=${norm.winW}`);
      });
      T('B4.【站長裁示的「比照一般對戰」】錦標賽那顆與「加入房間」**同寬**', () => {
        const t = norm.rows.flatMap((r) => r.btns).find((b) => b.txt.includes('錦標賽'));
        const j = norm.rows.flatMap((r) => r.btns).find((b) => b.txt.includes('加入房間'));
        assert.ok(t && j, '找不到兩顆按鈕');
        assert.ok(Math.abs(t.w - j.w) < 0.5, `錦標賽=${t.w} vs 加入房間=${j.w} —— 不同寬（縮字沒縮到位）`);
      });
      T('B5.【正對照】把按鈕撐寬 20px，B1 的判準必須抓得到（防空真）', () => {
        // 沒有這一條，B1 在「量不到按鈕」或「判準寫壞」時會恆綠。
        // ⚠ 這裡不重新 measure（async），改用同一份判準函式餵一個人工加寬的樣本。
        const fake = JSON.parse(JSON.stringify(norm.rows[2]));   // 錦標賽那一列
        fake.sum += 40; fake.slack = +(fake.inner - fake.sum).toFixed(2);
        assert.ok(fake.slack < fake.need, '判準對「明顯超支」的樣本竟然放行 ⇒ B1 是恆真式');
      });
      T('B6.【已知超支，待站長裁示】「更多」展開列在 320 寬只剩 0.02px 餘裕', () => {
        // ⚠⚠ 白名單條目必須附行為端證明（安慰劑型態 7）：下面就是那個量測值。
        //   這一列是**臨時展開**的狀態（玩家主動按開），不是常駐列 ⇒ 換行不會造成
        //   「各列參差不齊」的視覺問題，但 Windows 字型下它會多一行、把下方名單往下推。
        //   可能的做法（等站長裁示，本版不自作主張改文案）：
        //     (a) 拿掉「💬 私聊」的 emoji（同列其他三顆都沒有 emoji，一致性也更好）⇒ 省 ~14px
        //     (b) 縮短「解除好友」
        //     (c) 接受它換行（展開列本來就是臨時狀態）
        const m = more.rows.find((r) => r.isMore);
        assert.ok(m, '量不到展開列 ⇒ 掃描器壞了（「更多」沒按開？）');
        assert.ok(m.slack < m.need,
          `展開列的餘裕已經 ≥ 門檻（${m.slack} ≥ ${m.need}）—— 問題解決了，請把這一條改成正式判準並從白名單移除`);
        assert.strictEqual(more.rows.filter((r) => r.isMore).length, 1, '展開列不只一列（一次只能展開一列）');
        // ⭐ 白名單只有這一條：其他列（展開狀態下）仍然必須守 B1
        const others = more.rows.filter((r) => !r.isMore && r.slack < r.need).map((r) => r.nick);
        assert.deepStrictEqual(others, [], '展開狀態下，**其他**列也超支了：' + others.join('、'));
      });
      T('B7.【反向正對照】375×812 每一列都有充裕餘裕（判準不是「永遠紅」）', () => {
        const bad = wide.rows.filter((r) => r.slack < r.need).map((r) => `${r.nick}(${r.slack}/${r.need})`);
        assert.deepStrictEqual(bad, [], '375 寬也超支 ⇒ 門檻訂太高：' + bad.join('、'));
      });
      console.log('    [量測] 320 一般：' + show(norm));
      console.log('    [量測] 320 展開：' + show(more));
    } finally { try { await browser.close(); } catch { /* 關不掉不影響判準 */ } }
  }
}

console.log(`\n=== v6411 narrow-button-budget: ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
