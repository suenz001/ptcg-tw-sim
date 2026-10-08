# v6.477 產生器（scripts/gen-lobby-light.py）：用法 python3 scripts/gen-lobby-light.py src/routes/game/+page.svelte > 輸出；
#   輸出貼回 v6477-lobby-light 哨兵內「手調」那段之前。把對戰頁「大廳」的深色樣式，轉成淺色主題覆寫規則（HSL 亮度反轉＋例外）。
import re, colorsys, sys, json
SRC=sys.argv[1]
s=open(SRC).read()
a=s.index("{#if isTournament && tStep !== 'playing'}")
b=s.index('<div class="battle-root"')
lob=s[a:b]
st_i=s.rindex('\n<style')+1   # 行首的 <style（避免註解文字裡的字樣）
bat=s[b:st_i]
# ⭐v6.478：大廳之外、但在大廳狀態下會開出來的四個視窗（版本提醒×2、棄賽確認、登入／改密碼）也一起轉。
#   這幾段從 bat 裡拿掉再算「牌桌用到的 class」；它們用到的共用 class（例如 pv-inner）在非牌桌狀態下只會出現在這些視窗，
#   而前綴本身已排除牌桌畫面 ⇒ 不加 .lobby 祖先也不會染到牌桌。
MODAL_STARTS=["{#if isTournament && !isTournSpectator && tVerModalEventId}","{#if isTournament && !isTournSpectator && tDropConfirmEventId}",
              "{#if !isTournament && casualVerModalKey}","{#if showAuthModal}","{#if showChangePasswordModal}"]
mods=[]
for ms in MODAL_STARTS:
    i0=s.index(ms); i1=s.index('\n{/if}',i0)+6
    mods.append(s[i0:i1])
    bat=bat.replace(s[i0:i1],'')
MOD='\n'.join(mods)
def classes(mk):
    out=set()
    for m in re.finditer(r'class="([^"]*)"',mk):
        for c in re.split(r'\s+',re.sub(r'\{[^}]*\}',' ',m.group(1))):
            if c and re.match(r'^[A-Za-z_][\w-]*$',c): out.add(c)
    for m in re.finditer(r'class:([A-Za-z_][\w-]*)',mk): out.add(m.group(1))
    return out
L0=classes(lob); M=classes(MOD); B=classes(bat)
L=L0|M
only=L-B; shared=L&B
css=s[st_i:]
css=css[css.index('>')+1:css.rindex('</style>')]
css=re.sub(r'/\*[\s\S]*?\*/','',css)
# 只取最外層規則（略過 @media / @keyframes 內的）
rules=[]; depth=0; i=0; buf=''; 
toks=re.finditer(r'[{}]',css); last=0; stack=[]
pos=0
while pos < len(css):
    j=css.find('{',pos); k=css.find('}',pos)
    if j==-1 and k==-1: break
    if j!=-1 and (k==-1 or j<k):
        head=css[pos:j].strip()
        stack.append(head); 
        if len(stack)==1 and not head.startswith('@'):
            e=css.find('}',j); rules.append((head,css[j+1:e])); pos=e+1; stack.pop(); continue
        pos=j+1
    else:
        if stack: stack.pop()
        pos=k+1
HEX=r'#[0-9a-fA-F]{3,8}\b'
def parse(c):
    c=c.strip()
    m=re.match(r'#([0-9a-fA-F]{3,8})$',c)
    if m:
        h=m.group(1)
        if len(h) in (3,4): h=''.join(x*2 for x in h)
        r,g,bb=int(h[0:2],16),int(h[2:4],16),int(h[4:6],16); a=int(h[6:8],16)/255 if len(h)==8 else 1
        return r,g,bb,a
    m=re.match(r'rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$',c)
    if m: return float(m.group(1)),float(m.group(2)),float(m.group(3)),float(m.group(4) or 1)
    return None
def fmt(r,g,b,a):
    if a>=0.999: return '#%02x%02x%02x'%(round(r),round(g),round(b))
    return 'rgba(%d,%d,%d,%.2f)'%(round(r),round(g),round(b),a)
def _lum(c):
    f=lambda v: v/12.92 if v<=0.03928 else ((v+0.055)/1.055)**2.4
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])
def _cr(a,b):
    x,y=_lum(a),_lum(b); return (max(x,y)+0.05)/(min(x,y)+0.05)
def flip(c, role):
    p=parse(c)
    if not p: return c
    r,g,b,a=p
    if r==g==b==0 and a<1: return c   # 黑色半透明（遮罩、陰影）不動
    h,l,sat=colorsys.rgb_to_hls(r/255,g/255,b/255)
    if role=='bg':
        # 深底 → 淺底；半透明白（亮面疊加）→ 半透明黑
        if r==g==b==255 and a<1: return fmt(0,0,0,a*0.6)
        nl = 1-l*0.3 if l<0.5 else l    # 深色背景映到接近白（帶一點原色調）
        nl=min(0.985,max(0.86,nl))
        ns=sat*0.5
    else:
        if r==g==b==255 and a<1: return fmt(0,0,0,a)
        nl = 1-l if l>0.5 else l
        nl=min(0.42,nl) if role=='fg' else min(0.75,max(0.55,1-l)) if l<0.5 else min(0.8,1-l+0.25)
        ns=min(1,sat*1.05)
    nr,ng,nb=colorsys.hls_to_rgb(h,nl,ns)
    # ⭐v6.512 字色可讀性保證：轉出來的字色對「淺色主題最暗的底」（--ui-bg-sunken #d2d9d5）對比不足 4.6 時，
    #   保持色相、逐步調暗到夠為止（原本金黃字 #a57900 在淺底只有 3.0）。只動字色，背景與框線不變。
    if role=='fg' and a>=0.999:
        while _cr((nr,ng,nb),(0xd2/255,0xd9/255,0xd5/255))<4.6 and nl>0.05:
            nl-=0.01; nr,ng,nb=colorsys.hls_to_rgb(h,nl,ns)
    return fmt(nr*255,ng*255,nb*255,a)
def keep_rule(body):
    # 飽和中亮度的實心底（按鈕、徽章）配白字：維持原樣（例：紅色確認鈕、綠色進場鈕）
    m=re.search(r'background(?:-color)?:\s*('+HEX+')',body)
    if m:
        p=parse(m.group(1)); h,l,sat=colorsys.rgb_to_hls(p[0]/255,p[1]/255,p[2]/255)
        if 0.3<=l<=0.7 and sat>0.35: return True
    return False
out=[]
SKIP_UNUSED={'.online-form h2','.online-form select'}
PROPS=('color','background','background-color','border','border-color','border-top','border-bottom','border-left','border-right','border-top-color','border-bottom-color','border-left-color','border-right-color','outline-color')
for sel,body in rules:
    sels=[x.strip() for x in sel.split(',')]
    newsels=[]
    for x in sels:
        if ':global' in x or x.startswith('@'): continue
        cs=set(re.findall(r'\.([A-Za-z_][\w-]*)',x))
        if not cs or not cs<=L: continue
        if re.search(r'(^|[\s>+~])(body|html)\b',x): continue
        if x in SKIP_UNUSED: continue   # 原檔本來就是 Svelte 回報的未使用選擇器
        pre = ':global(html[data-theme=\'light\']:not([data-battle-view]))'   # ⭐v6.499 手機也套（拿掉 data-ui-wide）
        newsels.append(pre+(' ' if (cs<=only or cs<=M) else ' .lobby ')+x)
    if not newsels: continue
    if keep_rule(body): continue
    decls=[]
    for d in body.split(';'):
        if ':' not in d: continue
        k,v=d.split(':',1); k=k.strip(); v=v.strip()
        if k not in PROPS: continue
        if not re.search(HEX+r'|rgba?\(',v): continue
        if 'var(' in v: continue
        role='bg' if k.startswith('background') else ('bd' if k.startswith('border') or k.startswith('outline') else 'fg')
        nv=re.sub(HEX+r'|rgba?\([^)]*\)',lambda m: flip(m.group(0),role),v)
        if nv!=v: decls.append(f'{k}: {nv};')
    if decls:
        out.append('    '+', '.join(newsels)+' { '+' '.join(decls)+' }')
print(len(rules),'rules;',len(out),'overrides; lobby-only',len(only),'shared',len(shared),'modal-classes',len(M), file=sys.stderr)
print('\n'.join(out))
