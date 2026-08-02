/**
 * v6.101 守衛：卡圖載入失敗自動重試（$lib/img-retry.ts）
 *
 * 背景：玩家回報手機版手牌常有幾張圖片不顯示、過幾回合才突然出現。
 * 成因是官網 CDN 大圖在弱網下載入失敗，而 <img> 失敗後瀏覽器永遠不會自己重試。
 *
 * 本守衛兩個區塊：
 *  ① 行為端 —— 直接跑 retryImg 的重試狀態機（假 DOM ＋ 假計時器），驗證退避、代理切換、
 *     cache-buster 只在最後一次、成功後歸零、destroy 收乾淨。
 *  ② 靜態端 —— 全站卡圖 <img> 都必須掛 use:retryImg（含**故意壞樣本正對照**，
 *     證明這條掃描真的會失敗，不是永遠綠的假守衛）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const O = join(ROOT, '.x-imgretry.mjs');
process.on('exit', () => { try { unlinkSync(O); } catch {} });

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); console.log('  ✓', name); pass++; } catch (e) { console.log('  ✗', name, '→', e.message); fail++; } };

await build({
  entryPoints: [join(ROOT, 'src/lib/img-retry.ts')], outfile: O,
  bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error',
});
const { retryImg } = await import(pathToFileURL(O).href);

// ---------- 假 DOM ----------
const CDN = 'https://asia.pokemon-card.com/tw/card-img/tw12345678.png';
function makeImg(src = CDN) {
  const listeners = new Map(), attrs = new Map();
  return {
    srcHistory: [src], _src: src,
    get src() { return this._src; },
    set src(v) { this._src = v; this.srcHistory.push(v); },
    currentSrc: '', complete: false, naturalWidth: 1,
    addEventListener: (t, f) => { (listeners.get(t) ?? listeners.set(t, []).get(t)).push(f); },
    removeEventListener: (t, f) => { const a = listeners.get(t) ?? []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => attrs.get(k) ?? null,
    hasAttribute: (k) => attrs.has(k),
    removeAttribute: (k) => attrs.delete(k),
    _fire: (t) => { for (const f of [...(listeners.get(t) ?? [])]) f(); },
    _listenerCount: (t) => (listeners.get(t) ?? []).length,
  };
}
// 假計時器：收集排定的 callback，由測試手動推進
let timers = [];
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
function installFakeEnv() {
  timers = [];
  // ⚠ id 從 1 起：真實 setTimeout 不會回傳 0，回傳 0 會讓 `if (timer)` 這種寫法失效（本輪踩過）
  globalThis.setTimeout = (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id, dead: false }); return id; };
  globalThis.clearTimeout = (id) => { const t = timers[id - 1]; if (t) t.dead = true; };
  const winL = new Map(), docL = new Map();
  globalThis.window = {
    addEventListener: (t, f) => { (winL.get(t) ?? winL.set(t, []).get(t)).push(f); },
    removeEventListener: (t, f) => { const a = winL.get(t) ?? []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    _fire: (t) => { for (const f of [...(winL.get(t) ?? [])]) f(); },
    _count: (t) => (winL.get(t) ?? []).length,
  };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (t, f) => { (docL.get(t) ?? docL.set(t, []).get(t)).push(f); },
    removeEventListener: (t, f) => { const a = docL.get(t) ?? []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    _fire: (t) => { for (const f of [...(docL.get(t) ?? [])]) f(); },
    _count: (t) => (docL.get(t) ?? []).length,
  };
}
const runPending = () => { const t = timers.filter((x) => !x.dead && !x.done); for (const x of t) { x.done = true; x.fn(); } };
const lastDelay = () => { const t = timers.filter((x) => !x.dead); return t.length ? t[t.length - 1].ms : null; };

console.log('① 行為端：重試狀態機');
installFakeEnv();
{
  const img = makeImg();
  const h = retryImg(img);

  ok('1-1 失敗時掛上 data-img-retrying（供 CSS 顯示佔位）', () => {
    img._fire('error');
    assert.strictEqual(img.getAttribute('data-img-retrying'), '1');
  });
  ok('1-2 第 1 次退避 1 秒、且重試的是原始網址（不動 CDN 快取）', () => {
    assert.strictEqual(lastDelay(), 1000);
    runPending();
    assert.strictEqual(img.srcHistory.at(-1), CDN);
  });
  ok('1-3 第 2 次退避 3 秒、改走圖片代理縮圖（換一條路，不是單純重試）', () => {
    img._fire('error');
    assert.strictEqual(lastDelay(), 3000);
    runPending();
    const u = img.srcHistory.at(-1);
    assert.ok(u.startsWith('https://images.weserv.nl/?url='), u);
    assert.ok(u.includes(encodeURIComponent('asia.pokemon-card.com/tw/card-img/tw12345678.png')), u);
    assert.ok(!u.includes('_r='), '第 2 次不該加 cache-buster：' + u);
  });
  ok('1-4 第 3 次退避 8 秒、仍不加 cache-buster', () => {
    img._fire('error');
    assert.strictEqual(lastDelay(), 8000);
    runPending();
    assert.ok(!img.srcHistory.at(-1).includes('_r='));
  });
  ok('1-5 第 4 次（最後一次）退避 20 秒、才加 cache-buster', () => {
    img._fire('error');
    assert.strictEqual(lastDelay(), 20000);
    runPending();
    assert.ok(/[?&]_r=\d+/.test(img.srcHistory.at(-1)), img.srcHistory.at(-1));
  });
  ok('1-5b 最後一次退回官網原圖（代理本身掛掉時仍有一條活路）', () => {
    const last = img.srcHistory.at(-1);
    assert.ok(!last.includes('weserv.nl'), '最後一次不該還在代理上：' + last);
    assert.ok(last.startsWith(CDN), last);
  });
  ok('1-6 用完 4 次後不再無限重試（避免弱網下打爆 CDN）', () => {
    const before = img.srcHistory.length;
    img._fire('error'); runPending();
    assert.strictEqual(img.srcHistory.length, before);
  });
  ok('1-7 destroy 後三處 listener 都移除、不留計時器', () => {
    h.destroy();
    assert.strictEqual(img._listenerCount('error'), 0);
    assert.strictEqual(img._listenerCount('load'), 0);
    assert.strictEqual(globalThis.window._count('online'), 0);
    assert.strictEqual(globalThis.document._count('visibilitychange'), 0);
  });
}
{
  installFakeEnv();
  const img = makeImg();
  const h = retryImg(img);
  ok('1-8 載入成功會清掉 data-img-retrying 並把次數歸零（之後再壞仍有完整額度）', () => {
    img._fire('error'); runPending();          // 用掉第 1 次
    img._fire('load');
    assert.strictEqual(img.hasAttribute('data-img-retrying'), false);
    img._fire('error');
    assert.strictEqual(lastDelay(), 1000, '歸零後應該重新從 1 秒開始');
    runPending();
    assert.strictEqual(img.srcHistory.at(-1), CDN, '歸零後第 1 次應回到原始網址');
  });
  ok('1-9 網路恢復（online）在失敗狀態下立刻補一次，不用等退避', () => {
    const before = img.srcHistory.length;
    img._fire('error');                         // 進入失敗狀態、排了計時器
    globalThis.window._fire('online');
    assert.ok(img.srcHistory.length > before, '應該立即重試');
  });
  ok('1-10 切回前景（visibilitychange）同樣立刻補一次', () => {
    const before = img.srcHistory.length;
    globalThis.document._fire('visibilitychange');
    assert.ok(img.srcHistory.length > before);
  });
  h.destroy();
  ok('1-11 圖片正常時，online／visibilitychange 不會亂改 src（避免無謂重抓）', () => {
    installFakeEnv();
    const good = makeImg();
    const hh = retryImg(good);
    good._fire('load');
    const before = good.srcHistory.length;
    globalThis.window._fire('online');
    globalThis.document._fire('visibilitychange');
    assert.strictEqual(good.srcHistory.length, before);
    hh.destroy();
  });
  ok('1-12 站內相對路徑不送去外部代理（只有官網 CDN 大圖需要代理）', () => {
    installFakeEnv();
    const local = makeImg('/covers/x.png');
    const hh = retryImg(local);
    local._fire('error'); runPending();
    local._fire('error'); runPending();          // 第 2 次本來會換代理
    assert.ok(!local.srcHistory.at(-1).includes('weserv.nl'), local.srcHistory.at(-1));
    hh.destroy();
  });
  ok('1-13 掛上時就已是壞圖（complete 且 naturalWidth=0）會自動排重試', () => {
    installFakeEnv();
    const broken = makeImg();
    broken.complete = true; broken.naturalWidth = 0;
    const hh = retryImg(broken);
    assert.strictEqual(broken.getAttribute('data-img-retrying'), '1');
    assert.strictEqual(lastDelay(), 1000);
    hh.destroy();
  });
}
globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;

{
  installFakeEnv();
  const img = makeImg();
  const OTHER = 'https://asia.pokemon-card.com/tw/card-img/tw99999999.png';
  const h = retryImg(img, CDN);
  ok('1-14 ⭐節點被重用來顯示另一張卡時，重試的是新卡（不是把畫面換回上一張）', () => {
    img._fire('error');                 // 舊卡失敗，進入重試狀態
    h.update(OTHER);                    // Svelte 就地換 src（keyed each 重用節點）
    assert.strictEqual(img.hasAttribute('data-img-retrying'), false, '換卡要清掉重試中的標記');
    img._fire('error');
    assert.strictEqual(lastDelay(), 1000, '換卡後次數要歸零');
    runPending();
    assert.strictEqual(img.srcHistory.at(-1), OTHER, '重試的必須是新卡的圖');
  });
  ok('1-15 切到背景時不重試（背景網路常被掐斷，會白白燒掉額度）', () => {
    globalThis.document.visibilityState = 'hidden';
    const before = img.srcHistory.length;
    globalThis.document._fire('visibilitychange');
    assert.strictEqual(img.srcHistory.length, before);
    globalThis.document.visibilityState = 'visible';
  });
  ok('1-16 網路恢復時把次數歸零（斷網期間耗掉的不算數，否則圖會永遠空白）', () => {
    for (let i = 0; i < 6; i++) { img._fire('error'); runPending(); }   // 先把額度用光
    const before = img.srcHistory.length;
    globalThis.window._fire('online');
    assert.ok(img.srcHistory.length > before, '額度用盡後，網路恢復仍應該再試');
  });
  ok('1-17 放大檢視可指定較大的代理寬度（縮圖太小會糊）', () => {
    installFakeEnv();
    const zoom = makeImg();
    const hh = retryImg(zoom, { url: CDN, width: 840 });
    zoom._fire('error'); runPending();
    zoom._fire('error'); runPending();
    assert.ok(zoom.srcHistory.at(-1).includes('&w=840'), zoom.srcHistory.at(-1));
    hh.destroy();
  });
  h.destroy();
}

console.log('② 靜態端：全站卡圖都要掛 use:retryImg');
const FILES = [
  'src/routes/game/+page.svelte',
  'src/routes/game/MobilePortraitBattle.svelte',
  'src/routes/decks/+page.svelte',
  'src/routes/cards/+page.svelte',
  'src/routes/card/[id]/+page.svelte',
];
/**
 * ⭐ 判準是**白名單豁免制**，不是「src 綁到 …imageUrl 才算卡圖」。
 * 理由（Fable 覆核時實際抓到的漏洞）：放大檢視的全螢幕圖 src 綁的是中介變數
 * （`lightboxUrl` / `lightbox`），用 imageUrl 當判準會整批掃不到 —— 而那是尺寸最大、
 * 最容易載入失敗的一張。所以改成「**任何動態 src 的 <img> 都要掛**，例外逐條列出」。
 */
const EXEMPT = [
  'coverUrl(',   // 卡包封面：站內 /covers/ 圖，由 Service Worker 快取，不走官網 CDN
];
/**
 * 取出所有 <img …> 標籤。
 * ⚠ 不能用 /<img[^>]*>/ ：屬性表達式裡有箭頭函式（onclick={()=>…}）與比較運算，
 *   那些 '>' 會讓 tag 被提早切斷，導致漏掃（本輪初版就因此漏了 8 個卡圖）。
 *   因此掃描時要對 {} 做深度感知，只有 depth===0 的 '>' 才算標籤結束。
 */
function imgTags(s) {
  const out = [];
  for (let i = s.indexOf('<img'); i >= 0; i = s.indexOf('<img', i + 1)) {
    let j = i + 4, depth = 0;
    for (; j < s.length; j++) {
      const ch = s[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    out.push(s.slice(i, j + 1));
    i = j;
  }
  return out;
}
const dynamicImgs = (src) => imgTags(src).filter((t) => /src=\{/.test(t) && !EXEMPT.some((e) => t.includes(e)));
const scanMissing = (src) => dynamicImgs(src).filter((t) => !t.includes('use:retryImg'));
// 只寫 use:retryImg 不帶參數 ⇒ 節點被重用換卡時 action 不會重跑，會重試到「上一張卡」的圖。
const scanUnparameterised = (src) => dynamicImgs(src).filter((t) => t.includes('use:retryImg') && !t.includes('use:retryImg={'));

for (const f of FILES) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  ok(`2-${f} 所有動態 <img> 都有 use:retryImg`, () => {
    const n = dynamicImgs(src).length;
    assert.ok(n > 0, '掃不到任何動態 <img>，掃描式可能失效（別讓守衛靜默變成永遠綠）');
    const miss = scanMissing(src);
    assert.strictEqual(miss.length, 0, `${miss.length} 個漏掛：\n` + miss.slice(0, 3).join('\n'));
  });
  ok(`2-${f} 每個 use:retryImg 都有傳入目前的網址`, () => {
    const bad = scanUnparameterised(src);
    assert.strictEqual(bad.length, 0, '沒帶參數 → 換卡後會顯示錯誤的圖：\n' + bad.slice(0, 3).join('\n'));
  });
  ok(`2-${f} 有 import retryImg`, () => {
    assert.ok(/import\s*\{[^}]*\bretryImg\b[^}]*\}\s*from\s*'\$lib\/img-retry'/.test(src));
  });
}
ok('2-全站沒有漏網檔案（新頁面加了圖片也必須掛上）', () => {
  const stack = [join(ROOT, 'src/routes'), join(ROOT, 'src/lib')];
  const found = [];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.name.endsWith('.svelte')) {
        const src = readFileSync(full, 'utf8');
        if (dynamicImgs(src).length > 0) found.push(full.slice(ROOT.length).replace(/\\/g, '/'));
      }
    }
  }
  const known = new Set(FILES);
  const extra = found.filter((f) => !known.has(f));
  assert.strictEqual(extra.length, 0, '有動態圖片但不在清單內：' + extra.join(', '));
});
ok('2-正對照：漏掛與沒帶參數的樣本都要被抓出來（證明掃描會失敗）', () => {
  assert.strictEqual(scanMissing('<img src={c.imageUrl} alt=""/>').length, 1);
  assert.strictEqual(scanMissing('<img use:retryImg={c.imageUrl} src={c.imageUrl} alt=""/>').length, 0);
  assert.strictEqual(scanUnparameterised('<img use:retryImg src={c.imageUrl} alt=""/>').length, 1);
  assert.strictEqual(scanUnparameterised('<img use:retryImg={c.imageUrl} src={c.imageUrl} alt=""/>').length, 0);
  // 放大檢視那種「src 綁中介變數」的也必須算數（舊判準會漏掉）
  assert.strictEqual(scanMissing('<img class="lightboxImg" src={lightboxUrl} alt=""/>').length, 1);
});
ok('2-失敗佔位樣式在 layout 以 :global 提供（各頁共用同一份外觀）', () => {
  const lay = readFileSync(join(ROOT, 'src/routes/+layout.svelte'), 'utf8');
  assert.ok(lay.includes(':global(img[data-img-retrying])'), 'layout 少了佔位樣式');
  assert.ok(lay.includes('prefers-reduced-motion'), '缺少減少動態的無障礙處理');
});
ok('2-不得改用卡背圖當佔位（卡背代表未揭曉的牌，會誤導盤面資訊）', () => {
  const s = readFileSync(join(ROOT, 'src/lib/img-retry.ts'), 'utf8');
  assert.ok(!/card[-_]?back|cardback|卡背圖/i.test(s.replace(/⚠[^\n]*卡背[^\n]*/g, '')), '不該引入卡背圖');
});

console.log(`\n=== v6.101 img-retry 守衛：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
