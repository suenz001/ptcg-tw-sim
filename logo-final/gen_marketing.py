# -*- coding: utf-8 -*-
"""
PTCG TW SIM 行銷素材產生器：og-image / YouTube 縮圖 / maskable 裁切模擬
- 依賴 gen_logo.py（同資料夾）；用法：python3 gen_marketing.py
- 文案若要改，直接改本檔頂部 TEXTS 再重跑
"""
import base64, io, os
import cairosvg
from gen_logo import full_svg, RING, NAVY, LIGHT, CARD_NAVY, OUT

FONT = "Noto Sans CJK TC"
GOLD = "#e0b23f"; GOLD_HI = "#ffd76a"

TEXTS = {
    "site":    "PTCG 實體賽事演練",
    "tagline": "寶可夢集換式卡牌 線上對戰模擬器",
    "chips":   ["免安裝", "即開即戰", "H / I / J 標環境"],
    "url":     "www.ptcg-tw-sim.com",
    # YouTube 縮圖範例標題（每週可換；base 版沒有這兩行）
    "yt_line1": "本週環境報告",
    "yt_line2": "TOP 牌組・勝率解析",
}

def _png_data_uri(svg, size):
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return "data:image/png;base64," + base64.b64encode(png).decode()

def _file_data_uri(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()

def render_wh(svg, name, w, h):
    cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, name),
                     output_width=w, output_height=h)
    print("PNG ", name)

def color_bar(y, h, w_total):
    seg = w_total / 8.0
    return "\n".join(
        f'<rect x="{i*seg:.1f}" y="{y}" width="{seg+1:.1f}" height="{h}" fill="{hexv}"/>'
        for i, (_, _, hexv) in enumerate(RING))

# ---------- 1) maskable 裁切模擬 ----------
def crop_sim():
    uri = _file_data_uri(os.path.join(OUT, "logo-maskable-light-512.png"))
    R_SAFE = 204.8   # W3C 最小安全圓半徑（40% × 512）
    RX = 102         # 圓角方形 rx=20%
    tiles = []
    labels = ["正方形（不裁）", "圓角方形裁切 rx=20%", "圓形裁切（80% 安全圓＝最嚴）"]
    clips = [None,
             f'<rect x="0" y="0" width="512" height="512" rx="{RX}"/>',
             f'<circle cx="256" cy="256" r="{R_SAFE}"/>']
    outlines = [None,
                f'<rect x="0" y="0" width="512" height="512" rx="{RX}" fill="none" stroke="#c33" stroke-width="3" stroke-dasharray="12 8"/>',
                f'<circle cx="256" cy="256" r="{R_SAFE}" fill="none" stroke="#c33" stroke-width="3" stroke-dasharray="12 8"/>']
    body = []
    defs = []
    for i, (lab, clip, outline) in enumerate(zip(labels, clips, outlines)):
        x = 40 + i * 552
        g = [f'<g transform="translate({x},90)">']
        # 被裁掉的部分以 25% 淡化墊底顯示
        g.append(f'<image x="0" y="0" width="512" height="512" xlink:href="{uri}" opacity=".25"/>')
        if clip:
            defs.append(f'<clipPath id="c{i}">{clip}</clipPath>')
            g.append(f'<g clip-path="url(#c{i})"><image x="0" y="0" width="512" height="512" xlink:href="{uri}"/></g>')
            g.append(outline)
        else:
            g.append(f'<image x="0" y="0" width="512" height="512" xlink:href="{uri}"/>')
        g.append(f'<text x="256" y="560" text-anchor="middle" font-family="{FONT}" font-size="30" fill="#20243a">{lab}</text>')
        g.append('</g>')
        body.append("\n".join(g))
    # 第二列：圓形裁切縮到啟動器實際尺寸
    small = ['<g transform="translate(40,760)">',
             f'<text x="0" y="0" font-family="{FONT}" font-size="30" fill="#20243a">圓形裁切縮小檢視（啟動器實際大小）：</text>']
    defs.append(f'<clipPath id="csm"><circle cx="256" cy="256" r="{R_SAFE}"/></clipPath>')
    xoff = 560
    for s in (96, 72, 48):
        k = s / 512.0
        small.append(f'<g transform="translate({xoff},{40 - s}) "><g transform="scale({k})">'
                     f'<g clip-path="url(#csm)"><image x="0" y="0" width="512" height="512" xlink:href="{uri}"/></g></g>'
                     f'<text x="{s/2}" y="{s+34}" text-anchor="middle" font-family="{FONT}" font-size="24" fill="#20243a">{s}px</text></g>')
        xoff += s + 90
    small.append('</g>')
    svg = (f'<svg viewBox="0 0 1688 900" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
           f'<defs>{"".join(defs)}</defs>'
           f'<rect width="1688" height="900" fill="#dcdfe8"/>'
           f'<text x="40" y="56" font-family="{FONT}" font-size="34" font-weight="700" fill="#10142c">maskable 淺底（內容比例 96%）三種裁切模擬 — 紅虛線＝裁切邊界</text>'
           + "".join(body) + "".join(small) + '</svg>')
    render_wh(svg, "maskable-crop-sim.png", 1688, 900)

# ---------- 2) og-image 1200x630 ----------
def og_image():
    logo = _png_data_uri(full_svg(), 880)   # 透明底完整版（淺底用）
    T = TEXTS
    chips_svg = []
    x = 560
    for label in T["chips"]:
        n_cjk = sum(1 for ch in label if ord(ch) > 0x2e7f)
        n_lat = len(label) - n_cjk
        w = int(n_cjk * 27 + n_lat * 14 + 44)
        chips_svg.append(
            f'<rect x="{x}" y="408" width="{w}" height="54" rx="27" fill="{CARD_NAVY}"/>'
            f'<text x="{x + w/2}" y="445" text-anchor="middle" font-family="{FONT}" font-size="27" fill="#f5f3ec">{label}</text>')
        x += w + 18
    svg = f'''<svg viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<rect width="1200" height="630" fill="{LIGHT}"/>
<image x="66" y="88" width="440" height="440" xlink:href="{logo}"/>
<text x="560" y="252" font-family="{FONT}" font-size="68" font-weight="700" fill="{NAVY}">{T["site"]}</text>
<rect x="564" y="286" width="150" height="7" rx="3.5" fill="{GOLD}"/>
<text x="560" y="362" font-family="{FONT}" font-size="39" fill="{CARD_NAVY}">{T["tagline"]}</text>
{''.join(chips_svg)}
<text x="560" y="560" font-family="{FONT}" font-size="27" fill="#6b6f8a">{T["url"]}</text>
{color_bar(614, 16, 1200)}
</svg>'''
    render_wh(svg, "og-image-1200x630.png", 1200, 630)
    render_wh(svg, "_checks/og-image-600x315.png", 600, 315)

# ---------- 3) YouTube 縮圖 1280x720（底圖 + 範例標題版）----------
def yt_thumb():
    logo = _png_data_uri(full_svg(on_dark=True), 960)  # 深底用版本（亮分隔線）
    T = TEXTS
    base_body = f'''<rect width="1280" height="720" fill="{NAVY}"/>
<radialGradient id="glow" cx=".5" cy=".5" r=".5">
  <stop offset="0" stop-color="#fffbe8" stop-opacity=".14"/><stop offset="1" stop-color="#fffbe8" stop-opacity="0"/>
</radialGradient>
<circle cx="300" cy="360" r="300" fill="url(#glow)"/>
<image x="55" y="115" width="490" height="490" xlink:href="{logo}"/>
<text x="60" y="76" font-family="{FONT}" font-size="34" font-weight="700" fill="#aeb6e8">{T["site"]}</text>
{color_bar(700, 20, 1280)}'''
    svg_base = (f'<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" '
                f'xmlns:xlink="http://www.w3.org/1999/xlink">{base_body}</svg>')
    render_wh(svg_base, "youtube-thumb-base-1280x720.png", 1280, 720)
    # 範例標題（站長每週換字的位置：x=580~1240, y=140~620 這塊）
    title = f'''<text x="580" y="330" font-family="{FONT}" font-size="108" font-weight="700" fill="#ffffff">{T["yt_line1"]}</text>
<rect x="584" y="362" width="320" height="10" rx="5" fill="{GOLD}"/>
<text x="580" y="490" font-family="{FONT}" font-size="58" font-weight="700" fill="{GOLD_HI}">{T["yt_line2"]}</text>'''
    svg_full = (f'<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" '
                f'xmlns:xlink="http://www.w3.org/1999/xlink">{base_body}{title}</svg>')
    render_wh(svg_full, "youtube-thumb-1280x720.png", 1280, 720)
    render_wh(svg_full, "_checks/youtube-thumb-336x189.png", 336, 189)

if __name__ == "__main__":
    os.makedirs(os.path.join(OUT, "_checks"), exist_ok=True)
    crop_sim(); og_image(); yt_thumb()
    print("done")
