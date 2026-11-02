// ⭐ v6.617：卡包封面網址的唯一一份（Rule 38）—— 卡包列表的磚（/cards）與「出自於卡包」卡片（SetSourceCard）共用。
// coverImageUrl 可能是絕對網址（官網卡圖、archive 圖）或站內相對路徑（例 "covers/SV5a.png"）。
import { base } from '$app/paths';

export function coverUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${base}/${url}`;
}

/** 「出自於卡包」卡片需要的卡包摘要欄位（index.json 的子集） */
export type SetLite = { code: string; name: string; releaseDate?: string | null; cardCount?: number; coverImageUrl?: string };
