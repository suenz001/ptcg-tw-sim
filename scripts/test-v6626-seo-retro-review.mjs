// v6.626：事後補審 v6.621～625，真路由／故障恢復／並發／首次繪製守衛。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pwLaunch } from './lib/pw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT = process.env.V6626_PRODUCT || ROOT;
const rd = p => readFileSync(join(PRODUCT, p), 'utf8').replace(/\r\n/g, '\n');
const src = rd('oracle-admin/server_admin_patch.js');
const begin = src.indexOf('    // >>> v178-seo-meta-and-sitemaps');
const end = src.indexOf('    // <<< v178-seo-meta-and-sitemaps', begin);
assert.ok(begin >= 0 && end > begin, '真路由區塊必須存在');
const routeCode = src.slice(begin, end);
const cfBegin = src.indexOf('  const CASUAL_LEAVE_RE =');
const cfEnd = src.indexOf('  // ══ v6.242', cfBegin);
assert.ok(cfBegin >= 0 && cfEnd > cfBegin, '中央判準必須存在');
const filterCode = src.slice(cfBegin, cfEnd);
let pass = 0, fail = 0;
async function T(name, run) {
  try { await run(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
const delay = ms => new Promise(r => setTimeout(r, ms));
const image = 'https://asia.pokemon-card.com/tw/card-img/tw00012345.png';
const post = { _id: 'dp_safe', status: 'published', deckName: '測試牌組甲', notes: '這是投稿筆記', authorName: '公開作者', archetype: '原型甲', entries: [{ cardId: '123', count: 60 }], coverCardId: '123', createdAt: 1770000000000, uid: 'PRIVATE_UID', email: 'PRIVATE_EMAIL' };
function match(doc, q) {
  return Object.entries(q).every(([k, v]) => {
    if (k === '$and') return v.every(x => match(doc, x));
    if (k === '$or') return v.some(x => match(doc, x));
    const actual = doc[k];
    if (!v || typeof v !== 'object') return actual === v;
    return Object.entries(v).every(([op, value]) => {
      if (op === '$type') return typeof actual === value;
      if (op === '$in') return value.includes(actual);
      if (op === '$gte') return actual >= value;
      if (op === '$not') return !value.test(String(actual || ''));
      throw new Error('fixture未實作運算子 ' + op);
    });
  });
}
const fixtureMatches = () => Array.from({ length: 5 }, (_, i) => ({ roomCode: 'ROOM', winner: i % 2, endedAt: i, p1: { cardCounts: { 123: 60 } }, p2: { cardCounts: { 456: 60 } } }));
function fixture({ document = post, records = fixtureMatches() } = {}) {
  const spy = { now: 1790000000000, aggregate: 0, matches: 0, sitemap: 0, enrich: 0, central: 0, failMatch: false, failEnrich: false, failSite: false, filter: null, projection: null, limit: null };
  const handlers = {};
  const app = { locals: {}, get: (p, f) => { handlers[p] = f; } };
  new Function('app', filterCode)(app);
  if (app.locals._buildCasualCleanFilter) {
    const real = app.locals._buildCasualCleanFilter;
    app.locals._buildCasualCleanFilter = opts => { spy.central++; return real(opts); };
  }
  app.locals._archetypeEnrichMatchRecords = async rs => {
    spy.enrich++;
    if (spy.failEnrich) throw Error('classification down');
    for (const r of rs) { r.p1.archetype = '原型甲'; r.p2.archetype = '原型乙'; }
  };
  const posts = {
    findOne: async q => document && document.status === q.status ? document : null,
    find: () => ({ sort() { return this; }, limit(n) { assert.equal(n, 500); return this; }, async toArray() { spy.sitemap++; await delay(10); if (spy.failSite) throw Error('posts down'); return [document]; } }),
    aggregate: pipeline => ({ async toArray() {
      spy.aggregate++; await delay(10);
      assert.equal(pipeline[0].$match.status, 'published');
      assert.deepEqual(pipeline[1].$group.topCutCount, { $sum: { $cond: [{ $eq: ['$tournament.placementLabel', '冠軍'] }, 1, 0] } });
      return [{ _id: '原型甲', postCount: 2, topCutCount: 1 }];
    } }),
  };
  const db = { collection: name => {
    assert.equal(name, 'matchRecords');
    return { find(q, opts) {
      spy.filter = q; spy.projection = opts.projection;
      return { sort(q) { assert.deepEqual(q, { endedAt: -1 }); return this; }, limit(n) { spy.limit = n; return this; }, async toArray() { spy.matches++; await delay(10); if (spy.failMatch) throw Error('matches down'); return structuredClone(records.filter(r => match(r, q))); } };
    } };
  } };
  const pool = new Map([['123', { name: '官方卡片甲', setCode: 'TEST', imageUrl: image }]]);
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [spy.now])); } static now() { return spy.now; } }
  new Function('app', '_dprPosts', 'TPOOL', 'db', 'Date', routeCode)(app, posts, pool, db, Clock);
  async function call(path, id = 'dp_safe') {
    const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; } };
    await handlers[path]({ params: { id } }, res); return res;
  }
  return { call, spy, app };
}
const SHARE = '/api/deck-share/:id', META = '/api/meta-stats', SITE = '/api/sitemap-decks.xml';
await T('A1 分享頁使用真投稿名稱與筆記', async () => {
  const r = await fixture().call(SHARE); assert.equal(r.code, 200); assert.ok(r.body.includes(post.deckName)); assert.ok(r.body.includes(post.notes));
});
await T('A2 Map卡池取得卡名、官方卡圖與單卡連結', async () => {
  const r = await fixture().call(SHARE); assert.ok(r.body.includes('官方卡片甲')); assert.ok(r.body.includes(image)); assert.ok(r.body.includes('/card/123/')); assert.ok(!r.body.includes('/cards/img/'));
});
await T('A3 隱藏投稿404、禁止公開uid/email', async () => {
  const r = await fixture({ document: { ...post, status: 'draft' } }).call(SHARE); assert.equal(r.code, 404); assert.ok(r.body.includes('noindex'));
  const pub = await fixture().call(SHARE); assert.ok(!pub.body.includes('PRIVATE_'));
});
await T('A4 文字與JSON-LD跳脫含script結尾的投稿', async () => {
  const attack = '</script><img src=x onerror=alert(1)>';
  const r = await fixture({ document: { ...post, deckName: attack, notes: attack, authorName: attack } }).call(SHARE);
  assert.ok(!r.body.includes(attack)); assert.ok(r.body.includes('&lt;img'));
  const scripts = [...r.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]; assert.equal(scripts.length, 1); assert.equal(JSON.parse(scripts[0][1]).headline, attack);
});
await T('B1 十個冷統計請求只查詢一次且資料相同', async () => {
  const f = fixture(); const rs = await Promise.all(Array.from({ length: 10 }, () => f.call(META))); assert.ok(rs.every(r => r.code === 200)); assert.equal(f.spy.aggregate, 1); assert.equal(f.spy.matches, 1); assert.equal(f.spy.enrich, 1); assert.deepEqual(rs[0].body, rs[9].body);
  await f.call(META); assert.equal(f.spy.aggregate, 1); assert.equal(rs[0].headers['Cache-Control'], 'public, max-age=1800');
});
await T('B2 十個冷sitemap請求合併、XML跳脫及快取', async () => {
  const f = fixture({ document: { ...post, archetype: '甲&乙' } }); const rs = await Promise.all(Array.from({ length: 10 }, () => f.call(SITE))); assert.ok(rs.every(r => r.code === 200)); assert.equal(f.spy.sitemap, 1); assert.equal(rs[0].body, rs[9].body); assert.ok(rs[0].body.includes('q=%E7%94%B2%26%E4%B9%99')); await f.call(SITE); assert.equal(f.spy.sitemap, 1);
});
await T('B3 DB失敗不發布零統計、清在途旗標後可重試', async () => {
  const f = fixture(); f.spy.failMatch = true; const rs = await Promise.all(Array.from({ length: 3 }, () => f.call(META))); assert.ok(rs.every(r => r.code === 503 && r.headers['Cache-Control'] === 'no-store')); assert.equal(f.spy.matches, 1);
  f.spy.failMatch = false; const r = await f.call(META); assert.equal(r.code, 200); assert.ok(r.body.items.some(x => x.games === 5 && x.winRate !== null)); assert.equal(f.spy.matches, 2);
});
await T('B4 分類失敗不可快取成成功，恢復後再計算', async () => {
  const f = fixture(); f.spy.failEnrich = true; const a = await f.call(META); assert.equal(a.code, 503); assert.equal(a.headers['Cache-Control'], 'no-store'); f.spy.failEnrich = false; const b = await f.call(META); assert.equal(b.code, 200); assert.equal(f.spy.matches, 2); assert.equal(b.body.items.find(x => x.archetype === '原型甲').games, 5);
});
await T('B5 sitemap失敗不快取錯誤、可以立即恢復', async () => {
  const f = fixture(); f.spy.failSite = true; const a = await f.call(SITE); assert.equal(a.code, 503); assert.equal(a.headers['Cache-Control'], 'no-store'); f.spy.failSite = false; assert.equal((await f.call(SITE)).code, 200); assert.equal(f.spy.sitemap, 2);
});
await T('B6 必要中央函式未就緒不可發布假統計', async () => {
  for (const key of ['_buildCasualCleanFilter', '_archetypeEnrichMatchRecords']) {
    const f = fixture(); const original = f.app.locals[key]; delete f.app.locals[key]; const r = await f.call(META); assert.equal(r.code, 503); assert.equal(r.headers['Cache-Control'], 'no-store'); assert.equal(f.spy.aggregate, 0); if (original) { f.app.locals[key] = original; assert.equal((await f.call(META)).code, 200); }
  }
});
await T('B7 統計30分鐘與sitemap10分鐘到期重新合併查詢', async () => {
  const f = fixture(); await f.call(META); await f.call(SITE); f.spy.now += 599999; await f.call(META); await f.call(SITE); assert.equal(f.spy.aggregate, 1); assert.equal(f.spy.sitemap, 1);
  f.spy.now++; await Promise.all(Array.from({ length: 10 }, () => f.call(SITE))); assert.equal(f.spy.sitemap, 2); f.spy.now += 1199999; await f.call(META); assert.equal(f.spy.aggregate, 1); f.spy.now++; await Promise.all(Array.from({ length: 10 }, () => f.call(META))); assert.equal(f.spy.aggregate, 2);
});
await T('C1 真中央過濾判準確實被統計路由呼叫', async () => { const f = fixture(); await f.call(META); assert.equal(f.spy.central, 1); });
await T('C2 排除AI、首回合未進場與早退，納入合法邊界', async () => {
  const valid = fixtureMatches()[0];
  const records = [{ ...valid, roomCode: undefined }, { ...valid, winReason: '無回應', finalTurn: 1 }, { ...valid, winReason: '中途離開', finalTurn: 2 }, { ...valid, winner: -1 }, { ...valid, winReason: '無回應', finalTurn: 2 }, { ...valid, winReason: '中途離開', finalTurn: 3 }, valid];
  const f = fixture({ records }); const r = await f.call(META); const row = r.body.items.find(x => x.archetype === '原型甲'); assert.equal(row.games, 3); assert.equal(row.winRate, null); assert.equal(f.spy.limit, 500); assert.deepEqual(Object.keys(f.spy.projection).sort(), ['endedAt', 'p1.cardCounts', 'p2.cardCounts', 'winner']);
});
await T('C3 五場門檻與勝率分母、冠軍投稿口徑保留', async () => {
  const r = await fixture().call(META); const a = r.body.items.find(x => x.archetype === '原型甲'); assert.equal(a.games, 5); assert.equal(a.wins, 3); assert.equal(a.losses, 2); assert.equal(a.winRate, 0.6); assert.equal(a.topCuts, 1); assert.equal(a.postCount, 2);
});
const pageSrc = rd('src/routes/deck-posts/+page.svelte');
await T('D1 CSS首次繪製不依賴data-ui-wide：桌機／手機均正確', async () => {
  const browser = await pwLaunch('v6626公布欄首次繪製'); if (!browser) throw Error('此行為驗證需要Playwright');
  try {
    const css = pageSrc.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1]; assert.ok(css && css.includes('.meta-mobile-row'));
    const { compile } = await import('svelte/compiler');
    const markup = '<section class="meta-bar"><div class="meta-bar-head">排行</div><div class="meta-chips"><button class="meta-chip">原型甲</button></div><div class="meta-mobile-row"><select class="meta-select"><option>原型甲</option></select></div></section>';
    const compiled = compile(markup + '<style>' + css + '</style>', { generate: 'server', css: 'external' });
    const hash = compiled.css.code.match(/\.svelte-[\w]+/)?.[0].slice(1); assert.ok(hash);
    for (const width of [390, 1023, 1024, 1366]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } }); const p = await ctx.newPage();
      await p.setContent('<style>' + compiled.css.code + '</style>' + markup.replace(/class="([^"]+)"/g, (_, c) => 'class="' + c + ' ' + hash + '"'));
      for (const wide of [false, true]) {
        await p.evaluate(v => { document.documentElement.toggleAttribute('data-ui-wide', v); }, wide);
        assert.equal(await p.locator('.meta-mobile-row').isVisible(), width < 1024, 'mobile ' + width + ' wide=' + wide);
        assert.equal(await p.locator('.meta-chips').isVisible(), width >= 1024, 'desktop ' + width + ' wide=' + wide);
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
});
console.log(`${pass} PASS / ${fail} FAIL`);
if (fail) process.exitCode = 1;
