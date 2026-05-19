/**
 * Audio 偏好設定持久化（localStorage）。
 *
 * 只在 browser 端執行；SSR 跳過。鍵名前綴 `ptcg.audio.*` 避免與其他設定衝突。
 */
import {
  setMasterVolume, setMuted, getMasterVolume, isMuted,
  setUiVolume, setSfxVolume, setStatusVolume,
  getUiVolume, getSfxVolume, getStatusVolume,
  setPlayWhenHidden, getPlayWhenHidden,
} from './sfx';

const KEY_VOLUME = 'ptcg.audio.volume';
const KEY_MUTED = 'ptcg.audio.muted';
const KEY_BGM_TRACK = 'ptcg.audio.bgm.track';
const KEY_BGM_VOLUME = 'ptcg.audio.bgm.volume';
// v4.928：sub-bus 音量（UI 操作音 / 戰鬥音 / 狀態音）
const KEY_UI_VOLUME = 'ptcg.audio.ui.volume';
const KEY_SFX_VOLUME = 'ptcg.audio.sfx.volume';
const KEY_STATUS_VOLUME = 'ptcg.audio.status.volume';
// v4.929：切到背景頁籤時是否仍播音
const KEY_PLAY_WHEN_HIDDEN = 'ptcg.audio.playWhenHidden';

// Svelte store/state can't be easily shared here without Svelte 5 runes context,
// so we'll just export plain getters/setters for BGM that localStorage reads.

export function loadAudioPrefs(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const vRaw = localStorage.getItem(KEY_VOLUME);
    if (vRaw !== null) {
      const v = parseFloat(vRaw);
      if (!Number.isNaN(v)) setMasterVolume(v);
    }
    const mRaw = localStorage.getItem(KEY_MUTED);
    if (mRaw !== null) setMuted(mRaw === '1');
    // v4.928：載入 sub-bus 音量
    const uiRaw = localStorage.getItem(KEY_UI_VOLUME);
    if (uiRaw !== null) { const v = parseFloat(uiRaw); if (!Number.isNaN(v)) setUiVolume(v); }
    const sfxRaw = localStorage.getItem(KEY_SFX_VOLUME);
    if (sfxRaw !== null) { const v = parseFloat(sfxRaw); if (!Number.isNaN(v)) setSfxVolume(v); }
    const stRaw = localStorage.getItem(KEY_STATUS_VOLUME);
    if (stRaw !== null) { const v = parseFloat(stRaw); if (!Number.isNaN(v)) setStatusVolume(v); }
    // v4.929 載入 playWhenHidden
    const hRaw = localStorage.getItem(KEY_PLAY_WHEN_HIDDEN);
    if (hRaw !== null) setPlayWhenHidden(hRaw === '1');
  } catch { /* quota / privacy mode — ignore */ }
}

export function saveVolume(v: number): void {
  setMasterVolume(v);
  try { localStorage.setItem(KEY_VOLUME, String(getMasterVolume())); } catch { /* */ }
}

export function saveMuted(m: boolean): void {
  setMuted(m);
  try { localStorage.setItem(KEY_MUTED, m ? '1' : '0'); } catch { /* */ }
}

export function getBgmTrack(): string {
  if (typeof localStorage === 'undefined') return 'none';
  try {
    return localStorage.getItem(KEY_BGM_TRACK) ?? 'none';
  } catch { return 'none'; }
}

export function setBgmTrack(track: string): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY_BGM_TRACK, track); } catch { /* */ }
}

export function getBgmVolume(): number {
  if (typeof localStorage === 'undefined') return 0.5;
  try {
    const vRaw = localStorage.getItem(KEY_BGM_VOLUME);
    if (vRaw !== null) {
      const v = parseFloat(vRaw);
      return Number.isNaN(v) ? 0.5 : v;
    }
  } catch { /* */ }
  return 0.5;
}

export function setBgmVolume(v: number): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY_BGM_VOLUME, String(v)); } catch { /* */ }
}

// v4.928：sub-bus 音量 save/get
export function saveUiVolume(v: number): void {
  setUiVolume(v);
  try { localStorage.setItem(KEY_UI_VOLUME, String(getUiVolume())); } catch { /* */ }
}
export function saveSfxVolume(v: number): void {
  setSfxVolume(v);
  try { localStorage.setItem(KEY_SFX_VOLUME, String(getSfxVolume())); } catch { /* */ }
}
export function saveStatusVolume(v: number): void {
  setStatusVolume(v);
  try { localStorage.setItem(KEY_STATUS_VOLUME, String(getStatusVolume())); } catch { /* */ }
}

// v4.929：playWhenHidden save
export function savePlayWhenHidden(v: boolean): void {
  setPlayWhenHidden(v);
  try { localStorage.setItem(KEY_PLAY_WHEN_HIDDEN, v ? '1' : '0'); } catch { /* */ }
}

export { isMuted, getMasterVolume, getUiVolume, getSfxVolume, getStatusVolume, getPlayWhenHidden };
