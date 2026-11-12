// Coloured control panel (2026-11-12, Peter's request): every sidebar panel has its own hue, its header bar a
// stronger version of it, and the controls inside are grouped into sub-sections in two alternating shades of the
// panel's light colour, so the right control is found at a glance.
// (loaded last; appX.js has already turned each panel into .panel-header + .panel-body)
//
// Display only: elements are moved into <div class="psub"> wrappers inside their own panel, nothing else
// changes (no ids, no order). The colours are CSS (end of stylesX.css), keyed on --ph (the panel's hue).
(function () {
  "use strict";

  // panel key (its id, or its title in lower case with dashes, as appX's collapse code names it) ->
  // hue (0-360) and the elements that START a sub-section (each selector: the first match in the panel;
  // "all:" = every match). Controls before the first start form the first sub-section.
  const PANELS = {
    deck: { hue: 212, starts: ["all:h3.deck-sub", "details.deck-advanced"] },
    slides: { hue: 132, starts: [".section-slide-controls", "#showSectionDividersToggle", "#slideList"] },
    sectionDividerPanel: { hue: 172, starts: ["#sectionEyebrowVisibleToggle", "#sectionStyleSelect", "#convertToRegularSlideBtn"] },
    tocPanel: { hue: 190, starts: ["#tocTitleInput", "#convertTocToRegularBtn"] },
    summaryPanel: { hue: 44, starts: ["#summaryStyleSelect", "#summaryRemoveCellBtn", ".summary-cell-editor", "#summaryResetLayoutBtn"] },
    titlePanel: { hue: 282, starts: ["#titleStyleSelect", "#titleRemovePresenterBtn", "#titleMediaSelect", "#convertTitleToRegularBtn"] },
    peopleCreditsPanel: { hue: 328, starts: ["#creditsEnabledCheckbox", "#creditsNameStyleSelect", "#creditsScaleRange", "h3.panel-sub"] }, // + the DTU logo (own panel until 2026-11-12)
    "overlay-sources": { hue: 26, starts: ["#addNotesBoardBtn", "#sourceList"] },
    "overlay-editor": { hue: 252, starts: ["#overlaySourceSelect", "#overlayOpacityRange", ".geometry-grid"] },
    animationPanel: { hue: 78, starts: ["#animAutoplayCheckbox", "#animStepStatus", "#animationEventList", "details.animation-diagnostics"] },
  };
  // panels not in the list (added later by other modules): hues that keep away from the ones above
  const SPARE_HUES = [150, 300, 8, 228, 96, 60];

  function keyOf(panel, index) {
    if (panel.dataset.panelKey) return panel.dataset.panelKey;
    const t = panel.querySelector(".panel-toggle")?.getAttribute("data-title") || panel.querySelector("h2")?.textContent || "";
    return panel.id || t.trim().toLowerCase().replace(/\s+/g, "-") || `panel-${index}`;
  }

  // the direct child of `body` that holds `el` (or null)
  function topChild(body, el) {
    let n = el;
    while (n && n.parentElement !== body) n = n.parentElement;
    return n;
  }

  function groupPanel(panel, spec) {
    const body = panel.querySelector(":scope > .panel-body") || panel;
    if (body.querySelector(":scope > .psub")) return; // done already
    const kids = Array.from(body.children).filter((c) => !c.matches("h2, .panel-header"));
    if (!kids.length) return;
    const startSet = new Set();
    for (const sel of spec.starts || []) {
      const all = sel.startsWith("all:");
      const found = all ? Array.from(body.querySelectorAll(sel.slice(4))) : [body.querySelector(sel)].filter(Boolean);
      for (const el of found) { const top = topChild(body, el); if (top) startSet.add(top); }
    }
    const groups = [];
    for (const k of kids) {
      if (!groups.length || startSet.has(k)) groups.push([]);
      groups[groups.length - 1].push(k);
    }
    if (groups.length < 2) return; // one block: the panel colour alone is enough
    groups.forEach((g, i) => {
      const wrap = document.createElement("div");
      wrap.className = `psub psub-${i % 2 ? "b" : "a"}`;
      g[0].before(wrap);
      for (const el of g) wrap.appendChild(el);
    });
  }

  function apply() {
    let spare = 0;
    document.querySelectorAll(".sidebar > .panel").forEach((panel, i) => {
      const spec = PANELS[keyOf(panel, i)] || { hue: SPARE_HUES[spare++ % SPARE_HUES.length], starts: ["all:h3"] };
      panel.style.setProperty("--ph", String(spec.hue));
      panel.dataset.hue = String(spec.hue);
      groupPanel(panel, spec);
    });
  }

  apply();
  window.PanelColors = Object.freeze({ apply, PANELS });
})();
