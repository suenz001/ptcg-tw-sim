#!/usr/bin/env node
// v6.588：實際產品 handler／pipeline、Svelte 互動與卡背量測；不連正式資料庫。
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';
import { pwLaunch } from './lib/pw.mjs';
import { readBaseBlob, hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { deckReplayServer, functionSource, clone } from './lib/deck-replay-db-fixture.mjs';
import { postListBundle, openingBundle, fixtureHtml, measureOpening } from './lib/deck-replay-ui-fixture.mjs';
import { revertAdminV173 as _revertAdminV173 } from './lib/sap-revert-admin-v173.mjs';
import { revertAdminV174 } from './lib/sap-revert-admin-v174.mjs';   // ⭐v6.601（server v1.74，Rule 40）：我的錦標賽對戰回傳 result（行為由 test-v6601 守）
const revertAdminV173 = (s) => _revertAdminV173(revertAdminV174(s));   // 鏈又長一節（既有呼叫點一個字都不必改）
import { revertV173 } from './lib/tourn-revert-v173.mjs';
import { revertAdminV172 } from './lib/sap-revert-admin-v172.mjs';
import { revertAdminV171 } from './lib/sap-revert-admin-v171.mjs';
import { revertV171, TAIL_ANCHOR, TEV_ANCHOR, NEW_TAIL_SHA_V171, NEW_TEV_SHA_V171, NEW_TEV_LEN_V171 } from './lib/tourn-revert-v171.mjs';
import { NEW_TAIL_SHA_V169, NEW_TEV_SHA_V169, NEW_TEV_LEN_V169 } from './lib/tourn-revert-v169.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PRODUCT = process.env.V6588_PRODUCT_ROOT || ROOT;
const BASE = '5106824ec21b4bbf01340876d9cc85b551c6b5c8';
const SAP = 'oracle-admin/server_admin_patch.js', PAGE = 'src/routes/deck-posts/+page.svelte', OPEN = 'src/lib/decks/OpeningHandSim.svelte';
const paths = [SAP, PAGE, OPEN], bytes = paths.map(p => readFileSync(join(PRODUCT, p)));
const read = p => readFileSync(join(PRODUCT, p), 'utf8').replace(/\r\n/g, '\n');
const source = read(SAP), pageSource = read(PAGE), opening = read(OPEN), layout = read('src/routes/+layout.svelte');
const asset = readFileSync(join(PRODUCT, 'src/lib/assets/pokemon-card-back.jpg'));
const sha = value => createHash('sha256').update(value).digest('hex');
let pass = 0, fail = 0;
function ok(name, yes, detail = '') { if (yes) { pass++; console.log('PASS ' + name); } else { fail++; console.error('FAIL ' + name + ' ' + detail); } }
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let baseSource, basePage, baseOpening;
if (hasBaseCommit(ROOT, BASE)) {
  [baseSource, basePage, baseOpening] = paths.map(p => { const r = readBaseBlob(ROOT, BASE, p); if (!r.ok) throw new Error('讀取 BASE 失敗 ' + p); return r.out.replace(/\r\n/g, '\n'); });
  let reverted = ''; try { reverted = revertAdminV171(revertAdminV172(revertAdminV173(source))); } catch { /* 舊版完整守衛必須逐條紅，不整支 throw。 */ }
  ok('D2 精確還原整份 server＝BASE，其他行不變', reverted === baseSource);
  for (const anchor of [TAIL_ANCHOR, TEV_ANCHOR]) {
    let result = ''; try { result = revertV171(revertV173(source.slice(source.indexOf(anchor)))); } catch { /* 明確紅項。 */ }
    ok('D2 精確還原區塊 ' + anchor, result === baseSource.slice(baseSource.indexOf(anchor)));
  }
} else shallowSkip('v6588 BASE', '需要 main v6.587 歷史');
const tail = revertV173(source.slice(source.indexOf(TAIL_ANCHOR))), tev = revertV173(source.slice(source.indexOf(TEV_ANCHOR)));
ok('D1 現行三把指紋', sha(tail) === NEW_TAIL_SHA_V171 && sha(tev) === NEW_TEV_SHA_V171 && tev.length === NEW_TEV_LEN_V171);
ok('D3 指紋突變自驗', sha(tail + ' ') !== NEW_TAIL_SHA_V171);
const scriptFiles=[];
function walkScripts(dir='scripts') { for(const e of readdirSync(join(ROOT,dir),{withFileTypes:true})) { const rel=dir+'/'+e.name;if(e.isDirectory())walkScripts(rel);else if(e.name.endsWith('.mjs'))scriptFiles.push(rel); } }
walkScripts();
const stale=scriptFiles.filter(p=>p!=='scripts/lib/tourn-revert-v169.mjs').filter(p=>{const s=readFileSync(join(ROOT,p),'utf8');return s.includes(NEW_TAIL_SHA_V169)||s.includes(NEW_TEV_SHA_V169)||new RegExp('const (?:TOURN_LEN\\w*|TEV_LEN\\w*) = '+NEW_TEV_LEN_V169+'\\b').test(s);});
ok('D4 舊v169指紋在歷史宣告端外零殘留',stale.length===0,stale.join(','));
const tailConsumers=['test-v6276-deck-tournament-stats.mjs','test-v6291-tourn-verified-gate.mjs','test-v6292-tourn-verified-gate2.mjs','test-v6381-archive-gamedraw-and-swiss-note.mjs'];
const scriptText=p=>readFileSync(join(ROOT,'scripts',p),'utf8');
ok('D5 四條區塊鏈及v6303整檔鏈皆先接v171',tailConsumers.every(p=>{const s=scriptText(p);return s.includes("from './lib/tourn-revert-v173.mjs'")&&s.includes('revertV171(');})&&scriptText('test-v6303-ui-batch.mjs').includes('revertAdminV171('));
const wholeConsumers=['test-v6561-tourn-replay-per-action.mjs','test-sap153-tourn-deck-validate.mjs','test-sap154-audit-load.mjs','test-sap169-restart-coin-wording.mjs','test-v6303-ui-batch.mjs'];
const wholeTexts=wholeConsumers.map(scriptText);
const connected=xs=>xs.length===5&&xs.every(s=>s.includes("from './lib/sap-revert-admin-v171.mjs'")&&s.includes('revertAdminV171('));
ok('D5 五支整檔歷史鎖皆先還原v171',connected(wholeTexts));
const disconnected=wholeTexts.map((s,i)=>i===0?s.replaceAll('revertAdminV171(','disabled171('):s);
ok('D5 接線負對照：任一支漏掉最外層便紅',!connected(disconnected));
ok('卡背：沿用已核對官方位元組', sha(asset) === '37a4df719ed9134a4652c639fea545f549c6cce40647ad5d82909be02a6afeb3');
ok('卡背：使用 Vite 相對資源', opening.includes("url('../assets/pokemon-card-back.jpg')"));
ok('卡背：測抽 script、markup 與原版完全相同', !baseOpening || opening.slice(0, opening.indexOf('<style>')) === baseOpening.slice(0, baseOpening.indexOf('<style>')));

function dataSet() {
  const deckPosts = Array.from({ length: 27 }, (_, i) => ({
    _id: 'dp_' + String(i).padStart(2, '0'), uid: 'owner', email: 'private@example.invalid', entriesHash: 'private-hash',
    status: i === 25 ? 'hidden' : i === 26 ? 'deleted' : 'published', authorName: '很長很長的測試玩家名稱ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    deckName: '測試牌組 ' + i, notes: i % 3 ? '其他' : '火焰測試', entries: [{ cardId: '1', count: 60 }],
    createdAt: 1780000000000 + i * 86400000, likeCount: i * 10, downloadCount: 99, commentCount: 3,
    tournament: i % 2 ? null : { eventId: 'evt', eventName: '測試賽', placementLabel: '冠軍' },
  }));
  const deckPostReplays = [];
  for (let i = 0; i < deckPosts.length; i++) {
    const n = i === 1 ? 30 : i >= 25 ? 50 : i % 7;
    for (let j = 0; j < n; j++) deckPostReplays.push({ _id: `r_${i}_${j}`, postId: deckPosts[i]._id, status: 'active', kind: j % 2 ? 'casual' : 'tournament', gz: 'PRIVATE_REPLAY_BYTES' });
  }
  for (let i = 0; i < 100; i++) deckPostReplays.push({ _id: 'removed' + i, postId: 'dp_24', status: 'removed', gz: null });
  return { deckPosts, deckPostReplays };
}
const data = dataSet();
const expectedCount = id => data.deckPostReplays.filter(r => r.postId === id && r.status === 'active').length;
const expectedOrder = data.deckPosts.filter(p => p.status === 'published').sort((a, b) => expectedCount(b._id) - expectedCount(a._id) || b.createdAt - a.createdAt || a._id.localeCompare(b._id)).map(p => p._id);
const expectedIntersection = expectedOrder.filter(id=>{const p=data.deckPosts.find(d=>d._id===id);return p.notes.includes('火焰')&&p.tournament;});
async function serverFacts(text) {
  const s = deckReplayServer(text, data);
  const ranked = await s.request({ sort: 'replays', pageSize: '2' });
  const second = await s.request({ sort: 'replays', page: '2', pageSize: '2' });
  const intersect = await s.request({ sort: 'replays', tournamentOnly: '1', q: '火焰', pageSize: '50' });
  const c0 = s.calls.length, plain = await s.request({ sort: 'new', pageSize: '20' });
  const plainCalls = s.calls.slice(c0);
  return {
    cap: ranked.replayStats === 1,
    sorted: equal([...ranked.posts, ...second.posts].map(p => p.id), expectedOrder.slice(0, 4)),
    counts: plain.posts.every(p => p.replayCount === expectedCount(p.id)),
    activeOnly: plain.posts.find(p => p.id === 'dp_24')?.replayCount === 3,
    intersect: intersect.total === expectedIntersection.length && equal(intersect.posts.map(p=>p.id),expectedIntersection),
    private: [...ranked.posts, ...plain.posts].every(p => !('uid' in p || 'email' in p || 'entries' in p || 'gz' in p || 'entriesHash' in p)),
    batch: plainCalls.filter(c => c.op === 'aggregate').length === 1 && plainCalls.filter(c => c.op === 'find').length === 1,
    plain: plain.posts[0]?.id === 'dp_24' && plain.total === 25,
  };
}
const facts = await serverFacts(source);
for (const [k, v] of Object.entries(facts)) if (k !== 'cache') ok('S ' + k, v);
const cachedServer = deckReplayServer(source, data); await cachedServer.request();
const cachedCalls = cachedServer.calls.length; await cachedServer.request();
ok('S 相同列表快取不新增資料庫查詢', cachedServer.calls.length === cachedCalls);
if (baseSource) {
  const old = await serverFacts(baseSource);
  for (const k of ['cap', 'sorted', 'counts', 'activeOnly']) ok('H BASE 不具備 ' + k, old[k] === false);
  for (const k of ['intersect', 'private', 'plain']) if (k !== 'intersect') ok('H BASE 正對照 ' + k, old[k]);
}

// 真實 remove handler 移除最後附件；既有列表快取須失效。
const lastData = { deckPosts: data.deckPosts.slice(0, 21), deckPostReplays: data.deckPosts.slice(0, 21).map((p, i) => ({ _id: 'one_' + i, postId: p._id, status: 'active', kind: 'casual' })) };
const removeServer = deckReplayServer(source, lastData);
const beforeRemoval = await removeServer.request({ sort: 'replays', page: '2' });
await removeServer.request({}, 'POST', '/api/deck-posts-replays/remove', { identity: { uid: 'owner' }, body: { id: 'one_0' } });
const afterRemoval = await removeServer.request({ sort: 'replays', page: '2' });
ok('S 真 remove handler 令快取失效／排除移除附件', beforeRemoval.total === 21 && afterRemoval.total === 21 && beforeRemoval.posts[0]?.replayCount === 1 && afterRemoval.posts[0]?.id === 'dp_00' && afterRemoval.posts[0]?.replayCount === 0);
ok('S remove 不修改牌組內容／非目標附件', removeServer.collections.deckPostReplays.filter(r => r.status === 'active').length === 20 && equal(removeServer.collections.deckPosts, lastData.deckPosts));

async function pagingFacts(text) {
  const code = (await transform(functionSource(text, 'fetchList'), { loader: 'ts', format: 'esm' })).code.replace(/^export \{[\s\S]*?\};?\s*$/gm, '');
  const factory = new Function('api', `let page=2,total=21,posts=[],listSeq=0,loading=false,loadError='',sort='replays',pageSize=20,tournamentOnly=false,replayStatsSupported=true,searchQ='',searchUnsupported=false;${code};return {run:fetchList,state:()=>({page,total,posts,loading}),setPage:n=>{page=n}}`);
  const queries = [];
  const x = factory(async path => { const p = new URL(path, 'https://fixture').searchParams; queries.push(p.get('page')); return { total: 20, posts: p.get('page') === '1' ? [{ id: 'valid' }] : [], replayStats: 1 }; });
  await x.run(true);
  let normalCalls=0;const normal = factory(async () => {normalCalls++;return { total: 21, posts: [{ id: 'normal' }], replayStats: 1 };}); await normal.run();
  const pending = []; const race = factory(() => new Promise(resolve => { if(pending.length<2)pending.push(resolve);else resolve({total:40,posts:[{id:'old-followup'}],replayStats:1}); }));
  const old = race.run(); race.setPage(2); const recent = race.run();
  pending[1]({ total: 40, posts: [{ id: 'recent' }], replayStats: 1 }); await recent;
  pending[0]({ total: 0, posts: [], replayStats: 1 }); await old;
  return { clamp: x.state().page === 1 && x.state().posts[0]?.id === 'valid' && equal(queries, ['2', '1']), normal: normalCalls===1 && normal.state().page === 2 && normal.state().posts[0]?.id === 'normal', race: race.state().page === 2 && race.state().posts[0]?.id === 'recent' };
}
const paging = await pagingFacts(pageSource);
for (const [k, v] of Object.entries(paging)) ok('P 分頁 ' + k, v);
if (basePage) { const old = await pagingFacts(basePage); ok('H BASE 最後有效頁不收斂', !old.clamp); ok('H BASE 請求代次正對照', old.normal && old.race); }
const noClamp = pageSource.replace('if (page > lastPage) { page = lastPage; await fetchList(quiet); return; }', 'if (false && page > lastPage) { page = lastPage; await fetchList(quiet); return; }');
if (noClamp !== pageSource) { const r=await pagingFacts(noClamp);ok('M 失去頁碼收斂會紅',!r.clamp);ok('M 頁碼突變正常頁／代次仍綠',r.normal&&r.race); } else ok('M 頁碼收斂前置結構',false);
const noSequence = pageSource.replace('if (seq !== listSeq) return;              // 已經有更新的一發，這份結果作廢','if (false && seq !== listSeq) return;              // 已經有更新的一發，這份結果作廢');
if(noSequence!==pageSource){const r=await pagingFacts(noSequence);ok('M 舊代次防護消失會紅',!r.race);ok('M 代次突變正常頁仍綠',r.normal);}else ok('M 代次前置結構',false);

const mutations = [
  ['排序方向', source.replace('replayCount: -1, createdAt: -1, _id: 1', 'replayCount: 1, createdAt: -1, _id: 1'), 'sorted'],
  ['把已移除附件計入', source.replace("postId: { $in: docs.map(d => d._id) }, status: 'active'", 'postId: { $in: docs.map(d => d._id) }'), 'activeOnly'],
  ['漏每頁次數', source.replace('doc.replayCount = byId.get(doc._id) || 0', 'doc.replayCount = 0'), 'counts'],
  ['先分頁再統計排序', source.replace('{ $match: query },', '{ $match: query }, { $skip: (page - 1) * pageSize }, { $limit: pageSize },'), 'sorted'],
  ['統計忽略搜尋交集',source.replace('{ $match: query },','{ $match: { ...query, $and: [] } },'),'intersect'],
];
for (const [name, text, key] of mutations) {
  if (text === source) { ok('M 前置結構 ' + name, false); continue; }
  const result = await serverFacts(text);
  ok('M ' + name + ' 指定判準紅', result[key] === false);
  ok('M ' + name + ' 既有排序／隱私正對照綠', result.plain && result.private);
}
const n1 = await serverFacts(source.replace('// v1.71／v6.588', '// 僅改註解 v1.71／v6.588'));
ok('N1 只改註解無功能差異', equal(n1, facts));

const browser = await pwLaunch('v6.588 公布欄／測抽真元件');
if (browser) {
  try {
    const uiData=clone(data);for(const p of uiData.deckPosts){p.likeCount=9999;p.downloadCount=9999;p.commentCount=9999;}
    const page = await browser.newPage(); let bridge = deckReplayServer(source, uiData), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('fixtureApi', async path => bridge.request(Object.fromEntries(new URL(path, 'https://fixture').searchParams)));
    const postJs = await postListBundle(ROOT, pageSource);
    async function showPosts(js, width, theme, serverSource = source) {
      bridge = deckReplayServer(serverSource, uiData); await page.setViewportSize({ width, height: 900 });
      await page.setContent(fixtureHtml(layout, width, theme)); await page.addScriptTag({ content: js }); await page.locator('.post-card').first().waitFor();
    }
    for (const width of [320, 390, 430, 1280]) for (const theme of ['light', 'dark']) {
      await showPosts(postJs, width, theme);
      const measured = await page.evaluate(() => {
        const buttons=[...document.querySelectorAll('.sorts button')],stats=[...document.querySelectorAll('.replay-stat')];
        const within=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=-1&&r.right<=innerWidth+1;};
        return { count:stats.length, layout:[...buttons,...document.querySelectorAll('.filters,.post-card,.post-meta,.post-meta .date,.post-meta .author,.post-stats,.stat')].every(within)&&document.documentElement.scrollWidth<=innerWidth,
          targets:buttons.every(e=>innerWidth>600||e.getBoundingClientRect().height>=44), controls:buttons.some(e=>e.textContent.includes('最多對戰紀錄'))&&!document.body.textContent.includes('只看有對戰紀錄') };
      });
      ok(`U ${width} ${theme} 顯示20篇附加次數與新按鈕`, measured.count===20 && measured.controls);
      ok(`U ${width} ${theme} 控制／日期／統計無水平溢出`, measured.layout && measured.targets);
      if (process.env.V6588_ARTIFACT_DIR && [390,1280].includes(width)) await page.screenshot({ path:join(process.env.V6588_ARTIFACT_DIR,`posts-${width}-${theme}.png`) });
    }
    const fixedWidth=pageSource.replace('.sorts { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0;', '.sorts { display: flex; flex-wrap: wrap; gap: 6px; min-width: 900px;');
    if(fixedWidth!==pageSource){
      await showPosts(await postListBundle(ROOT,fixedWidth),320,'light');
      ok('M 手機排序列固定寬度可抓溢出',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
      ok('M 版面突變仍正常載入次數',await page.locator('.replay-stat').count()===20);
    }else ok('M 手機寬度前置結構',false);
    await showPosts(postJs, 390, 'light');
    const sortButton=page.getByRole('button',{name:'最多對戰紀錄',exact:true});
    if (await sortButton.count()) {
      await sortButton.click(); await page.waitForFunction(()=>document.querySelector('.post-card .deck-name')?.textContent==='測試牌組 1');
      ok('U 點排序真的換成全站最多30場的第1篇', await page.locator('.post-card').first().locator('.replay-stat').textContent()==='📼 30');
      await page.getByLabel('只看賽事名次牌組',{exact:true}).check();
      await page.waitForFunction(()=>document.querySelector('.post-card .deck-name')?.textContent==='測試牌組 20');
      ok('U 紀錄排序可搭配原賽事篩選，保留無紀錄投稿', bridge.calls.some(c=>c.op==='aggregate'&&c.stages.some(s=>s.$match?.tournament?.$ne===null)));
    } else { ok('U 點排序前置按鈕',false); }
    await showPosts(postJs,390,'light',baseSource||source);
    ok('U 舊伺服器無哨兵：保留舊功能、隱藏新控制與未知統計', !(await page.locator('.replay-stat').count())&&!(await page.getByRole('button',{name:'最多對戰紀錄',exact:true}).count())&&await page.locator('.post-card').count()===20);
    if (basePage) {
      await showPosts(await postListBundle(ROOT,basePage),390,'light');
      ok('H BASE 列表缺新按鈕與計數', !(await page.locator('.replay-stat').count())&&!(await page.getByRole('button',{name:'最多對戰紀錄',exact:true}).count()));
    }
    const openingJs = await openingBundle(ROOT,opening,asset);
    const oldOpeningJs = baseOpening ? await openingBundle(ROOT,baseOpening,asset) : null;
    const cards=[];for(const name of readdirSync(join(PRODUCT,'static/cards'))) { if(!name.endsWith('.json')||name==='index.json')continue;const list=JSON.parse(read('static/cards/'+name));if(Array.isArray(list))cards.push(...list);if(cards.some(c=>c.supertype==='Pokemon'&&c.subtype==='Basic'))break; }
    const card=cards.find(c=>c.supertype==='Pokemon'&&c.subtype==='Basic'); if(!card)throw new Error('實際基礎卡夾具不足');
    async function showOpening(js,width,theme='light') {
      await page.setViewportSize({width,height:900});await page.setContent(fixtureHtml(layout,width,theme));
      await page.evaluate(c=>{window.fixtureEntries=[{card:c,count:60}];},card);await page.addScriptTag({content:js});await page.locator('.ohs-back').first().waitFor({state:'attached'});
      return measureOpening(page);
    }
    for(const width of [320,390,430,1280])for(const theme of ['light','dark']) {
      const before=oldOpeningJs?await showOpening(oldOpeningJs,width,theme):null;const after=await showOpening(openingJs,width,theme);
      ok(`O ${width} ${theme} 六張官方卡背且未揭露卡名`,after.official&&after.hiddenNames&&!after.overflow);
      if(before){ok(`H ${width} ${theme} 舊版不是官方卡背`,!before.official);ok(`O ${width} ${theme} 卡片／固定按鈕幾何不變`,equal(before.geometry,after.geometry));}
      if(process.env.V6588_ARTIFACT_DIR&&[390,1280].includes(width))await page.screenshot({path:join(process.env.V6588_ARTIFACT_DIR,`opening-${width}-${theme}.png`)});
      await page.getByRole('button',{name:'翻開看看',exact:true}).click();
      ok(`O ${width} ${theme} 翻開顯示六張真卡面、無卡背`,await page.locator('.ohs-prizes img').count()===6&&await page.locator('.ohs-back').count()===0);
      await page.getByRole('button',{name:'蓋回去',exact:true}).click();await page.getByRole('button',{name:/再抽 1 張/}).click();
      ok(`O ${width} ${theme} 蓋回／再抽正常`,(await measureOpening(page)).hand===8&&(await measureOpening(page)).official);
      await page.getByRole('button',{name:/重新洗牌/}).click();ok(`O ${width} ${theme} 重抽回7手牌6獎賞`,(await measureOpening(page)).hand===7&&(await measureOpening(page)).count===6);
    }
    const backMutations=[['漏圖',opening.replace("url('../assets/pokemon-card-back.jpg')",'none')],['縮為零',opening.replace('center / cover no-repeat','center / 0px 0px no-repeat')],['圖案重複',opening.replace('center / cover no-repeat','center / cover repeat')],['錯誤位置',opening.replace('center / cover no-repeat','left top / cover no-repeat')],['卡背隱藏',opening.replace('.ohs-back { background:', '.ohs-back { visibility: hidden; background:')]];
    for(const [name,text]of backMutations){if(text===opening){ok('M 卡背前置 '+name,false);continue;}const r=await showOpening(await openingBundle(ROOT,text,asset),390);ok('M 卡背 '+name+' 指定外觀紅',!r.official);ok('M 卡背 '+name+' 手牌／資訊正對照綠',r.hand===7&&r.hiddenNames);}
    ok('U 無瀏覽器執行錯誤',errors.length===0,errors.join('|'));
    await showPosts(postJs,390,'light');ok('最後 HEAD 公布欄控制／次數回綠',await page.locator('.replay-stat').count()===20&&await page.getByRole('button',{name:'最多對戰紀錄',exact:true}).count()===1);
    const final=await showOpening(openingJs,390);ok('最後 HEAD 官方卡背回綠',final.official&&final.hand===7);
  } finally { await browser.close(); }
}
ok('原始產品檔案bytes不變', paths.every((p,i)=>readFileSync(join(PRODUCT,p)).equals(bytes[i])));
const finalFacts=await serverFacts(source);ok('最後 HEAD 伺服器判準回綠',Object.entries(finalFacts).filter(([k])=>k!=='cache').every(([,v])=>v));
console.log(`\n=== v6.588 ${pass} PASS / ${fail} FAIL ===`);process.exit(fail?1:0);
