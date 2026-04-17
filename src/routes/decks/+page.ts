// The deck editor is a fully client-side route. We don't need to preload any
// data here — the page itself lazy-loads the card pool via $lib/cards/pool
// when the user starts editing. This keeps the initial HTML shell tiny and
// lets static prerender succeed without hitting any set JSON at build time.

export const prerender = true;
export const ssr = false;
