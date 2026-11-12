/*
 * Inverted slides: a white slide shown black (Invert switch in the slide-title bar above the stage).
 *
 * Per slide (slide.inverted = true), on ordinary slides only: the title page, section dividers,
 * summaries and the overview keep their own designs. Nothing stored is changed, so switching it off
 * shows the slide exactly as before:
 *   - the background picture is drawn through invert + hue-rotate: white -> black, black text ->
 *     white, colours keep their hue; a white canvas slide turns black;
 *   - the slide-title strip turns white-on-black (coloured bands stay as they are);
 *   - text boxes whose colour is black or nearly black are drawn white (coloured text stays);
 *   - a black DTU logo turns white; credits and references flip their own invert setting.
 * Loaded after appX.js and slide-transfer.js; wraps renderStage, renderThumbnailGrid and
 * renderSlideTitleBar like the other add-ons do.
 */
(function () {
  "use strict";
  if (window.__ipSlideInvertInstalled) return;
  if (typeof renderStage !== "function" || typeof renderThumbnailGrid !== "function") return;
  window.__ipSlideInvertInstalled = true;

  const canInvert = (slide) => (typeof slideSupportsTitle === "function" ? slideSupportsTitle(slide) : !!slide && !slide.type);
  const isInverted = (slide) => canInvert(slide) && slide.inverted === true;

  // "rgb(r, g, b)" / "#rrggbb" / "#rgb" -> true when the colour is black or nearly so
  function isDarkInk(color) {
    const c = String(color || "").trim().toLowerCase();
    if (!c || c === "black") return true;
    let r, g, b;
    let m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) [r, g, b] = [+m[1], +m[2], +m[3]];
    else if ((m = c.match(/^#([0-9a-f]{6})$/))) [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    else if ((m = c.match(/^#([0-9a-f]{3})$/))) [r, g, b] = [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16));
    else return false;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70;
  }

  // ---- the stage
  function invertStage() {
    const stage = dom?.stage;
    if (!stage) return;
    const slide = typeof currentSlide === "function" ? currentSlide() : null;
    const on = isInverted(slide) && !(state.mode === "present" && state.showPresenterEndScreen);
    stage.classList.toggle("slide-inverted", on);
    if (!on) return;
    // text boxes in the default (dark) ink: a class on the box, never on the editable text inside,
    // so editing on an inverted slide cannot write the white into the stored text
    for (const el of stage.querySelectorAll(".overlay-text-editable")) {
      el.classList.toggle("inv-ink", isDarkInk(el.style.color));
    }
  }
  // the logo (black -> white; red and white stay) and the credits / acknowledgements / references
  // (drawn from their own invert flags: flipped). Done in their builders, because the credits and
  // references are also re-drawn in place without a renderStage.
  function wrapBuilder(name, fix) {
    if (typeof window[name] !== "function") return;
    const base = window[name];
    window[name] = function (slide) {
      const el = base.apply(this, arguments);
      if (el && isInverted(slide)) fix(el);
      return el;
    };
  }
  wrapBuilder("buildSlideLogo", (el) => { if (/^brightness\(0\)$/.test(el.style.filter.trim())) el.style.filter = "brightness(0) invert(1)"; });
  wrapBuilder("buildSlideCreditsLayer", (el) => el.classList.toggle("inverted"));
  wrapBuilder("buildSlideReferencesBar", (el) => el.classList.toggle("inverted"));
  const baseRenderStage = renderStage;
  renderStage = function renderStageWithInvert() {
    baseRenderStage.apply(this, arguments);
    invertStage();
  };

  // ---- the thumbnails
  const baseRenderThumbnailGrid = renderThumbnailGrid;
  renderThumbnailGrid = function renderThumbnailGridWithInvert() {
    baseRenderThumbnailGrid.apply(this, arguments);
    const container = document.getElementById("thumbnailGridContainer");
    if (!container) return;
    for (const item of container.querySelectorAll(".thumbnail-item")) {
      const slide = state.deck?.slides?.[Number(item.dataset.slideIndex)];
      const inner = item.querySelector(".thumb-inner-stage");
      if (!inner) continue;
      const on = isInverted(slide);
      inner.classList.toggle("slide-inverted", on);
      item.classList.toggle("thumb-inverted", on);
      if (!on) continue;
      const bg = inner.firstElementChild;
      if (bg && bg.tagName === "IMG") bg.classList.add("inv-bg");
      for (const el of inner.querySelectorAll(":scope > div")) {
        if (el.style.color && isDarkInk(el.style.color)) el.style.color = "#ffffff";
      }
    }
  };

  // ---- the switch, in the slide-title bar (shown for the same slides that can be inverted)
  const bar = document.getElementById("slideTitleBar");
  let toggle = null;
  if (bar) {
    const label = document.createElement("label");
    label.className = "slide-title-toggle slide-invert-toggle";
    label.title = "Invert this slide: white background to black, the title and dark text to white (per slide; nothing stored is changed)";
    label.innerHTML = '<input id="slideInvertToggle" type="checkbox" /><span>◐ Invert</span>';
    bar.appendChild(label);
    toggle = label.querySelector("input");
    toggle.addEventListener("change", () => {
      const slide = currentSlide();
      if (!canInvert(slide)) return;
      if (toggle.checked) slide.inverted = true;
      else delete slide.inverted;
      if (typeof touch === "function") touch();
      renderStage();
      renderThumbnailGrid();
    });
  }
  if (typeof renderSlideTitleBar === "function") {
    const baseRenderSlideTitleBar = renderSlideTitleBar;
    renderSlideTitleBar = function renderSlideTitleBarWithInvert() {
      baseRenderSlideTitleBar.apply(this, arguments);
      const slide = typeof currentSlide === "function" ? currentSlide() : null;
      if (toggle) toggle.checked = isInverted(slide);
    };
  }

  // for tests and the console
  window.ipSlideInvert = {
    isInverted,
    set(index, on) {
      const slide = state.deck?.slides?.[index];
      if (!canInvert(slide)) return false;
      if (on) slide.inverted = true; else delete slide.inverted;
      if (typeof touch === "function") touch();
      renderStage(); renderThumbnailGrid(); renderSlideTitleBar();
      return true;
    },
  };
  try { renderStage(); renderThumbnailGrid(); renderSlideTitleBar(); } catch { /* the deck is not loaded yet */ }
})();
