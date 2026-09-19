// ════════════════════════════════════════════════════════════════════════════
// scripts/lib/env-skip.mjs —— 「這一段因為**執行環境缺東西**而沒有跑」的標記
//
// 站內原本有兩種 skip 標記：
//   SHALLOW-SKIP   拿不到 git 歷史（scripts/lib/base-blob.mjs）
//   PLATFORM-SKIP  作業系統做不到（test-v6263 ④：Windows 套不上無副檔名的 PATH shim）
// 但「這台機器沒有裝 playwright」兩種都不是，而 test-v6304 的 F1 借用了 shallowSkip()
// 來報它 —— 語意被挪用的後果很具體：平行 runner 想把「SHALLOW-SKIP 必須為 0」當硬判準
// 時發現本機恆有 2 次，只好退回「與基準一致」。標記混在一起，就沒辦法對任何一種下硬判準。
//
// ⚠⚠ 最重要的一條：**CI 上不准 ENV-SKIP。**
//   缺瀏覽器在開發機上是可接受的降級；在 CI 上則代表「那一段從來沒有在守」——
//   實測：playwright 不在 package.json 的 devDependencies 裡，所以 CI 的 `npm ci`
//   根本不會裝它，10 支有 PW 段的守衛從實裝那天起就沒在 CI 上執行過。
//   所以這裡預設「CI ⇒ throw」，讓那件事**再也不可能靜默發生**。
//
// ⚠ 過渡期：在 CI 真的裝好瀏覽器之前，workflow 會設 PTCG_ALLOW_ENV_SKIP=1 明示放行。
//   那個環境變數是**刻意留下的把手**，拿掉它就恢復嚴格 —— 它出現在 deploy.yml 裡是
//   為了讓「CI 還沒裝瀏覽器」這件事看得見，而不是藏在守衛內部的 catch。
// ════════════════════════════════════════════════════════════════════════════

const _skipped = [];
let _hooked = false;

/** CI 上是不是嚴格模式（不准 ENV-SKIP）。 */
export function envSkipIsStrict() {
  const isCI = String(process.env.CI || '').toLowerCase() === 'true' || process.env.GITHUB_ACTIONS === 'true';
  return isCI && process.env.PTCG_ALLOW_ENV_SKIP !== '1';
}

/**
 * 宣告「這一段因為執行環境缺東西而沒有跑」。本機大聲印出來並登記；CI 上直接 throw。
 * @param {string} what 哪一段沒跑（要能一眼認出是哪支守衛的哪一節）
 * @param {string} [why] 缺什麼（例如「這台機器沒有 playwright」）
 */
export function envSkip(what, why = '') {
  if (envSkipIsStrict()) {
    throw new Error(`ENV-SKIP 在 CI 上不被允許：${what}${why ? '　—— ' + why : ''}`
      + '\n  （CI 必須把環境備齊；真的要暫時放行請在 workflow 明示 PTCG_ALLOW_ENV_SKIP=1）');
  }
  _skipped.push(what);
  console.log(`  ⚠⚠ ENV-SKIP  ${what}${why ? '　—— ' + why : ''}`);
  if (!_hooked) {
    _hooked = true;
    process.on('exit', () => {
      if (!_skipped.length) return;
      console.log(`\n⚠⚠⚠ [ENV-SKIP] 本次執行有 ${_skipped.length} 段守衛因為環境缺東西被跳過：`);
      for (const w of _skipped) console.log(`      ・${w}`);
      console.log('   ⇒ 這幾段在這台機器上**沒有在守**。CI 上會直接翻紅。');
    });
  }
}

export function envSkipCount() { return _skipped.length; }
