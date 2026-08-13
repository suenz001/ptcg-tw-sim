// v6.183 站台識別（屬性色環 logo）全站替換守衛
//
// 換 logo 這件事的失敗模式全都是「靜默」的：
//   ・拿 512 直接縮放存成 180/192 → 檔案在、尺寸也對，但小尺寸糊掉（肉眼才看得出）
//   ・maskable 忘了換成「淺底 96%」版 → 安裝到桌面時被裁掉一圈
//   ・?v= 忘了 bump → iOS 的 apple-touch-icon 快取極頑固，玩家會一直看到舊 icon
//   ・admin 報告圖落款用的同源副本忘了跟著換 → 發給玩家的圖還是舊識別
// 所以這支守衛**實際把 PNG 解碼出來看像素**，不是只驗檔案存在或字串有出現。
//
// ⚠ 色環判準一律回頭讀 src/lib/cards/energy.ts 的 ENERGY_COLOR（與全站同源），
//   不在本檔硬寫色碼 —— 站台改色票時守衛要跟著動，而不是變成兩份會互相打架的真相。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// ── 最小 PNG 解碼器（8-bit、非交錯、colortype 2/6）────────────────────────
function decodePNG(buf) {
  assert.ok(buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'PNG magic bytes 不對（檔案被當成文字處理過？）');
  let i = 8, ihdr = null, sawIEND = false;
  const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.slice(i + 8, i + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') sawIEND = true;
    i += 12 + len;
  }
  assert.ok(ihdr, '沒有 IHDR');
  assert.ok(sawIEND, '沒有 IEND —— 檔案被截斷了');
  assert.strictEqual(ihdr.depth, 8, '只支援 8-bit');
  assert.strictEqual(ihdr.interlace, 0, '只支援非交錯');
  const ch = ihdr.color === 6 ? 4 : ihdr.color === 2 ? 3 : 0;
  assert.ok(ch, 'colortype ' + ihdr.color + ' 不支援');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * ch;
  const out = Buffer.alloc(ihdr.h * stride);
  let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[pos++];
    const line = Buffer.from(raw.slice(pos, pos + stride)); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride); prev = line;
  }
  const px = (x, y) => { const o = (y * ihdr.w + x) * ch; return [out[o], out[o + 1], out[o + 2]]; };
  const polar = (r, deg) => {
    const k = ihdr.w / 512, a = deg * Math.PI / 180;
    return px(Math.round(ihdr.w / 2 + r * k * Math.sin(a)), Math.round(ihdr.h / 2 - r * k * Math.cos(a)));
  };
  return { w: ihdr.w, h: ihdr.h, px, polar };
}
const read = (rel) => readFileSync(join(ROOT, rel));
const img = (rel) => decodePNG(read(rel));
const md5 = (rel) => createHash('md5').update(read(rel)).digest('hex');
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// 光澤層＝與白／黑做線性混合 → 會改變明暗但**不改變彩度比例**；
// 正規化成 (c-min)/(max-min) 之後就與光澤無關，可以直接跟原始色票比對。
const chroma = (c) => {
  const m = Math.min(...c), M = Math.max(...c);
  return M - m < 10 ? null : c.map((v) => (v - m) / (M - m));   // null = 灰（鋼）
};

// ── ⓪ 解碼器自我驗證（掃描器自身要先驗）──────────────────────────────────
T('⓪ PNG 解碼器自我驗證：合成一張已知像素的 PNG，解出來要一模一樣', () => {
  const W = 3, H = 2;
  const want = [[10, 20, 30], [200, 100, 50], [0, 255, 128], [255, 255, 255], [1, 2, 3], [7, 8, 9]];
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;                                   // filter type 0
    for (let x = 0; x < W; x++) {
      const c = want[y * W + x];
      for (let k = 0; k < 3; k++) raw[y * (1 + W * 3) + 1 + x * 3 + k] = c[k];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    // CRC 本解碼器不驗，補 4 bytes 佔位
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  const d = decodePNG(png);
  assert.strictEqual(d.w, W); assert.strictEqual(d.h, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    assert.deepStrictEqual(d.px(x, y), want[y * W + x],
      '像素 (' + x + ',' + y + ') 解錯 —— 解碼器壞了，下面所有像素判斷都不可信');
  }
  // 正對照：解碼器真的會擋下壞檔（不是永遠回 OK）
  assert.throws(() => decodePNG(Buffer.from('not a png at all!!')), /magic bytes/,
    '壞檔沒有被擋下 —— 這支守衛等於沒作用');
});

// ── 色票同源：從 energy.ts 讀 ENERGY_COLOR ────────────────────────────────
const ENERGY_TS = readFileSync(join(ROOT, 'src/lib/cards/energy.ts'), 'utf8');
const ENERGY_COLOR = Object.fromEntries(
  [...ENERGY_TS.slice(ENERGY_TS.indexOf('ENERGY_COLOR')).matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]]));
// 12 點鐘起順時針：草火水雷超鬥惡鋼（⚠ 無妖 —— H/I/J 標妖屬性已完全退場）
const RING_ORDER = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const RING = RING_ORDER.map((k) => ENERGY_COLOR[k]);
const LIGHT = [245, 243, 236];      // 淺底 #f5f3ec
const CARD_NAVY = [35, 43, 88];     // 中央卡面 #232b58
const NAVY = [14, 19, 48];          // 深底 #0e1330

T('① 色票同源：ENERGY_COLOR 讀得到、8 段都有值，且色環不含「妖」', () => {
  assert.ok(Object.keys(ENERGY_COLOR).length >= 8,
    'energy.ts 的 ENERGY_COLOR 沒解析到（格式改了？）：' + JSON.stringify(ENERGY_COLOR));
  RING_ORDER.forEach((k, i) => assert.ok(/^#[0-9a-f]{6}$/.test(RING[i] || ''), k + ' 沒有色碼'));
  assert.ok(!RING_ORDER.includes('Fairy'), '妖屬性在 H/I/J 標已完全退場，不得入色環');
  assert.ok(ENERGY_COLOR.Fairy, '正對照：energy.ts 本來就有 Fairy 這一筆（代表解析沒壞），只是不入環');
});

// ── 五顆 icon ────────────────────────────────────────────────────────────
const ICONS = [
  ['static/icons/icon-32.png', 32],
  ['static/icons/icon-180.png', 180],
  ['static/icons/icon-192.png', 192],
  ['static/icons/icon-512.png', 512],
  ['static/icons/icon-512-maskable.png', 512],
];
T('② 五顆 icon 的實際 PNG 寬高正確（讀 IHDR，不是看檔名）', () => {
  for (const [rel, size] of ICONS) {
    assert.ok(existsSync(join(ROOT, rel)), rel + ' 不存在');
    const d = img(rel);
    assert.strictEqual(d.w, size, rel + ' 寬 ' + d.w + '，應為 ' + size);
    assert.strictEqual(d.h, size, rel + ' 高 ' + d.h + '，應為 ' + size);
  }
});
T('③ 五顆 icon 不是同一個檔複製五份（每顆內容都不同）', () => {
  const seen = new Map();
  for (const [rel] of ICONS) {
    const h = md5(rel);
    assert.ok(!seen.has(h), rel + ' 與 ' + seen.get(h) + ' 位元完全相同 —— 每個尺寸都要由母檔重新光柵化');
    seen.set(h, rel);
  }
});
T('④ 五顆 icon 都是屬性色環識別：8 段順序＝草火水雷超鬥惡鋼、底色為淺底', () => {
  for (const [rel] of ICONS) {
    const d = img(rel);
    assert.ok(dist(d.px(1, 1), LIGHT) < 12, rel + ' 角落底色 ' + d.px(1, 1) + ' 不是淺底 #f5f3ec');
    const r = rel.endsWith('icon-32.png') ? 164 : 176;   // 簡化版的環較粗，取環內半徑
    for (let i = 0; i < 8; i++) {
      const got = d.polar(r, i * 45 + 22.5);
      const gc = chroma(got), want = chroma(hex2rgb(RING[i]));
      if (!want) { assert.strictEqual(gc, null, rel + ' 第 ' + (i + 1) + ' 段（鋼）應為灰色，實際 ' + got); continue; }
      assert.ok(gc, rel + ' 第 ' + (i + 1) + ' 段是灰的，應為 ' + RING[i] + '，實際 ' + got);
      let best = -1, bd = Infinity;
      RING.forEach((hexv, j) => {
        const w = chroma(hex2rgb(hexv)); if (!w) return;
        const dd = Math.hypot(gc[0] - w[0], gc[1] - w[1], gc[2] - w[2]);
        if (dd < bd) { bd = dd; best = j; }
      });
      assert.strictEqual(best, i, rel + ' 第 ' + (i + 1) + ' 段（順時針從 12 點起算）像素 ' + got
        + ' 最接近 ' + RING_ORDER[best] + '，但該位置應該是 ' + RING_ORDER[i]);
      assert.ok(bd < 0.25, rel + ' 第 ' + (i + 1) + ' 段偏離色票太多（' + bd.toFixed(2) + '）');
    }
  }
});
T('⑤ 中央是金框深藍卡（不是舊識別的紅白配色）', () => {
  for (const [rel, size] of ICONS) {
    if (size < 100) continue;                       // 32px 太小，由 ⑦ 另外驗
    const d = img(rel);
    const p = d.px(Math.round(d.w / 2), Math.round(d.h / 2 + d.h * 0.13));
    assert.ok(dist(p, CARD_NAVY) < 20, rel + ' 卡面中央 ' + p + ' 不是深藍 #232b58');
  }
});
T('⑥ icon-512-maskable 是淺底 96% 版（內容縮進安全圓），且與 icon-512 構圖不同', () => {
  const m = img('static/icons/icon-512-maskable.png');
  const f = img('static/icons/icon-512.png');
  assert.ok(dist(m.polar(195, 22.5), LIGHT) > 40, 'maskable 在 r=195 應該還在色環上，實際 ' + m.polar(195, 22.5));
  assert.ok(dist(m.polar(204, 22.5), LIGHT) < 12,
    'maskable 在 r=204 應該已是底色（內容縮到 96%）—— 實際 ' + m.polar(204, 22.5) + '，像是直接拿完整版當 maskable');
  assert.ok(dist(f.polar(204, 22.5), LIGHT) > 40,
    'icon-512（非 maskable）在 r=204 應該還是色環 —— 兩顆構圖一樣就是換錯檔');
  assert.ok(dist(m.px(1, 1), LIGHT) < 12, 'maskable 必須用淺底版（深藍備用版 #1a2150 不是正式版）');
});
T('⑦ icon-32 用簡化版構圖（無光澤、環更粗），不是把 512 縮下來', () => {
  const s = img('static/icons/icon-32.png');
  for (let i = 0; i < 8; i++) {
    const got = s.polar(164, i * 45 + 22.5);
    assert.ok(dist(got, hex2rgb(RING[i])) < 16,
      '32px 第 ' + (i + 1) + ' 段 ' + got + ' 與原始色票 ' + RING[i] + ' 差太多 —— 簡化版沒有光澤層應該接近原色；'
      + '完整版縮圖會被光澤洗淡');
  }
  const inner = s.polar(132, 22.5);   // 簡化版內半徑 120（完整版 144）→ r=132 仍在環上
  assert.ok(dist(inner, LIGHT) > 30, '32px 在 r=132 應該還在（較粗的）環上，實際 ' + inner + ' 是底色 —— 用到完整版構圖了');
});
T('⑧ 五顆 icon 與 logo-final 產生器輸出位元相同（重跑 gen_logo.py 就能重現）', () => {
  for (const [rel] of ICONS) {
    const src = 'logo-final/site-icons/' + rel.split('/').pop();
    assert.ok(existsSync(join(ROOT, src)), src + ' 不存在 —— 產生器的輸出必須一起進 repo');
    assert.strictEqual(md5(rel), md5(src), rel + ' 與 ' + src + ' 不一致（手工修過圖？改圖請改 gen_logo.py 再重跑）');
  }
  assert.ok(readFileSync(join(ROOT, 'logo-final/gen_logo.py'), 'utf8').includes('site-icons/icon-512-maskable.png'),
    'gen_logo.py 必須含產生 site-icons/ 五顆的 render 行');
});

// ── 快取三層第一層：?v= 一定要 bump ───────────────────────────────────────
const MIN_V = 6.183;                 // 換上屬性色環識別的版本；只能往上，不可退回
const APP = readFileSync(join(ROOT, 'src/app.html'), 'utf8');
const MANIFEST_RAW = readFileSync(join(ROOT, 'static/manifest.json'), 'utf8');
T('⑨ app.html 的 icon/manifest/splash ?v= 全部 ≥ ' + MIN_V + ' 且一致（iOS 對 apple-touch-icon 的快取極頑固）', () => {
  const vs = [...APP.matchAll(/(?:icons\/[\w-]+\.png|manifest\.json)\?v=([\d.]+)/g)].map((m) => m[1]);
  assert.ok(vs.length >= 6, 'app.html 應有 6 處帶 ?v= 的 icon/manifest 連結，實際 ' + vs.length);
  for (const v of vs) assert.ok(parseFloat(v) >= MIN_V, '?v=' + v + ' 沒有 bump（舊 icon 會被快取到天荒地老）');
  assert.strictEqual(new Set(vs).size, 1, 'app.html 內的 ?v= 不一致：' + [...new Set(vs)].join(' / '));
});
T('⑩ manifest.json：三個 icon 都指得到實際存在的檔案、?v= 已 bump、maskable 條目正確', () => {
  const mf = JSON.parse(MANIFEST_RAW);
  assert.strictEqual(mf.icons.length, 3, 'manifest 應有 3 個 icon 條目');
  for (const ic of mf.icons) {
    const [path, q] = ic.src.split('?v=');
    assert.ok(existsSync(join(ROOT, 'static', path)), 'manifest 指到不存在的檔案：' + ic.src);
    const d = img('static/' + path);
    const [w] = ic.sizes.split('x').map(Number);
    assert.strictEqual(d.w, w, ic.src + ' 宣告 ' + ic.sizes + '，實際 ' + d.w + 'x' + d.h);
    assert.ok(q && parseFloat(q) >= MIN_V, ic.src + ' 的 ?v= 沒有 bump');
  }
  const mk = mf.icons.find((i) => i.purpose === 'maskable');
  assert.ok(mk && mk.src.startsWith('icons/icon-512-maskable.png'), 'maskable 條目必須指向 icon-512-maskable.png');
  const anyV = [...MANIFEST_RAW.matchAll(/\?v=([\d.]+)/g)].map((m) => m[1]);
  const appV = (APP.match(/icons\/icon-192\.png\?v=([\d.]+)/) || [])[1];
  assert.ok(anyV.length === 3 && anyV.every((v) => v === appV),
    'manifest 與 app.html 的 ?v= 應一致（' + anyV.join('/') + ' vs ' + appV + '）');
});

// ── 分享圖／報告圖落款 ────────────────────────────────────────────────────
T('⑪ og-image 是 1200×630、且已換成新識別（底部 8 色條＝ENERGY_COLOR）', () => {
  const d = img('static/og-image.png');
  assert.strictEqual(d.w, 1200, 'og-image 寬應為 1200，實際 ' + d.w);
  assert.strictEqual(d.h, 630, 'og-image 高應為 630，實際 ' + d.h);
  for (let i = 0; i < 8; i++) {
    const got = d.px(Math.round((i + 0.5) * d.w / 8), 622);
    assert.ok(dist(got, hex2rgb(RING[i])) < 12,
      'og-image 底部色條第 ' + (i + 1) + ' 段 ' + got + ' 應為 ' + RING[i] + '（' + RING_ORDER[i] + '）');
  }
});
T('⑫ admin 報告圖落款的 site-icon-192 就是主站 icon-192 的同源副本（要一起換）', () => {
  assert.strictEqual(md5('oracle-admin/icons/site-icon-192.png'), md5('static/icons/icon-192.png'),
    'oracle-admin/icons/site-icon-192.png 沒有跟著換 —— 發給玩家的報告圖落款會還是舊 logo');
  const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  const v = (adm.match(/icons\/site-icon-192\.png\?v=([\d.]+)/) || [])[1];
  assert.ok(v && parseFloat(v) >= 1.66,
    'admin.html 的 site-icon-192 ?v= 沒有 bump（實際 ' + v + '）—— 後台會用到快取的舊 icon');
});
T('⑬ admin 自身的紫色 ADMIN favicon 不得被改成主站 logo（兩者無關）', () => {
  const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  const head = adm.slice(0, adm.indexOf('</head>'));
  const links = [...head.matchAll(/<link[^>]*rel="(?:apple-touch-)?icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 4, 'admin.html 的 favicon 連結應有 4 條，實際 ' + links.length);
  for (const h of links) {
    assert.ok(/^icons\/icon-(32|180|192|512)\.png\?v=/.test(h),
      'admin 的分頁 icon 應該還是自己那組紫色 ADMIN 圖（icons/icon-*.png），實際 ' + h
      + ' —— 後台分頁要能跟主站一眼分開，不要「順手統一」');
    assert.ok(!h.includes('site-icon'), 'admin favicon 不該改用主站的同源副本 site-icon-192.png：' + h);
  }
});
T('⑭ logo-final 的 YouTube 縮圖（底圖＋範例）都是新識別：1280×720、深底、底部 8 色條', () => {
  // ⚠ repo 根目錄那張 YouTube縮圖_1280x720.png **沒有被 git 追蹤**（站長本機的行銷素材），
  //   所以這裡驗的是進 repo 的 logo-final 版本；根目錄那張若存在，必須就是其中一張。
  for (const rel of ['logo-final/youtube-thumb-base-1280x720.png', 'logo-final/youtube-thumb-1280x720.png']) {
    assert.ok(existsSync(join(ROOT, rel)), rel + ' 不存在');
    const d = img(rel);
    assert.strictEqual(d.w, 1280, rel + ' 寬應為 1280'); assert.strictEqual(d.h, 720, rel + ' 高應為 720');
    assert.ok(dist(d.px(2, 2), NAVY) < 12, rel + ' 底色應為深底 #0e1330，實際 ' + d.px(2, 2));
    for (let i = 0; i < 8; i++) {
      const got = d.px(Math.round((i + 0.5) * d.w / 8), 710);
      assert.ok(dist(got, hex2rgb(RING[i])) < 12,
        rel + ' 底部色條第 ' + (i + 1) + ' 段 ' + got + ' 應為 ' + RING[i]);
    }
  }
  const root = join(ROOT, 'YouTube縮圖_1280x720.png');
  if (existsSync(root)) {
    const h = createHash('md5').update(readFileSync(root)).digest('hex');
    assert.ok([md5('logo-final/youtube-thumb-1280x720.png'), md5('logo-final/youtube-thumb-base-1280x720.png')].includes(h),
      '根目錄的 YouTube縮圖_1280x720.png 還是舊識別 —— 請用 logo-final 的新縮圖覆蓋（或以底圖在 Canva 疊字）');
  }
});
T('⑮ 換過的 PNG 都通過完整性檢查（magic bytes／IEND／整條 zlib 解得開）', () => {
  const all = [...ICONS.map((i) => i[0]), 'static/og-image.png', 'oracle-admin/icons/site-icon-192.png',
    'logo-final/youtube-thumb-1280x720.png'];
  for (const rel of all) {
    const buf = read(rel);
    assert.strictEqual(statSync(join(ROOT, rel)).size, buf.length, rel + ' 大小對不上');
    assert.strictEqual(buf.toString('ascii', buf.length - 8, buf.length - 4), 'IEND',
      rel + ' 結尾不是 IEND —— 檔案被截斷或被文字處理改寫過');
    const d = decodePNG(buf);   // 解得開＝IDAT 的 zlib 流完整
    assert.ok(d.w > 0 && d.h > 0, rel + ' 尺寸異常');
  }
});

console.log('\n=== v6.183 站台識別替換守衛: ' + pass + ' PASS, ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
