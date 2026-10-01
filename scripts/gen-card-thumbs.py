#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v6.464 卡圖縮圖產生器：官方 PNG（868×1212、平均 427KB）→ 450px 寬 WebP（q80、平均約 53KB）

用途：產生／補齊卡圖縮圖 repo（suenz001/ptcg-tw-sim-img，GitHub Pages）。
  前端 src/lib/cards/thumb.ts 的 cardThumb() 把官方網址換成
  https://suenz001.github.io/ptcg-tw-sim-img/w450/<檔名>.webp；
  縮圖不存在（例如新卡還沒跑本腳本）時，img-retry.ts 會**立刻**退回官方原圖 ⇒ 最壞＝跟以前一樣。

⚠ 只處理 asia.pokemon-card.com 的 /tw/ 與 /hk/ card-img（cardThumb() 只轉換這兩種，兩邊判準必須一致：
  test-v6464-card-thumbs 會逐字比對 THUMB_RE 與 thumb.ts 的正規式）。
⚠ 冪等：已存在的縮圖不重抓（補新卡包時只會下載新卡）。--force 才會全部重做。
⚠ 失敗清單寫在 <out>/_failed.txt；重跑會自動補抓。

用法（站長電腦，在 E:\\ptcg-tw-sim 底下）：
  python scripts/gen-card-thumbs.py --out E:\\ptcg-tw-sim-img
  然後在 E:\\ptcg-tw-sim-img：git add -A && git commit -m "補縮圖" && git push
"""
import argparse, glob, io, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

# 與 src/lib/cards/thumb.ts 的 THUMB_RE 必須一致（守衛逐字比對）
THUMB_RE = r'^https://asia\.pokemon-card\.com/(tw|hk)/card-img/((?:tw|hk)\d+)\.png$'
WIDTH = 450
QUALITY = 80
SUBDIR = 'w450'

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def collect_urls():
    """從 static/cards/*.json 收集所有可轉換的卡圖網址（去重）。"""
    urls = {}
    for f in sorted(glob.glob(os.path.join(ROOT, 'static', 'cards', '*.json'))):
        if os.path.basename(f) == 'index.json':
            continue
        try:
            data = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        for c in data:
            u = (c or {}).get('imageUrl') or ''
            m = re.match(THUMB_RE, u)
            if m:
                urls[m.group(2)] = u
    return urls


def make_one(name, url, out_dir, force):
    dst = os.path.join(out_dir, SUBDIR, name + '.webp')
    if os.path.exists(dst) and not force:
        return name, 'skip', 0
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'ptcg-tw-sim-thumb/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
            im = Image.open(io.BytesIO(raw))
            im = im.convert('RGBA') if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB')
            h = round(WIDTH * im.size[1] / im.size[0])
            im = im.resize((WIDTH, h), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, 'WEBP', quality=QUALITY, method=6)
            tmp = dst + '.tmp'
            with open(tmp, 'wb') as fh:
                fh.write(buf.getvalue())
            os.replace(tmp, dst)          # 原子寫入：中斷不會留下半個檔
            return name, 'ok', buf.tell()
        except Exception as e:  # 網路抖動：退避重試
            last = e
            time.sleep(1.5 * (attempt + 1))
    return name, 'fail:' + str(last)[:120], 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, help='縮圖 repo 的本機路徑（例如 E:\\ptcg-tw-sim-img）')
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--limit', type=int, default=0, help='只做前 N 張（試跑用）')
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, SUBDIR), exist_ok=True)
    # GitHub Pages 預設跑 Jekyll；純靜態圖檔不需要，關掉省建置時間
    open(os.path.join(a.out, '.nojekyll'), 'a').close()
    urls = collect_urls()
    items = sorted(urls.items())
    if a.limit:
        items = items[:a.limit]
    t0 = time.time()
    done = ok = skip = 0
    total_bytes = 0
    failed = []
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(make_one, n, u, a.out, a.force) for n, u in items]
        for f in as_completed(futs):
            n, st, b = f.result()
            done += 1
            if st == 'ok':
                ok += 1; total_bytes += b
            elif st == 'skip':
                skip += 1
            else:
                failed.append(n + '\t' + st)
            if done % 200 == 0 or done == len(items):
                print(f'[{done}/{len(items)}] 新增 {ok}、已存在 {skip}、失敗 {len(failed)}、{time.time() - t0:.0f}s', flush=True)
    with open(os.path.join(a.out, '_failed.txt'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(failed))
    print(f'完成：新增 {ok}（{total_bytes / 1e6:.1f}MB）、已存在 {skip}、失敗 {len(failed)}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
