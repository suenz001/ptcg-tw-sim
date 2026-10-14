#!/usr/bin/env python3
"""升版配套自動化： python3 scripts/bump-version.py <spec.json>
spec: {ver:'6.448', test:'test-v6448-x.mjs', title, lead, body, allowed:[...], allowedNote, internal, hidden?}
  hidden=true ⇒ admin-only／與遊戲內容無關的版本：不寫對外 changelog（站長 2026-10-14），只 bump version.ts＋site-version.txt＋內部 changelog。
  static/site-version.txt 每一版都會寫（verify-deploy ②③ 的前端版本標記），並自動加進 test-v6272 的 allowed。
  對外 changelog：玩家只看得到 title（大標題）；lead／body 只在 admin「📋 更新記錄」分頁顯示。
上一版 = HEAD。⚠ 原本放在 /tmp/pw/bump.py（容器重開就消失），v6.567 起收進 repo。"""
import json, re, subprocess, sys
import os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '')   # repo 根（本檔在 scripts/）
spec = json.load(open(sys.argv[1]))
V = spec['ver']
prev_full = subprocess.check_output(['git', '-C', R, 'rev-parse', 'HEAD']).decode().strip()
prev_short = prev_full[:8]
PV = re.search(r"VERSION = '([\d.]+)'", open(R + 'src/lib/version.ts').read()).group(1)

def rw(p, f):
    s = open(R + p, encoding='utf8').read(); t = f(s)
    assert t != s, p
    open(R + p, 'w', encoding='utf8').write(t)

rw('src/lib/version.ts', lambda s: s.replace(f"VERSION = '{PV}'", f"VERSION = '{V}'"))
# ⭐v6.567 前端版本標記：verify-deploy ②③ 讀它（hidden 版本不寫 changelog，第一則不會前進）⇒ 每一版都要寫
rw('static/site-version.txt', lambda s: V + '\n')
spec['allowed'] = sorted(set(spec['allowed']) | {'static/site-version.txt'})
rw('oracle-admin/admin.html', lambda s: s.replace(f"SITE_VERSION_HINT = '{PV}'", f"SITE_VERSION_HINT = '{V}'"))
def pkg(s):
    m = re.search(r'node scripts/test-v\d+[^ "]*\.mjs(?=[^"]*"\s*,\s*\n\s*"build:server-engine")', s)
    # 找 test 鏈最後一個 test-vNNNN
    line = [l for l in s.split('\n') if l.strip().startswith('"test":')][0]
    last = re.findall(r'node scripts/test-v\d{4}[^ "]*\.mjs', line)[-1]
    newline = line.replace(last, last + ' && node scripts/' + spec['test'], 1)
    return s.replace(line, newline)
rw('package.json', pkg)

# ── changelog 三步 ──
# ⭐2026-10-14 站長：「admin的更新，與遊戲內容無關的更新就不用寫在changelog了」⇒ spec['hidden']=True（admin-only／內部維護版）
#   不寫任何對外 changelog（三個檔都不動；test-v6264 走 F0「本版未動 changelog」分支，BASE_SHA pin 也不前移）。
#   version.ts 照樣 bump（站長靠首頁版本號驗收部署）、內部 changelog 照樣寫。
HIDDEN = bool(spec.get('hidden'))
if HIDDEN:
    print('hidden version: public changelog untouched')
else:
    ch = open(R + 'static/changelog.html', encoding='utf8').read()
    bodies = open(R + 'static/changelog-bodies.html', encoding='utf8').read()
    arch = open(R + 'static/changelog-archive.html', encoding='utf8').read()
    new = (f'        <summary><span class="ver-badge">v{V}</span> <b>{spec["title"]}</b><br>{spec["lead"]}</summary>\n'
           f'        <div class="log-body">{spec["body"]}</div>\n      </details>\n      <details>\n')
    assert ch.startswith('<details open>\n')
    ch = '<details open>\n' + new + ch[len('<details open>\n'):]
    # 最後一個「內文在行內」的條目 → 內文搬到 bodies
    blocks = list(re.finditer(r'<details( open)?>\n(        <summary><span class="ver-badge">(v[\d.]+)</span>[^\n]*\n)(        <div class="log-body">(?:(?!</details>).)*?</div>\n)      </details>', ch, re.S))   # 內文可能多行
    last = blocks[-1]
    ver_mv = last.group(3)
    body_line = last.group(4).strip()   # 多行內文：strip 只去頭尾
    ch = ch[:last.start()] + f'<details data-ver="{ver_mv}">\n' + last.group(2) + '      </details>' + ch[last.end():]
    bodies = body_line.replace('<div class="log-body">', f'<div class="log-body" data-ver="{ver_mv}">', 1) + '\n' + bodies
    # 最舊的條目 → archive
    olds = list(re.finditer(r'      <details data-ver="(v[\d.]+)">\n(        <summary>.*\n)      </details>\n', ch))
    o = olds[-1]; over = o.group(1)
    ch = ch[:o.start()] + ch[o.end():]
    bm = re.search(r'<div class="log-body" data-ver="' + re.escape(over) + r'">(.*?</div>)\n', bodies, re.S)   # 內文可能多行
    bodies = bodies[:bm.start()] + bodies[bm.end():]
    k = arch.index('<details>\n') + len('<details>\n')
    arch = arch[:k] + o.group(2) + f'        <div class="log-body">{bm.group(1)}\n      </details>\n      <details>\n' + arch[k:]
    open(R + 'static/changelog.html', 'w', encoding='utf8').write(ch)
    open(R + 'static/changelog-bodies.html', 'w', encoding='utf8').write(bodies)
    open(R + 'static/changelog-archive.html', 'w', encoding='utf8').write(arch)
    print('moved body', ver_mv, 'archived', over)

# ── test-v6264 ──（hidden 版不動 changelog ⇒ pin 不前移）
if not HIDDEN: rw('scripts/test-v6264-changelog-lazy-body.mjs', lambda s: re.sub(r"const BASE_SHA = '[0-9a-f]{40}'; // v[\d.]+（上一版；v[\d.]+ 動了",
    f"const BASE_SHA = '{prev_full}'; // v{PV}（上一版；v{V} 動了", s, 1))

# ── test-v6272 ──
def t72(s):
    s = re.sub(r"const PREV_SHA = '[0-9a-f]{40}';   // v[\d.]+（上一版）", f"const PREV_SHA = '{prev_full}';   // v{PV}（上一版）", s, 1)
    i = s.index('const PREV_ALLOWED = [\n'); j = s.index('];\n', i)
    oldbody = s[i + len('const PREV_ALLOWED = [\n'):j]
    hist = ''.join((l[2:] if l.startswith('  //') else '//   ' + l.strip()) + '\n' for l in oldbody.rstrip('\n').split('\n'))
    allowed = ''.join(f"  '{a}',\n" for a in sorted(spec['allowed']))
    nb = (f"  // ⚠⚠ v{V} 前移：PREV_SHA 從 {prev_short}（v{PV}）起算。\n"
          f"  //   ⚠ PREV_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）。\n"
          f"  // ⭐v{V}：{spec['allowedNote']}\n" + allowed)
    s = s[:i] + 'const PREV_ALLOWED = [\n' + nb + '];\n' + f'// ── 上一版（v{PV}）的宣告，保留當歷史紀錄（不再被程式使用）──────────────\n' + hist + s[j + 3:]
    # 移除最舊的歷史區塊
    heads = [m.start() for m in re.finditer(r'// ── 上一版（v[\d.]+）的宣告', s)]
    lastH = heads[-1]
    end = s.index("T('★★[玩家端零改動]", lastH)
    oldest = re.match(r'// ── 上一版（v([\d.]+)）', s[lastH:]).group(1)
    s = s[:lastH] + s[end:]
    keep = re.findall(r'// ── 上一版（v([\d.]+)）的宣告', s)[-1]
    s = re.sub(r'// （⭐v[\d.]+：歷史宣告只保留到 v[\d.]+ ——', f'// （⭐v{V}：歷史宣告只保留到 v{keep} ——', s, 1)
    print('v6272 dropped', oldest, 'keep to', keep)
    return s
rw('scripts/test-v6272-firestore-read-reduction.mjs', t72)

rw('docs/changelog-internal.md', lambda s: s.replace('# 內部改版紀錄（不打包進網站）\n\n',
    '# 內部改版紀錄（不打包進網站）\n\n' + spec['internal'].replace('{PREV}', f'`{prev_short}`（v{PV}）').rstrip() + '\n\n', 1))
print('bump ok', PV, '->', V, prev_short)
