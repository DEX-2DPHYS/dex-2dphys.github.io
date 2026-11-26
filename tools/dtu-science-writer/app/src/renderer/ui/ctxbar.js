/* Context row under the toolbar: figure tools or table tools (empty otherwise). It has a fixed height,
   so the document never jumps when the tools change. */
export function ctxHost() { return document.querySelector('#ctxbar'); }

export function refreshHint() {
  const host = ctxHost();
  if (!host) return;
  const anyShown = [...host.querySelectorAll('.ctx-panel')].some(p => p.style.display !== 'none');
  const hint = host.querySelector('.ctx-hint');
  if (hint) hint.style.display = anyShown ? 'none' : '';
}
