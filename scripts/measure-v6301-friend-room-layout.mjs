// v6.301 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）
//   —— 好友列加上【🚪 加入房間 / 👁 觀戰】之後的框架安全證據。
//
// 做法：把 `src/lib/friends/FriendsPanel.svelte` 用 svelte 編譯器編成 client 元件
//   （`css:'injected'` ⇒ 樣式就是正式站那一份），在 chromium 裡**真的掛起來**，
//   對 375×812 / 390×844 / 1366×768 三種尺寸各量兩次：
//     ① 不傳 rooms（＝上一版的樣子，也是錦標賽分頁與 /friends 的樣子）
//     ② 傳 rooms（＝這一版大廳好友分頁的樣子）
//   逐一輸出每一列、每一顆按鈕的 getBoundingClientRect()，供人工核對。
//
// 用法：node scripts/measure-v6301-friend-room-layout.mjs
//   需要 playwright（PLAYWRIGHT_MODULE 可指定路徑；PW_CHANNEL 預設 chromium-headless-shell）。
//   沙盒缺 libXdamage 時：LD_LIBRARY_PATH 指向解出來的 libXdamage.so.1。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require_ = createRequire(import.meta.url);
const esbuild = require_('esbuild');
const { chromium } = require_(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { compile } = await import('svelte/compiler');

const P_FRP = join(ROOT, 'src/lib/friends/FriendsPanel.svelte');
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_CTX = join(ROOT, 'src/lib/friends/auth-ctx.ts');
const P_FR = join(ROOT, 'src/lib/friends/friend-rooms.ts');

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
  outgoing: [],
  blocked: [{ fid: 'b1', status: 'blocked', nick: '壞人', alias: null, uid: 'u1', uids: [], requestedByMe: true, blockedByMe: true, via: null, at: 7 }],
  limit: 100, truncated: false,
};
const ROOMS = [
  { roomId: 'AAAA', status: 'lobby', roomName: '小明的練習房', hostName: '小明', seats: [{ uid: 'u1' }, { uid: null }] },
  { roomId: 'BBBB', status: 'playing', roomName: '華山論劍', hostName: '路人', seats: [{ uid: 'zz' }, { uid: 'u2' }] },
  { roomId: 'EEEE', status: 'lobby', roomName: '老王的房', hostName: '老王', seats: [{ uid: 'u5' }, { uid: null }] },
];

const dir = mkdtempSync(join(tmpdir(), 'm6301-'));
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
    '$lib/friends/friends-api': P_API, '$lib/friends/auth-ctx': P_CTX, '$lib/friends/friend-rooms': P_FR,
    '$lib/ui/stale-keep': join(ROOT, 'src/lib/ui/stale-keep.ts'),
  },
  nodePaths: [join(ROOT, 'node_modules')], loader: { '.ts': 'ts' },
  define: { 'import.meta.env': JSON.stringify({ VITE_ORACLE_API_URL: 'https://t.local' }) },
});
const bundle = readFileSync(join(dir, 'bundle.js'), 'utf8');

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
const out = {};
for (const [w, h] of [[375, 812], [390, 844], [1366, 768]]) {
  const tag = w + '×' + h;
  out[tag] = {};
  for (const withRooms of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const pg = await ctx.newPage();
    await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>' }));
    await pg.goto('https://t.local/');
    await pg.evaluate((L) => {
      window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => L });
      window.__auth = { currentUser: { uid: 'me', isAnonymous: false, getIdToken: async () => 'tok' } };
    }, LIST);
    await pg.addScriptTag({ content: bundle });
    await pg.evaluate(({ rs, on }) => { window.__mount(document.getElementById('app'), on ? { embedded: true, rooms: rs, onjoinroom: () => {} } : { embedded: true }); },
      { rs: ROOMS, on: withRooms });
    await pg.waitForTimeout(300);
    out[tag][withRooms ? 'NEW' : 'BASE'] = await pg.evaluate(() => {
      const R = (e) => { const r = e.getBoundingClientRect(); return { l: +r.left.toFixed(2), r: +r.right.toFixed(2), t: +r.top.toFixed(2), h: +r.height.toFixed(2) }; };
      const rows = [...document.querySelectorAll('.fr-panel .row')];
      return {
        docW: document.documentElement.scrollWidth, winW: window.innerWidth,
        panel: R(document.querySelector('.fr-panel')),
        rows: rows.map((x) => ({
          nick: x.querySelector('.nick').textContent,
          box: R(x),
          nickBox: R(x.querySelector('.nick')),
          btns: [...x.querySelectorAll('button')].map((b) => ({ txt: b.textContent.trim(), ...R(b) })),
          room: x.querySelector('.fr-room') ? { txt: x.querySelector('.fr-room').textContent.trim(), ...R(x.querySelector('.fr-room')) } : null,
        })),
      };
    });
    await ctx.close();
  }
}
await browser.close();

for (const [tag, v] of Object.entries(out)) {
  console.log('\n══════ ' + tag + ' ══════');
  console.log('  面板 BASE l/r=' + v.BASE.panel.l + '/' + v.BASE.panel.r + '  NEW l/r=' + v.NEW.panel.l + '/' + v.NEW.panel.r
    + '  ｜ 水平捲軸 BASE ' + (v.BASE.docW > v.BASE.winW) + ' / NEW ' + (v.NEW.docW > v.NEW.winW));
  for (let i = 0; i < v.NEW.rows.length; i++) {
    const b = v.BASE.rows[i], n = v.NEW.rows[i];
    console.log(`  [${i}] ${n.nick}  列 l/r/h  BASE ${b.box.l}/${b.box.r}/${b.box.h}  →  NEW ${n.box.l}/${n.box.r}/${n.box.h}   Δh=${(n.box.h - b.box.h).toFixed(2)}`);
    console.log('       BASE 按鈕 ' + b.btns.map((x) => `${x.txt}[${x.l}~${x.r} t=${x.t} h=${x.h}]`).join(' '));
    console.log('       NEW  按鈕 ' + n.btns.map((x) => `${x.txt}[${x.l}~${x.r} t=${x.t} h=${x.h}]`).join(' '));
    if (n.room) console.log(`       NEW  房名行 ${n.room.txt} [${n.room.l}~${n.room.r} t=${n.room.t} h=${n.room.h}]  暱稱 l=${n.nickBox.l}`);
  }
}
writeFileSync(process.env.MEASURE_OUT || '/tmp/measure-v6301.json', JSON.stringify(out, null, 1));
console.log('\n完整數據寫到 ' + (process.env.MEASURE_OUT || '/tmp/measure-v6301.json'));
