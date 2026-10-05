<script lang="ts">
  // ⭐v6.488 對戰頁「⚙️ 設定」裡的鍵盤快捷鍵開關（預設關閉）。邏輯在 $lib/game/kbd-shortcuts.ts。
  //   獨立元件、自己的樣式：對戰頁的版面守衛很多，這樣對戰頁只多一行。
  import { kbdEnabled, setKbdEnabled } from '$lib/game/kbd-shortcuts';
  let on = $state(kbdEnabled());
</script>

<details class="kbd-sec">
  <summary>⌨️ 鍵盤快捷鍵（電腦版）</summary>
  <label class="kbd-row">
    <input type="checkbox" checked={on} onchange={(e) => { on = e.currentTarget.checked; setKbdEnabled(on); }} />
    <span>開啟鍵盤快捷鍵</span>
  </label>
  <ul class="kbd-list">
    <li><kbd>Enter</kbd> 按下選擇視窗的「確定」（還沒選好時不會動作）</li>
    <li><kbd>L</kbd> 展開／收合對戰紀錄（新版桌墊、桌墊版）</li>
    <li><kbd>Esc</kbd> 關閉卡片放大與選單（原本就有）</li>
  </ul>
  <div class="kbd-hint">只在有滑鼠的電腦上生效；在聊天輸入框打字時不會觸發。攻擊、結束回合等收不回來的動作沒有快捷鍵。</div>
</details>

<style>
  .kbd-sec { margin-bottom: 1.5rem; background: rgba(0, 0, 0, 0.2); padding: 1rem; border-radius: 8px; border: 1px solid #2a4a2a; color: #ddd; }
  .kbd-sec summary { cursor: pointer; color: #f0f0f0; font-weight: 700; }
  .kbd-row { display: flex; align-items: center; gap: 0.6rem; margin: 0.8rem 0 0.4rem; font-size: 0.95rem; cursor: pointer; }
  .kbd-list { margin: 0.4rem 0; padding-left: 1.2rem; font-size: 0.88rem; line-height: 1.8; color: #ccc; }
  .kbd-list kbd { display: inline-block; min-width: 1.6em; padding: 0 0.35em; margin-right: 0.3em; border: 1px solid #6a8a6a; border-bottom-width: 2px; border-radius: 4px; background: #203020; color: #fff; font-family: inherit; font-size: 0.82rem; text-align: center; }
  .kbd-hint { font-size: 0.8rem; color: #9ab09a; line-height: 1.6; }
</style>
