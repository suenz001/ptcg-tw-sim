#!/usr/bin/env python3
"""
卡名 rename audit — 找 TS source 內 reference 但 JSON 不存在的卡名。

防止改了 JSON 卡名（如 v5.022「閃電能量→閃電【雷】能量」）但忘了改 TS source
造成 silent broken (regA / regPost 等永遠 match 不到)。

執行：python3 scripts/audit-card-names.py
退出碼：0 = 無 broken reference / 1 = 有 broken reference
"""
import json
import glob
import re
import sys
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
os.chdir(REPO_ROOT)

# ─── 1. JSON 內所有卡名 + 招式名 + 特性名 ───────────────────────────────────
json_card_names = set()
json_attack_names = set()
json_ability_names = set()

for fp in sorted(glob.glob('static/cards/*.json')):
    try:
        with open(fp, encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f'⚠️  JSON parse error in {fp}: {e}', file=sys.stderr)
        continue
    if not isinstance(data, list):
        continue
    for c in data:
        name = c.get('name')
        if name:
            json_card_names.add(name.strip())
        # attacks + abilities 也收集（給 regPre/regPost key 比對用）
        for atk in (c.get('attacks') or []):
            an = atk.get('name')
            if an: json_attack_names.add(an.strip())
        for ab in (c.get('abilities') or []):
            abn = ab.get('name')
            if abn: json_ability_names.add(abn.strip())

print(f'📊 JSON corpus: {len(json_card_names)} cards, '
      f'{len(json_attack_names)} attacks, {len(json_ability_names)} abilities')

# ─── 2. TS source 掃 reg* 函式 first arg ──────────────────────────────────
# 模式：regA('XX', 0, fn) / regAByName('XX', 'YY', fn) / regPre('XX|YY', ...)
#       / regPost('XX|YY', ...) / reg('XX', fn) / regG('XX', fn)
# 排除：regR('effectKey', ...) — effectKey 是英文 dash-case 非卡名
# 排除：註解內 reference
PATTERN = re.compile(
    r"\b(regA|regAByName|regPre|regPost|regG)\s*\(\s*['\"]([^'\"]+?)['\"]"
)
# regR 不算（effectKey）
# reg 單獨用於 trainer 跟某些 stadium — 抓但需驗
TRAINER_PATTERN = re.compile(r"\breg\s*\(\s*['\"]([^'\"]+?)['\"]")

source_refs = {}  # cardname -> [(file, line, fn, full_key)]

ts_files = []
for pattern in ['src/lib/game/**/*.ts', 'src/lib/game/*.ts']:
    ts_files.extend(glob.glob(pattern, recursive=True))
# 排除 .backup / test 檔
ts_files = [f for f in ts_files if '.backup' not in f and 'test' not in f]

def has_cjk(s: str) -> bool:
    """是否含中日韓字元 — 中文卡名一定含 CJK"""
    return any('一' <= ch <= '鿿' for ch in s)

def strip_comments(text: str) -> str:
    """粗略移除 // 跟 /* */ 註解（避免註解內字串誤報）"""
    text = re.sub(r'/\*[\s\S]*?\*/', '', text)
    text = re.sub(r'//[^\n]*', '', text)
    return text

for fp in sorted(ts_files):
    try:
        with open(fp, encoding='utf-8') as f:
            text = f.read()
    except UnicodeDecodeError:
        continue
    text_clean = strip_comments(text)
    # 按行掃但用 clean 版本（行號可能稍偏）
    for i, line in enumerate(text_clean.split('\n'), 1):
        for m in PATTERN.finditer(line):
            fn_name = m.group(1)
            key = m.group(2)
            cardname = key.split('|')[0].strip()
            if not has_cjk(cardname):
                continue
            source_refs.setdefault(cardname, []).append((fp, i, fn_name, key))
        for m in TRAINER_PATTERN.finditer(line):
            # reg('卡名', fn) — 訓練家/stadium 註冊；reg('effectKey', fn) — resolver
            # 用 CJK 判斷
            key = m.group(1)
            cardname = key.split('|')[0].strip()
            if not has_cjk(cardname):
                continue
            source_refs.setdefault(cardname, []).append((fp, i, 'reg', key))

print(f'📊 TS source: {len(source_refs)} unique card names referenced via reg*')

# ─── 3. 對比 — 找 source reference 但 JSON 不存在的 ──────────────────────
broken = []
fuzzy_hint = []  # 近似 match 提示
for cn, refs in source_refs.items():
    if cn in json_card_names:
        continue
    # 近似 match — 看 JSON 有沒有「含 cn」或「cn 含」的卡名
    near = [j for j in json_card_names if cn in j or j in cn]
    for ref in refs:
        broken.append((cn, near[:3], *ref))

# ─── 4. 報告 ──────────────────────────────────────────────────────────
if broken:
    print(f'\n❌ {len(broken)} broken card name references in TS source:')
    # 按卡名 group 顯示
    by_card = {}
    for cn, near, fp, line, fn_name, key in broken:
        by_card.setdefault(cn, {'near': near, 'refs': []})
        by_card[cn]['refs'].append((fp, line, fn_name, key))
    for cn, info in sorted(by_card.items()):
        print(f'\n  ❌ Card "{cn}" referenced but not in any JSON')
        if info['near']:
            print(f'     💡 Did you mean? {info["near"]}')
        for fp, line, fn_name, key in info['refs'][:3]:
            print(f'     · {fp}:{line} → {fn_name}("{key}")')
        if len(info['refs']) > 3:
            print(f'     · ... and {len(info["refs"])-3} more references')
    print(f'\nTotal: {len(by_card)} unique broken card names, {len(broken)} call sites')
    sys.exit(1)
else:
    print(f'\n✅ Card name audit pass — all {len(source_refs)} card names referenced in TS source exist in JSON')
    sys.exit(0)
