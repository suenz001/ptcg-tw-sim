# -*- coding: utf-8 -*-
"""
PTCG TW SIM 最終 logo（方案 4「屬性色環」定稿）產生器
- 顏色一律沿用站台 src/lib/cards/energy.ts 的 ENERGY_COLOR（全站一致）
- 色環 8 段 = H/I/J 標實際存在「基本能量卡」的 8 屬性：草火水雷超鬥惡鋼
  （含惡、無妖；龍/無色沒有基本能量卡所以不入環）
- 用法：python3 gen_logo.py  （需 cairosvg；輸出 SVG 母檔 + 全部 PNG）
"""
import math, os
import cairosvg

OUT = os.path.dirname(os.path.abspath(__file__))

# === 站台官方配色（src/lib/cards/energy.ts L19-31 ENERGY_COLOR）===
RING = [
    ("Grass",    "草", "#6bb34c"),
    ("Fire",     "火", "#e05a2b"),
    ("Water",    "水", "#4a92d4"),
    ("Lightning","雷", "#e8c423"),
    ("Psychic",  "超", "#9b4ea0"),
    ("Fighting", "鬥", "#a65a2a"),
    ("Darkness", "惡", "#3f3a5c"),
    ("Metal",    "鋼", "#8d8f94"),
]
NAVY  = "#0e1330"   # 深底
DEEP  = "#1a2150"   # PWA maskable 深藍底
LIGHT = "#f5f3ec"   # 淺底
CARD_NAVY = "#232b58"

C = 256.0
def pt(r, deg):
    a = math.radians(deg)
    return (C + r * math.sin(a), C - r * math.cos(a))

def seg_path(i, r_out, r_in, gap_deg):
    a0 = i * 45 + gap_deg
    a1 = (i + 1) * 45 - gap_deg
    x0, y0 = pt(r_out, a0); x1, y1 = pt(r_out, a1)
    x2, y2 = pt(r_in,  a1); x3, y3 = pt(r_in,  a0)
    return (f"M{x0:.1f},{y0:.1f} A{r_out},{r_out} 0 0 1 {x1:.1f},{y1:.1f} "
            f"L{x2:.1f},{y2:.1f} A{r_in},{r_in} 0 0 0 {x3:.1f},{y3:.1f} Z")

def ring_svg(stroke, stroke_op, r_out=208, r_in=144, gap=3.0, sw=2.5):
    return "\n".join(
        f'  <path d="{seg_path(i, r_out, r_in, gap)}" fill="{hexv}" '
        f'stroke="{stroke}" stroke-opacity="{stroke_op}" stroke-width="{sw}"/>'
        for i, (_, _, hexv) in enumerate(RING))

GLOSS = f'''  <path d="M256,48 A208,208 0 1 1 256,464 A208,208 0 1 1 256,48 Z M256,112 A144,144 0 1 0 256,400 A144,144 0 1 0 256,112 Z" fill="url(#gloss)" fill-rule="evenodd"/>
  <circle cx="256" cy="256" r="132" fill="url(#halo)"/>'''

CARD = f'''  <g>
    <rect x="202" y="180" width="118" height="164" rx="12" fill="#000" opacity=".18" transform="translate(6 7)"/>
    <rect x="202" y="180" width="118" height="164" rx="12" fill="url(#gold)"/>
    <rect x="210" y="188" width="102" height="148" rx="8" fill="{CARD_NAVY}"/>
    <path d="M261,208 Q265,254 311,262 Q265,270 261,316 Q257,270 211,262 Q257,254 261,208" fill="#fff"/>
    <path d="M292,204 Q294,216 305,218 Q294,220 292,232 Q290,220 279,218 Q290,216 292,204" fill="#fff" opacity=".85"/>
  </g>'''

DEFS = '''  <defs>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".34"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".04"/>
      <stop offset="1" stop-color="#000" stop-opacity=".20"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe08a"/>
      <stop offset=".5" stop-color="#e0b23f"/>
      <stop offset="1" stop-color="#9f7414"/>
    </linearGradient>
    <radialGradient id="halo" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#fffbe8" stop-opacity=".55"/>
      <stop offset=".6" stop-color="#fffbe8" stop-opacity=".16"/>
      <stop offset="1" stop-color="#fffbe8" stop-opacity="0"/>
    </radialGradient>
  </defs>'''

def full_svg(bg=None, on_dark=False, scale=None):
    """完整版。on_dark=True 改亮分隔線＋外圈亮環（避免惡段沉入深底）。"""
    if on_dark:
        ring = ring_svg("#ffffff", ".38")
        rim  = ('  <circle cx="256" cy="256" r="209.5" fill="none" stroke="#ffffff" stroke-opacity=".28" stroke-width="3"/>\n'
                '  <circle cx="256" cy="256" r="142.5" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="3"/>\n')
    else:
        ring = ring_svg("#0e1330", ".25")
        rim = ""
    body = f"{ring}\n{rim}{GLOSS}\n{CARD}"
    if scale:
        body = f'  <g transform="translate(256,256) scale({scale}) translate(-256,-256)">\n{body}\n  </g>'
    bgrect = f'  <rect width="512" height="512" fill="{bg}"/>\n' if bg else ""
    return (f'<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">\n{DEFS}\n'
            f'{bgrect}{body}\n</svg>\n')

def simple_svg(bg=None, on_dark=False):
    """32px 簡化版：粗環（外208/內120、縫加大）、無光澤無光暈、卡片只留金框＋單一大星。"""
    ring = ring_svg("#ffffff" if on_dark else "#0e1330",
                    ".45" if on_dark else ".3", r_out=208, r_in=120, gap=2.2, sw=6)
    if on_dark:  # 深底 32px：加亮色外/內緣，避免「惡」段沉入深藍底
        ring += ('\n  <circle cx="256" cy="256" r="212" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="7"/>'
                 '\n  <circle cx="256" cy="256" r="116" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="6"/>')
    card = f'''  <rect x="196" y="172" width="120" height="168" rx="14" fill="url(#gold)"/>
  <rect x="208" y="184" width="96" height="144" rx="9" fill="{CARD_NAVY}"/>
  <path d="M256,196 Q262,250 316,256 Q262,262 256,316 Q250,262 196,256 Q250,250 256,196" fill="#fff"/>'''
    bgrect = f'  <rect width="512" height="512" fill="{bg}"/>\n' if bg else ""
    return (f'<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">\n{DEFS}\n'
            f'{bgrect}{ring}\n{card}\n</svg>\n')

def mono_svg(color="currentColor", bg=None):
    """單色版：8 段色環（同色、留縫辨識分段）＋卡框線＋實心星。"""
    ring = "\n".join(
        f'  <path d="{seg_path(i, 208, 152, 3.4)}" fill="{color}"/>' for i in range(8))
    card = f'''  <rect x="200" y="178" width="122" height="168" rx="13" fill="none" stroke="{color}" stroke-width="17"/>
  <path d="M261,206 Q265,254 313,262 Q265,270 261,318 Q257,270 209,262 Q257,254 261,206" fill="{color}"/>'''
    bgrect = f'  <rect width="512" height="512" fill="{bg}"/>\n' if bg else ""
    return (f'<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">\n'
            f'{bgrect}{ring}\n{card}\n</svg>\n')

def render(svg, name, size):
    cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, name),
                     output_width=size, output_height=size)
    print("PNG ", name)

def save(svg, name):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(svg)
    print("SVG ", name)

if __name__ == "__main__":
    # --- SVG 母檔 ---
    save(full_svg(),                    "logo-master.svg")          # 透明底（淺底用）
    save(full_svg(on_dark=True),        "logo-master-ondark.svg")   # 透明底（深底用：亮分隔線）
    save(simple_svg(),                  "logo-simple.svg")
    save(simple_svg(on_dark=True),      "logo-simple-ondark.svg")
    save(mono_svg(),                    "logo-mono.svg")            # currentColor
    # --- 彩色 PNG ---
    render(full_svg(bg=LIGHT),               "logo-512-light.png", 512)
    render(full_svg(bg=NAVY, on_dark=True),  "logo-512-dark.png",  512)
    render(full_svg(),                       "logo-512-transparent.png", 512)
    render(full_svg(bg=LIGHT),               "logo-128-light.png", 128)
    render(full_svg(bg=NAVY, on_dark=True),  "logo-128-dark.png",  128)
    render(simple_svg(bg=LIGHT),             "logo-32-light.png",  32)
    render(simple_svg(bg=NAVY, on_dark=True),"logo-32-dark.png",   32)
    # --- 單色 PNG ---
    render(mono_svg(color="#10142c", bg=LIGHT), "logo-mono-light-512.png", 512)
    render(mono_svg(color="#f5f3ec", bg=NAVY),  "logo-mono-dark-512.png",  512)
    # --- PWA maskable（正式版=淺底；站長指示「盡量放大、別超界」）---
    # 安全區=直徑80%的圓(512px中半徑204.8)。淺底完整版最外緣=色環外緣208+描邊1.25=209.25，
    # 理論上限 scale≈0.978；取 0.96（外緣200.9px，留約4px抗鋸齒緩衝）。
    # 深底版含亮色外環(外緣211)，0.96 時外緣202.6 仍在安全圓內。
    MASK_SCALE = 0.96
    render(full_svg(bg=LIGHT,               scale=MASK_SCALE), "logo-maskable-light-512.png", 512)
    render(full_svg(bg=DEEP,  on_dark=True, scale=MASK_SCALE), "logo-maskable-navy-512.png",  512)
    # --- 全站 icon（直接對應 static/icons/ 的五顆；每顆都由母檔以「目標尺寸」重出，
    #     ⚠ 不可拿 512 縮放存檔：小尺寸要用向量重新光柵化才不糊）---
    os.makedirs(os.path.join(OUT, "site-icons"), exist_ok=True)
    render(simple_svg(bg=LIGHT),            "site-icons/icon-32.png",  32)   # 32px 一律簡化版構圖
    render(full_svg(bg=LIGHT),              "site-icons/icon-180.png", 180)
    render(full_svg(bg=LIGHT),              "site-icons/icon-192.png", 192)
    render(full_svg(bg=LIGHT),              "site-icons/icon-512.png", 512)
    render(full_svg(bg=LIGHT, scale=MASK_SCALE), "site-icons/icon-512-maskable.png", 512)
    print("done")
