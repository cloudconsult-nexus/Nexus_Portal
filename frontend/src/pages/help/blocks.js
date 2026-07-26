// Tiny builder functions so each help page's content reads as an ordered
// list of intent ("this is a heading", "this is a warning") instead of raw
// JSX — BlockRenderer.jsx is the only thing that knows how each renders.
export const heading = (text, level = 2) => ({ type: 'heading', text, level });
export const para = (text) => ({ type: 'paragraph', text });
export const list = (items, ordered = false) => ({ type: 'list', items, ordered });
export const callout = (text, tone = 'info') => ({ type: 'callout', text, tone });
export const code = (text) => ({ type: 'code', text });
export const table = (headers, rows) => ({ type: 'table', headers, rows });
