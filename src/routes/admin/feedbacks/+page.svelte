<script lang="ts">
  /**
   * v2.53 後台 — 意見回饋管理（admin only）
   *
   * 功能：
   *   - 列出所有玩家提交的 feedbacks（最近 100 則）
   *   - 顯示提交者 uid、deviceId、userAgent、時間、內容
   *   - 對任一筆寫入回覆（admin reply），玩家下次開意見回饋 modal 即看得到
   *
   * 權限：只有 admin email（suenz001@yahoo.com.tw）能進入
   *   非 admin 看到「無權限」訊息
   */
  import { onMount } from 'svelte';
  import { auth, db } from '$lib/firebase';
  import { onAuthStateChanged, type User } from 'firebase/auth';
  import {
    collection, query, orderBy, limit, getDocs,
    doc, updateDoc, serverTimestamp, deleteDoc,
  } from 'firebase/firestore';

  interface FeedbackDoc {
    id: string;
    content: string;
    uid?: string;
    deviceId?: string;
    userAgent?: string;
    createdAt?: { seconds?: number };
    reply?: string;
    repliedAt?: { seconds?: number };
    repliedBy?: string;
  }

  let user = $state<User | null>(null);
  let authReady = $state(false);
  let isAdmin = $derived(user?.email === 'suenz001@yahoo.com.tw');

  let feedbacks = $state<FeedbackDoc[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  // 每筆回覆的 draft，鍵 = feedback.id
  let replyDrafts = $state<Record<string, string>>({});
  let savingId = $state<string | null>(null);

  onMount(() => {
    return onAuthStateChanged(auth, u => {
      user = u;
      authReady = true;
    });
  });

  // 當確認 admin 後自動載入清單
  $effect(() => {
    if (authReady && isAdmin && feedbacks.length === 0 && !loading) {
      loadFeedbacks();
    }
  });

  async function loadFeedbacks() {
    loading = true;
    loadError = null;
    try {
      const q = query(
        collection(db, 'feedbacks'),
        orderBy('createdAt', 'desc'),
        limit(100),
      );
      const snap = await getDocs(q);
      feedbacks = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<FeedbackDoc, 'id'>) }));
    } catch (err) {
      console.error('Load feedbacks failed:', err);
      loadError = (err as Error)?.message ?? 'unknown';
    } finally {
      loading = false;
    }
  }

  async function submitReply(fbId: string) {
    const replyText = replyDrafts[fbId]?.trim();
    if (!replyText || savingId) return;
    savingId = fbId;
    try {
      await updateDoc(doc(db, 'feedbacks', fbId), {
        reply: replyText,
        repliedAt: serverTimestamp(),
        repliedBy: user?.email ?? 'admin',
      });
      replyDrafts[fbId] = '';
      await loadFeedbacks();
    } catch (err) {
      alert('送出失敗：' + (err as Error)?.message);
    } finally {
      savingId = null;
    }
  }

  async function deleteFeedback(fbId: string) {
    if (!confirm('確定要刪除這筆回饋嗎？')) return;
    savingId = fbId;
    try {
      await deleteDoc(doc(db, 'feedbacks', fbId));
      await loadFeedbacks();
    } catch (err) {
      alert('刪除失敗：' + (err as Error)?.message);
    } finally {
      savingId = null;
    }
  }

  function fmtTime(t?: { seconds?: number } | null): string {
    if (!t?.seconds) return '?';
    return new Date(t.seconds * 1000).toLocaleString('zh-TW');
  }

  function startEditReply(fbId: string, existingReply: string) {
    replyDrafts[fbId] = existingReply;
  }
</script>

<main>
  <header class="page-header">
    <h1>📋 意見回饋管理</h1>
    <p class="subtitle">管理員後台 (admin only)</p>
  </header>

  {#if !authReady}
    <p>檢查登入狀態中...</p>
  {:else if !user}
    <div class="permission-warning">
      <p>⚠️ 尚未登入。請先到首頁登入後再進入此頁。</p>
    </div>
  {:else if !isAdmin}
    <div class="permission-warning">
      <p>❌ 你不是管理員（目前帳號：<code>{user.email ?? '匿名'}</code>）</p>
      <p>本頁僅限 <code>suenz001@yahoo.com.tw</code> 進入。</p>
    </div>
  {:else}
    <div class="admin-meta">
      <span>已登入：<code>{user.email}</code></span>
      <button class="refresh-btn" onclick={loadFeedbacks} disabled={loading}>
        {loading ? '載入中...' : '🔄 重新載入'}
      </button>
    </div>

    {#if loadError}
      <div class="err-msg">載入錯誤：{loadError}</div>
    {/if}

    {#if !loading && feedbacks.length === 0}
      <div class="empty-state">尚無玩家回饋</div>
    {:else}
      <div class="feedback-stats">共 {feedbacks.length} 則回饋（最近 100 則）</div>
      <div class="feedback-list">
        {#each feedbacks as fb (fb.id)}
          <article class="fb-card" class:has-reply={!!fb.reply}>
            <header class="fb-meta">
              <span class="fb-time">📅 {fmtTime(fb.createdAt)}</span>
              {#if fb.uid}<span class="fb-uid">uid: <code>{fb.uid.slice(0, 12)}...</code></span>{/if}
              {#if fb.deviceId}<span class="fb-dev">device: <code>{fb.deviceId.slice(0, 8)}</code></span>{/if}
              {#if fb.reply}<span class="fb-replied-tag">✓ 已回覆</span>{/if}
            </header>

            <div class="fb-content">{fb.content}</div>

            {#if fb.userAgent}
              <details class="fb-ua">
                <summary>User Agent</summary>
                <code>{fb.userAgent}</code>
              </details>
            {/if}

            {#if fb.reply}
              <div class="existing-reply">
                <div class="reply-header">
                  <strong>💬 已回覆</strong>
                  <span class="reply-time">{fmtTime(fb.repliedAt)}</span>
                  {#if fb.repliedBy}<span class="reply-by">by {fb.repliedBy}</span>{/if}
                </div>
                <div class="reply-text">{fb.reply}</div>
              </div>
            {/if}

            <div class="reply-form">
              <textarea
                placeholder={fb.reply ? '編輯回覆內容...' : '輸入回覆內容...'}
                bind:value={replyDrafts[fb.id]}
                rows="3"
                disabled={savingId === fb.id}
              ></textarea>
              <div class="reply-actions">
                {#if fb.reply && !replyDrafts[fb.id]}
                  <button class="btn-edit" onclick={() => startEditReply(fb.id, fb.reply ?? '')}>編輯既有回覆</button>
                {/if}
                <button
                  class="btn-submit"
                  onclick={() => submitReply(fb.id)}
                  disabled={!replyDrafts[fb.id]?.trim() || savingId === fb.id}
                >
                  {savingId === fb.id ? '送出中...' : (fb.reply ? '更新回覆' : '送出回覆')}
                </button>
                <button
                  class="btn-delete"
                  onclick={() => deleteFeedback(fb.id)}
                  disabled={savingId === fb.id}
                >🗑 刪除</button>
              </div>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  {/if}
</main>

<style>
  main {
    max-width: 900px;
    margin: 2rem auto;
    padding: 0 1.25rem 3rem;
    font-family: system-ui, -apple-system, 'Microsoft JhengHei', sans-serif;
    color: #1a1a1a;
    line-height: 1.6;
  }
  .page-header h1 { margin-bottom: 0.25rem; }
  .subtitle { color: #888; margin-top: 0; }
  .permission-warning {
    margin: 2rem 0;
    padding: 1.5rem;
    background: #fff5e6;
    border: 1px solid #f0c060;
    border-radius: 8px;
  }
  .permission-warning p { margin: 0.4rem 0; }
  code {
    background: #f0f0f0;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.86em;
  }
  .admin-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #e8f5e8;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }
  .refresh-btn, .btn-submit, .btn-edit, .btn-delete {
    padding: 0.4rem 0.8rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.86rem;
  }
  .refresh-btn { background: #06C755; color: #fff; }
  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .err-msg {
    background: #fff0f0;
    border: 1px solid #ee9999;
    color: #aa3333;
    padding: 0.8rem 1rem;
    border-radius: 6px;
    margin: 1rem 0;
  }
  .empty-state {
    text-align: center;
    color: #888;
    padding: 3rem 1rem;
  }
  .feedback-stats {
    font-size: 0.86rem;
    color: #666;
    margin-bottom: 0.6rem;
  }
  .feedback-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .fb-card {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .fb-card.has-reply {
    border-left: 3px solid #06C755;
  }
  .fb-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    font-size: 0.78rem;
    color: #666;
    margin-bottom: 0.6rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px dashed #eee;
  }
  .fb-replied-tag {
    background: #06C755;
    color: #fff;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-weight: 600;
  }
  .fb-content {
    white-space: pre-wrap;
    font-size: 0.95rem;
    margin: 0.5rem 0;
  }
  .fb-ua {
    font-size: 0.75rem;
    color: #888;
    margin: 0.4rem 0;
  }
  .fb-ua summary { cursor: pointer; }
  .fb-ua code {
    display: block;
    margin-top: 0.3rem;
    padding: 0.4rem;
    word-break: break-all;
    background: #f8f8f8;
  }
  .existing-reply {
    background: #f0f9f0;
    border: 1px solid #c8e6c8;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin: 0.6rem 0;
  }
  .reply-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.8rem;
    align-items: baseline;
    font-size: 0.8rem;
    color: #2c4a2c;
    margin-bottom: 0.3rem;
  }
  .reply-time, .reply-by { color: #5a7a5a; }
  .reply-text {
    white-space: pre-wrap;
    margin: 0;
    color: #1a3a1a;
  }
  .reply-form {
    margin-top: 0.6rem;
  }
  .reply-form textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.9rem;
    resize: vertical;
  }
  .reply-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.4rem;
    justify-content: flex-end;
  }
  .btn-submit { background: #06C755; color: #fff; }
  .btn-submit:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-edit { background: #6688aa; color: #fff; }
  .btn-delete { background: #c66; color: #fff; }
</style>
