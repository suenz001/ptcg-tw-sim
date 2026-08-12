# nginx → API 的 upstream keepalive：站長操作單（v6.178）

> **這份不是給玩家看的。** nginx 的設定檔在 VM 上（`/etc/nginx/…`），**不在這個 repo 裡**，
> 所以沒有辦法用 push 的方式改，只能由站長在 VM 上手動改一次。
> 每一步都寫了「看到什麼算成功」，照著複製貼上即可。**做之前先確認現在沒有賽事在進行。**

---

## 這是在修什麼

現在 nginx 每次把請求轉給 Node（`127.0.0.1:3000`）都**開一條新的 TCP 連線、用完就丟**：

- 設定裡只有 `proxy_pass` + `proxy_http_version 1.1`，**沒有** `upstream … { keepalive N; }`，
  也**沒有** `proxy_set_header Connection "";`（這兩個少任何一個，keepalive 都不會生效）。
- 實測：TIME-WAIT 狀態的連線 **5873 條**（佔可用連接埠 20.8%）；流量 117 req/s
  ＝ 每秒 117 次三向交握。

玩家端量到的「慢」是**送出請求到收到第一個位元組（TTFB）中位數 1.2 秒**，
而下載本身只有 22ms。每次都重開連線正是加在 TTFB 上的成本，所以這一項是直接打在痛點上的。

> ⚠⚠ **誠實說明（不要期待這一項會把 1.2 秒變成 0.1 秒）**：
> nginx 到 Node 是本機迴環，一次三向交握大約 0.05～1 毫秒 —— 直接省下的時間**趨近於零**。
> 它真正的價值是**衛生**：ephemeral port 現在被 TIME-WAIT 佔掉 20.8%，尖峰再翻一倍就會開始
> 出現連接埠耗盡；那時候的症狀是 SYN 重傳，**一次就是 1 秒起跳**，會直接變成災難。
> 這是預防針，不是止痛藥。1.2 秒的真兇還沒找到（見 `docs/changelog-internal.md` v6.178）。

> ⚠ 另外一件也要知道的事：`proxy_pass http://ptcg_api;` 會讓送往 Node 的 `Host` 標頭
> 從 `127.0.0.1:3000` 變成 `ptcg_api`。已經逐檔確認過 `server.js` 與
> `server_admin_patch.js` **完全沒有任何一行讀 `req.headers.host` / `req.hostname`**，
> 所以這個改變沒有影響；CORS 用的是 `cors()` 的萬用設定，也不看 Host。

---

## 步驟 0：連進 VM

在自己的電腦開「命令提示字元」，貼上：

```
cd /d D:\ai
ssh -i ssh-key-2026-02-11.key ubuntu@140.245.109.103
```

**成功的樣子**：畫面最後一行變成 `ubuntu@instance-20260211-1158:~$`。

---

## 步驟 1：先量一次現況（之後才知道有沒有改善）

```
ss -tan state time-wait | wc -l
```

**成功的樣子**：印出一個數字（例如 `5873`）。**把這個數字記下來**，等一下要比較。

---

## 改完之後設定會長這樣（先看一眼，心裡有底）

```nginx
# ── 新增：放在 server { } 之外 ──
upstream ptcg_api {
    server 127.0.0.1:3000;
    keepalive 64;
    keepalive_requests 1000;
    keepalive_timeout 3s;
}

server {
    ...
    location /api/ {
        proxy_pass http://ptcg_api;        # ← 原本是 http://127.0.0.1:3000
        proxy_http_version 1.1;            # ← keepalive 必要
        proxy_set_header Connection "";    # ← keepalive 必要，少這行整個白做
        ...
    }
}
```

> 為什麼那兩行「少一行就白做」：HTTP/1.0 沒有持久連線，所以要 `proxy_http_version 1.1`；
> 而 nginx 預設會往 upstream 送 `Connection: close`，不清成空字串的話 Node 每次都會把連線關掉。

---

## 步驟 1.5：確認 nginx 版本夠新

```
nginx -v
```

**成功的樣子**：印出 `nginx version: nginx/1.18.0`（或更新）。
`keepalive_timeout` / `keepalive_requests` 寫在 `upstream` 區塊內需要 **1.15.3 以上**；
比這更舊的話 `nginx -t` 會直接失敗（那一步會擋下來，不會弄壞網站）。

---

## 步驟 2：找出要改的設定檔

```
sudo grep -rln "127.0.0.1:3000" /etc/nginx/
```

**成功的樣子**：印出**剛好一個**檔名，例如
`/etc/nginx/sites-available/default` 或 `/etc/nginx/conf.d/ptcg.conf`。

- **印出兩個以上** ⇒ 先停下來，把畫面貼回來問，不要自己猜。
- **什麼都沒印出** ⇒ 也先停下來（代表前面不是 nginx，或轉送寫法不同）。

接著看一眼內容：

```
sudo grep -n "proxy_pass\|proxy_http_version\|Connection\|Upgrade\|upstream" $(sudo grep -rl "127.0.0.1:3000" /etc/nginx/)
```

⚠ **如果看到 `Upgrade` 或 `websocket` 字樣，請停下來先問。**
那是 WebSocket 的寫法，`Connection` 這個標頭在那種 location 裡不能被覆蓋掉。
（本站目前沒有用 WebSocket，正常情況不會看到。）

---

## 步驟 3：備份（**不要跳過**）

```
F=$(sudo grep -rl "127.0.0.1:3000" /etc/nginx/); echo "$F"
sudo cp "$F" "$F.bak-$(date +%Y%m%d-%H%M%S)"
ls -l "$F".bak-*
```

**成功的樣子**：最後一行列出一個 `.bak-2026…` 的檔案，大小和原檔一樣。

---

## 步驟 4：改設定（自動版，改壞會自己還原）

整段一次貼上、按 Enter：

```
sudo python3 - "$F" <<'PYEOF'
import sys, re, shutil, subprocess, time
f = sys.argv[1]
bak = f + '.autobak-' + time.strftime('%Y%m%d-%H%M%S')
shutil.copyfile(f, bak)
s = open(f, encoding='utf-8').read()

if 'upstream ptcg_api' in s:
    print('SKIP: upstream ptcg_api 已經存在，沒有重複加'); sys.exit(0)
if 'Upgrade' in s:
    print('ABORT: 這個檔案有 WebSocket 設定，請人工處理'); sys.exit(1)
if 'proxy_pass' not in s or '127.0.0.1:3000' not in s:
    print('ABORT: 找不到 proxy_pass 到 127.0.0.1:3000'); sys.exit(1)

block = (
  'upstream ptcg_api {\n'
  '    server 127.0.0.1:3000;\n'
  '    keepalive 64;\n'
  '    keepalive_requests 1000;\n'
  '    keepalive_timeout 3s;\n'
  '}\n\n'
)
# upstream 必須在 server {} 之外（這個檔案本身是被 include 進 http {} 的）
i = s.find('server')
s = block + s if i < 0 else s[:i] + block + s[i:]

# proxy_pass 改指向 upstream，並補上 keepalive 必要的兩行
def fix(m):
    indent = m.group(1)
    return (indent + 'proxy_pass http://ptcg_api;\n'
            + indent + 'proxy_http_version 1.1;\n'
            + indent + 'proxy_set_header Connection "";')
s2, n = re.subn(r'([ \t]*)proxy_pass\s+http://127\.0\.0\.1:3000/?\s*;', fix, s)
if n == 0:
    print('ABORT: proxy_pass 沒有被改到'); sys.exit(1)
# 移除原本重複的 proxy_http_version（避免同一個 location 出現兩次）
s2 = re.sub(r'\n([ \t]*proxy_http_version\s+1\.1\s*;)(?=[\s\S]*?proxy_set_header Connection "";)', '\n', s2, count=0)
open(f, 'w', encoding='utf-8').write(s2)
print('OK: 已改 %d 處 proxy_pass；備份在 %s' % (n, bak))
PYEOF
```

**成功的樣子**：印出 `OK: 已改 1 處 proxy_pass；備份在 /etc/nginx/….autobak-…`。
印出 `ABORT:` 或 `SKIP:` 就是**沒有改到任何東西**（檔案原封不動），把訊息貼回來問。

---

## 步驟 5：檢查語法（**這一步是安全網**）

```
sudo nginx -t
```

**成功的樣子**（兩行都要有）：

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

**只要沒看到 `successful`，立刻執行「還原」（見最下面），不要繼續。**

---

## 步驟 6：套用

```
sudo systemctl reload nginx
```

**成功的樣子**：沒有任何輸出（沒消息就是好消息）。
`reload` 是平順重載，**不會**讓網站斷線。

再確認一次服務還活著：

```
systemctl is-active nginx
```

**成功的樣子**：印出 `active`。

---

## 步驟 7：驗證真的生效

等 3～5 分鐘（讓流量跑一陣子），然後：

```
ss -tan state time-wait | wc -l
```

**成功的樣子**：這個數字比**步驟 1 記下來的**明顯小（通常會掉到十分之一以下，例如從 5873 → 數百）。

再看一眼「持續存在的連線」：

```
ss -tan | grep -c ':3000'
```

**成功的樣子**：印出一個穩定的小數字（大約 10～70）。這就是被重複使用的那些連線。

> 沒有明顯下降 ⇒ 多半是 `proxy_set_header Connection "";` 沒有落在正確的 location 裡。
> 把 `sudo grep -n "proxy_pass\|Connection\|upstream\|keepalive" $F` 的輸出貼回來。

---

## 萬一要還原

```
F=$(sudo grep -rl "ptcg_api\|127.0.0.1:3000" /etc/nginx/ | head -1)
ls -l "$F".bak-* "$F".autobak-*
sudo cp "$F".bak-<剛才那個時間> "$F"
sudo nginx -t && sudo systemctl reload nginx
```

**成功的樣子**：`nginx -t` 印出 `successful`，`systemctl is-active nginx` 印出 `active`。
還原之後就完全回到現在的狀態，不會有任何殘留。

---

## `keepalive 64` 這個數字是怎麼來的

| 依據 | 數字 |
|---|---|
| 目前流量 | 117 req/s |
| upstream 回應時間 P95 | 8 ms |
| ⇒ 平均同時在處理的請求數 | 117 × 0.008 ≈ **1 條** |
| 尖峰抓 10 倍 | ≈ 10 條 |
| `keepalive N` 的語意 | 每個 nginx worker **最多保留幾條閒置連線**（不是上限，不夠會照常新開） |
| VM 的 worker 數 | `worker_processes auto` ⇒ 等於 CPU 核心數（2 核就是 2 個 worker） |

所以 **64** ＝ 尖峰估計值的約 6 倍餘裕；就算 2 個 worker 各存滿也只有 128 條閒置連線，
遠低於現在每分鐘開開關關數千條的成本，Node 端不會有任何壓力（現在光 TIME-WAIT 就有 5873 條）。

- 太小（例如 8）：尖峰時仍會頻繁新開連線，效果打折。
- 太大（例如 1024）：只是多留一些閒置 socket，沒有崩潰風險，但也沒有好處。
- `keepalive_requests 1000`：同一條連線最多服務 1000 次請求後換新的（避免長期連線累積問題）。
- `keepalive_timeout 3s`：閒置超過 3 秒的連線由 **nginx 這邊**先收掉。
  ⚠⚠ **這個數字不能調大。** Node 的 HTTP server 預設 `keepAliveTimeout` 是 **5 秒**。
  如果 nginx 把閒置連線留得比 5 秒久，Node 會先關掉它，而 nginx 可能剛好在關閉封包
  還沒到達時把下一個請求寫進去 ⇒ `upstream prematurely closed connection`。
  GET 會被 nginx 自動改送到新連線，但 **PUT/POST 預設不重試** —— 而
  `PUT /api/rooms/:code`（存盤面）正是休閒對戰最熱的寫入路徑 ⇒ 玩家會吃到 502。
  設 3s（小於 Node 的 5s）等於讓 nginx 永遠先放手，這個競態就不存在。
  117 req/s 的流量下連線幾乎不會閒置到 3 秒，重用率不會因此變差。
  （另一種解法是把 Node 的 `keepAliveTimeout` 調到 65 秒再讓 nginx 用 60s，
  但那要動對戰伺服器的啟動路徑，風險比較高，這次不採用。）

> ⚠ 順帶一提：SSE（`/api/rooms/:code/stream`）那種長連線本來就會一直佔著，
> 它們不算在「閒置連線池」裡，不受這個數字影響，行為也不會改變。


---

## 附錄：如果哪天想改用 nginx 自己壓縮（**這次不需要做**）

v6.178 已經在 Node 端把 gzip 補上了（`oracle-admin/server_admin_patch.js`，跑
`update-tournament.bat` 就會部署）。如果將來想把壓縮移到 nginx 做，等價設定是：

```nginx
gzip on;
gzip_types application/json;
gzip_proxied any;        # 預設 off，不加的話帶 Via 的代理請求不會壓
gzip_min_length 1024;
gzip_comp_level 4;
```

`text/event-stream` 不在 `gzip_types` 內 ⇒ 即時推送天然不會被壓，不用另外排除。
**兩邊同時開不會壓兩次**（nginx 看到回應已經有 `Content-Encoding` 就會放行），所以不會壞，
但也沒有必要重複做。

## 附錄：這件事對玩家的實際影響有多大（已實測）

`/api/*` 是掛在 `www.ptcg-tw-sim.com` 底下、走 Cloudflare 進來的。實測：

```
curl -s -o /dev/null -D- -H 'Accept-Encoding: gzip, br' https://www.ptcg-tw-sim.com/api/health
  → content-encoding: br     server: cloudflare
```

⇒ **Cloudflare 本來就會替所有 `/api/*` 回應壓縮再送給玩家的瀏覽器。**
所以 v6.178 的 gzip 省下來的是 **VM →Cloudflare 這一段**（cloudflared 隧道 + 對外流量），
**玩家端拿到的東西本來就是壓縮過的**。值得做（隧道壅塞是目前 TTFB 1.2 秒的嫌疑之一），
但**不要對外宣稱玩家會感覺到變快** —— 所以這一版沒有寫進首頁更新記錄。
