#!/usr/bin/env python3
"""
新卡包工具組 ③：把每張卡的「規則標記」與「階段」從官方卡圖裁出來拼成對照圖，人工逐格核對。

由來（鐵律 Rule 90、站長 2026-11-01）：
  「只有h i j標要收 收之前，先確認是不是h i j標！ 這是最基本的」
  官網 detail 頁的欄位不可盡信——舊商品重印的標記會被標成現行可用的 I／J（阿球、觀光客、SVI 訓練家實印 G）、
  階段（超能豔鴕 11317 實為 1 階進化）也錯過 ⇒ 收錄前一律看卡圖。

什麼時候要跑（站長 2026-11-07）：
  「卡圖對照圖 如果是波導探求者這類擴充包的新卡，就不用比對版本了，避免浪費ai token，一定都是J標不會錯，
   比較需要比對的是舊卡或是戰術牌組那種混了很多標的卡在一起的才有需要比對」
  ⇒ 全新擴充包**不跑**；舊卡補漏、重印、戰術牌組等混標商品才跑，而且用 --only-ids 只拼要看的那幾張。

用法：
  python3 scripts/new-set/mark-montage.py <卡表或暫存.json> <輸出資料夾> [--per-page 24] [--only-ids 1,2,3]
  例：python3 scripts/new-set/mark-montage.py .new-set/M7/M7.json .new-set/M7/montage

每一格：上半＝卡圖左上（階段字樣、卡名），下半＝卡圖左下（規則標記、卡包代號、收錄編號）；
  格子上方印「id／卡名／資料寫的標記／資料寫的階段」——圖上印的和資料寫的不一樣，就是官網欄位錯了。
⚠ 只讀卡圖網址（官方 CDN），不改任何檔案；下載失敗的卡會列在 _failed.txt，不會默默略過。
"""
import io
import json
import os
import sys
import time
import urllib.request

from PIL import Image, ImageDraw, ImageFont

STAGE_ZH = {'Basic': '基礎', 'Stage1': '1階', 'Stage2': '2階'}
FONT_CANDIDATES = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc',
    'C:/Windows/Fonts/msjh.ttc',
    'C:/Windows/Fonts/msjhbd.ttc',
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def fetch(url, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'PTCG-TW-Sim mark montage'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # 官網偶發 502：退避重試
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def crops(img):
    """回傳（左上階段區, 左下標記區）。比例以官方 868×1212 卡圖量出，其他尺寸等比例套用。"""
    w, h = img.size
    top = img.crop((0, 0, int(w * 0.62), int(h * 0.075)))
    bottom = img.crop((0, int(h * 0.915), int(w * 0.46), int(h * 0.975)))
    return top, bottom


def main(argv):
    if len(argv) < 3 or argv[1] in ('-h', '--help'):
        print(__doc__)
        return 1
    src, outdir = argv[1], argv[2]
    per_page = 24
    only = None
    i = 3
    while i < len(argv):
        if argv[i] == '--per-page':
            per_page = int(argv[i + 1]); i += 2
        elif argv[i] == '--only-ids':
            only = set(argv[i + 1].split(',')); i += 2
        else:
            raise SystemExit('未知參數：' + argv[i])
    cards = json.load(open(src, encoding='utf-8'))
    seen, todo = set(), []
    for c in cards:
        url = c.get('imageUrl')
        cid = str(c.get('id'))
        if not url or url in seen:   # 兩張合一的右半共用同一張圖，只看一次
            continue
        if only and cid not in only:
            continue
        seen.add(url)
        todo.append(c)
    os.makedirs(outdir, exist_ok=True)
    font = load_font(22)
    cell_w, top_h, bot_h, label_h = 560, 92, 74, 34
    cols = 3
    failed, page, cells = [], 1, []

    def flush():
        nonlocal page, cells
        if not cells:
            return
        rows = (len(cells) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * cell_w, rows * (label_h + top_h + bot_h + 10)), 'white')
        for k, cell in enumerate(cells):
            x, y = (k % cols) * cell_w, (k // cols) * (label_h + top_h + bot_h + 10)
            sheet.paste(cell, (x, y))
        path = os.path.join(outdir, f'marks-{page:02d}.png')
        sheet.save(path)
        print('寫出', path, f'（{len(cells)} 張）')
        page += 1
        cells = []

    for n, c in enumerate(todo, 1):
        try:
            img = Image.open(io.BytesIO(fetch(c['imageUrl']))).convert('RGB')
        except Exception as e:
            failed.append(f"{c.get('id')}\t{c.get('name')}\t{e}")
            continue
        top, bottom = crops(img)
        top = top.resize((cell_w - 10, top_h))
        bottom = bottom.resize((cell_w - 10, bot_h))
        cell = Image.new('RGB', (cell_w, label_h + top_h + bot_h + 10), 'white')
        d = ImageDraw.Draw(cell)
        stage = STAGE_ZH.get(c.get('stage') or c.get('subtype'), c.get('subtype') or '')
        label = f"{c.get('id')} {c.get('name')}｜資料：{c.get('regulationMark') or '無'}標 {stage}"
        d.text((6, 4), label[:34], fill='black', font=font)
        cell.paste(top, (5, label_h))
        cell.paste(bottom, (5, label_h + top_h + 4))
        d.rectangle((0, 0, cell_w - 1, label_h + top_h + bot_h + 9), outline='#999')
        cells.append(cell)
        if len(cells) >= per_page:
            flush()
        time.sleep(0.25)
    flush()
    if failed:
        with open(os.path.join(outdir, '_failed.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(failed) + '\n')
        print(f'⚠ {len(failed)} 張卡圖下載失敗，見 _failed.txt（這幾張還沒核對過）')
    print(f'完成：{len(todo) - len(failed)} 張')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
