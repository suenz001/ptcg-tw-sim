/**
 * Audio 偏好設定持久化（localStorage）。
 *
 * 只在 browser 端執行；SSR 跳過。鍵名前綴 `ptcg.audio.*` 避免與其他設定衝突。
 */
import { setMasterVolume, setMuted, getMasterVolume, isMuted } from './sfx';

const KEY_VOLUME = 'ptcg.audio.volume';
const KEY_MUTED = 'ptcg.audio.muted';
const KEY_BGM_TRACK = 'ptcg.audio.bgm.track';
const KEY_BGM_VOLUME = 'ptcg.audio.bgm.volume';

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

export { isMuted, getMasterVolume };
