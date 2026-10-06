// "This view is out of date" overlay (Peter, 2026-10-01): the old image stays, greyed out, with a
// round ↻ button in the middle; nothing heavy is recomputed until it is pressed.
//   const ov = staleOverlay(wrapEl, () => recompute());
//   ov.show('The map view changed'); ov.busy('Computing…'); ov.hide();

export function staleOverlay(wrap, onRedo) {
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  const el = document.createElement('div');
  el.className = 'stale-ov';
  el.innerHTML = '<button type="button" class="stale-redo" title="Recalculate">↻</button><div class="stale-msg"></div>';
  el.style.display = 'none';
  wrap.appendChild(el);
  const btn = el.querySelector('button'), msg = el.querySelector('.stale-msg');
  btn.onclick = (e) => { e.stopPropagation(); onRedo(); };
  const dim = (on) => { for (const c of wrap.querySelectorAll('canvas')) c.style.filter = on ? 'grayscale(1) opacity(0.45)' : ''; };
  return {
    show(text = 'Out of date — press ↻ to recalculate') { msg.textContent = text; btn.disabled = false; btn.classList.remove('spin'); el.style.display = 'flex'; dim(true); },
    busy(text = 'Recalculating…') { msg.textContent = text; btn.disabled = true; btn.classList.add('spin'); el.style.display = 'flex'; dim(true); },
    hide() { el.style.display = 'none'; dim(false); },
    get visible() { return el.style.display !== 'none'; },
  };
}
