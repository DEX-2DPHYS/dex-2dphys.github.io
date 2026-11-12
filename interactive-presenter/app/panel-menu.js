// Right-click menu on the sidebar's panel titles (2026-11-12, Peter's request):
//   Expand all / Collapse all / ✓ Expand one at a time
// "One at a time" (a setting kept in this browser): opening a panel closes the others. Expand all still opens
// every panel; the setting applies again the next time a panel is opened.
// (loaded after appX.js, which made each title a .panel-toggle button that opens/closes its panel and remembers it;
// this file only clicks those buttons, so the remembered open/closed state stays right)
(function () {
  "use strict";
  const ONE_KEY = "interactivePresenter.panelsOneAtATime.v1";
  const toggles = () => Array.from(document.querySelectorAll(".sidebar > .panel > .panel-header .panel-toggle"));
  const panelOf = (t) => t.closest(".panel");
  const isOpen = (t) => !panelOf(t).classList.contains("collapsed");
  const visible = (t) => !panelOf(t).hidden; // panels for other slide types are hidden, not closed

  let oneAtATime = false;
  try { oneAtATime = localStorage.getItem(ONE_KEY) === "1"; } catch { /* private mode */ }
  function setOneAtATime(on, keep = null) {
    oneAtATime = !!on;
    try { localStorage.setItem(ONE_KEY, oneAtATime ? "1" : "0"); } catch { /* fine */ }
    if (oneAtATime) closeOthers(keep || toggles().find((t) => visible(t) && isOpen(t)) || null);
  }

  let busy = false; // our own clicks must not trigger "one at a time" again
  function setOpen(t, open) {
    if (isOpen(t) === open) return;
    busy = true;
    try { t.click(); } finally { busy = false; }
  }
  function closeOthers(keep) {
    // also the panels hidden now (other slide types): they would otherwise show up open later
    for (const t of toggles()) if (t !== keep) setOpen(t, false);
  }
  function setAll(open) {
    for (const t of toggles()) setOpen(t, open);
  }

  // one at a time: after appX has opened a panel (its own click handler runs first), close the others
  document.addEventListener("click", (e) => {
    const t = e.target.closest?.(".sidebar > .panel > .panel-header .panel-toggle");
    if (!t || busy || !oneAtATime || !isOpen(t)) return;
    closeOthers(t);
  });

  // ---- the menu ----
  let menu = null;
  function close() { if (menu) { menu.remove(); menu = null; } }
  function item(label, onPick, { checked = null, title = "" } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "panel-menu-item";
    b.setAttribute("role", checked === null ? "menuitem" : "menuitemcheckbox");
    if (checked !== null) b.setAttribute("aria-checked", checked ? "true" : "false");
    b.innerHTML = `<span class="panel-menu-check" aria-hidden="true">${checked ? "✓" : ""}</span><span>${label}</span>`;
    if (title) b.title = title;
    b.addEventListener("click", (e) => { e.stopPropagation(); close(); onPick(); });
    return b;
  }
  function open(x, y, t) {
    close();
    menu = document.createElement("div");
    menu.className = "panel-menu";
    menu.setAttribute("role", "menu");
    menu.append(
      item("Expand all", () => setAll(true)),
      item("Collapse all", () => setAll(false)),
      Object.assign(document.createElement("div"), { className: "panel-menu-sep" }),
      item("Expand one at a time", () => setOneAtATime(!oneAtATime, t && isOpen(t) ? t : null), {
        checked: oneAtATime,
        title: "When ticked, opening a panel closes the others",
      }),
    );
    document.body.appendChild(menu);
    // inside the window
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    menu.querySelector("button")?.focus();
  }

  document.addEventListener("contextmenu", (e) => {
    const header = e.target.closest?.(".sidebar > .panel > .panel-header");
    if (!header) return;
    e.preventDefault();
    const t = header.querySelector(".panel-toggle");
    // from the keyboard (Menu key / Shift+F10) the event has no mouse position: open under the title
    const r = header.getBoundingClientRect();
    const fromKeys = e.clientX === 0 && e.clientY === 0;
    open(fromKeys ? r.left + 12 : e.clientX, fromKeys ? r.bottom : e.clientY, t);
  });
  document.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target)) close(); }, true);
  document.addEventListener("keydown", (e) => {
    if (!menu) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(menu.querySelectorAll(".panel-menu-item"));
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);
  document.querySelector(".sidebar")?.addEventListener("scroll", close, { passive: true });

  // started with "one at a time" on: leave only the first open panel open
  if (oneAtATime) closeOthers(toggles().find((t) => visible(t) && isOpen(t)) || null);

  window.PanelMenu = Object.freeze({ setAll, setOneAtATime, get oneAtATime() { return oneAtATime; } });
})();
