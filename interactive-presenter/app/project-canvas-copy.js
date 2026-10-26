/* Experimental project-canvas renderer.
 * Loaded only by "InteractivePresenter - Copy.html".
 *
 * The deck's reference width/height define the canvas aspect ratio. The canvas
 * is then fitted to the available editor/presenter area, while canvas-native
 * typography uses container units instead of browser-window units.
 */
(() => {
  "use strict";

  if (window.__interactivePresenterProjectCanvasInstalled) return;
  const stage = document.getElementById("stage");
  const scaleInput = document.getElementById("globalContentScaleInput");
  const resolutionSelect = document.getElementById("scaleLockModeSelect");
  const scaleValue = document.getElementById("globalContentScaleValue");
  const scaleHint = document.getElementById("scaleContextHint");
  if (!stage || typeof state === "undefined") return;

  if (scaleInput) {
    scaleInput.dataset.tooltip = "Scale slide content consistently within the fixed project canvas";
    scaleInput.title = "Scale slide content consistently within the fixed project canvas";
  }
  if (resolutionSelect) {
    resolutionSelect.dataset.tooltip = "Set the logical project canvas and aspect ratio used on every display";
    resolutionSelect.title = "Set the logical project canvas and aspect ratio used on every display";
  }

  const clampNumber = (value, min, max, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
  };

  function projectCanvasContext() {
    if (typeof ensureDeckSettings === "function") ensureDeckSettings();
    const settings = state.deck?.settings || {};
    const width = clampNumber(settings.referenceWidth, 320, 7680, 1920);
    const height = clampNumber(settings.referenceHeight, 180, 4320, 1080);
    const contentScale = clampNumber(settings.globalContentScale, 0.5, 2, 1);
    return {
      width,
      height,
      aspect: width / height,
      inverseAspect: height / width,
      contentScale,
    };
  }

  function syncProjectCanvas() {
    const ctx = projectCanvasContext();
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--project-canvas-aspect", String(ctx.aspect));
    rootStyle.setProperty("--project-canvas-inverse-aspect", String(ctx.inverseAspect));
    rootStyle.setProperty("--project-content-scale", String(ctx.contentScale));
    stage.style.aspectRatio = `${ctx.width} / ${ctx.height}`;

    if (scaleValue) {
      scaleValue.textContent = `${Math.round(ctx.contentScale * 100)}%`;
    }
    if (scaleHint) {
      const rect = stage.getBoundingClientRect();
      const fit = rect.width > 0 ? rect.width / ctx.width : 1;
      scaleHint.textContent = `Project canvas ${Math.round(ctx.width)}×${Math.round(ctx.height)}; displayed at ${Math.round(rect.width)}×${Math.round(rect.height)} px; uniform fit ${fit.toFixed(3)}.`;
    }
  }

  // The project canvas now performs the resolution fit. Embedded sources use
  // the same explicit global content-size value, without a second resolution-
  // dependent multiplier that would make them change size on another screen.
  if (typeof getScaleContext === "function") {
    const baseGetScaleContext = getScaleContext;
    getScaleContext = function getProjectCanvasScaleContext() {
      const ctx = baseGetScaleContext();
      return {
        ...ctx,
        effective: ctx.base,
        sourceLabel: "uniform project canvas",
      };
    };
  }

  function rescaleOrdinaryTextBoxes() {
    const slide = typeof currentSlide === "function" ? currentSlide() : null;
    if (!slide || !Array.isArray(slide.textBoxes)) return;
    const ctx = projectCanvasContext();
    const stageWidth = Math.max(1, stage.getBoundingClientRect().width);
    // Existing text-box font sizes were authored against the presenter's
    // original 960px-wide canvas. Keep that visual unit stable when users
    // switch between equivalent resolutions (for example 960x540 and
    // 1920x1080); resolution changes sharpness, not apparent text size.
    const canvasFit = stageWidth / 960;
    const byId = new Map(slide.textBoxes.map((box) => [String(box.id), box]));
    for (const element of stage.querySelectorAll(".text-box")) {
      const box = byId.get(String(element.dataset.textBoxId || ""));
      const content = element.querySelector(".text-box-content");
      if (!box || !content) continue;
      const authoredPx = clampNumber(box.fontSize, 6, 240, 16);
      content.style.fontSize = `${authoredPx * canvasFit * ctx.contentScale}px`;
    }
  }

  if (typeof renderDeckMeta === "function") {
    const baseRenderDeckMeta = renderDeckMeta;
    renderDeckMeta = function renderDeckMetaWithProjectCanvas() {
      baseRenderDeckMeta();
      syncProjectCanvas();
    };
  }

  if (typeof renderStage === "function") {
    const baseRenderStage = renderStage;
    renderStage = function renderStageWithProjectCanvas() {
      syncProjectCanvas();
      baseRenderStage();
      rescaleOrdinaryTextBoxes();
      syncProjectCanvas();
    };
  }

  if (typeof renderThumbnailGrid === "function") {
    const baseRenderThumbnailGrid = renderThumbnailGrid;
    renderThumbnailGrid = function renderThumbnailGridWithProjectCanvas() {
      syncProjectCanvas();
      baseRenderThumbnailGrid();
    };
  }

  const style = document.createElement("style");
  style.id = "interactivePresenterProjectCanvasStyles";
  style.textContent = `
    #stage,
    .thumb-inner-stage {
      container-type: inline-size;
    }

    #stage {
      aspect-ratio: var(--project-canvas-aspect, 1.7777778);
    }

    body.present-mode #stage {
      width: min(100vw, calc(100vh * var(--project-canvas-aspect, 1.7777778)));
      height: min(100vh, calc(100vw * var(--project-canvas-inverse-aspect, .5625)));
      aspect-ratio: var(--project-canvas-aspect, 1.7777778);
    }

    .section-divider-layer .sdv-media-placeholder {
      font-size: calc(clamp(11px, 1.6cqw, 18px) * var(--project-content-scale, 1));
    }
    .section-divider-layer .sdv-eyebrow {
      font-size: calc(clamp(11px, 1.5cqw, 20px) * var(--project-content-scale, 1));
    }
    .section-divider-layer .sdv-title {
      font-size: calc(clamp(22px, 5.2cqw, 74px) * var(--project-content-scale, 1));
    }
    .section-progress {
      gap: calc(clamp(6px, 1.4cqw, 18px) * var(--sp-scale, 1) * var(--project-content-scale, 1));
    }
    .section-progress-item {
      font-size: calc(clamp(9px, 1.35cqw, 17px) * var(--sp-scale, 1) * var(--project-content-scale, 1));
    }

    .summary-eyebrow {
      font-size: calc(clamp(10px, 1.4cqw, 18px) * var(--sum-text-zoom) * var(--project-content-scale, 1));
    }
    .summary-title {
      font-size: calc(clamp(18px, 3.4cqw, 46px) * var(--sum-text-zoom) * var(--project-content-scale, 1));
    }
    .summary-figure-ph {
      font-size: calc(clamp(11px, 1.4cqw, 16px) * var(--project-content-scale, 1));
    }
    .summary-text {
      font-size: calc(clamp(11px, 1.5cqw, 22px) * var(--sum-text-zoom) * var(--project-content-scale, 1));
    }

    .title-page-layer .tp-title {
      font-size: calc(clamp(24px, 5.2cqw, 84px) * var(--project-content-scale, 1));
    }
    .title-page-layer .tp-subtitle {
      font-size: calc(clamp(13px, 2.1cqw, 30px) * var(--project-content-scale, 1));
    }
    .title-page-layer .tp-presenter {
      font-size: calc(clamp(12px, 1.9cqw, 26px) * var(--project-content-scale, 1));
    }
    .title-page-layer .tp-event {
      font-size: calc(clamp(10px, 1.4cqw, 18px) * var(--project-content-scale, 1));
    }
    .title-page-layer .tp-media-placeholder {
      font-size: calc(clamp(11px, 1.6cqw, 18px) * var(--project-content-scale, 1));
    }
    .title-page-layer.tp-poster .tp-title {
      font-size: calc(clamp(28px, 7.2cqw, 108px) * var(--project-content-scale, 1));
    }
    .title-page-layer.tp-poster .tp-subtitle {
      font-size: calc(clamp(14px, 2.5cqw, 32px) * var(--project-content-scale, 1));
    }

    .toc-eyebrow {
      font-size: calc(clamp(11px, 1.4cqw, 18px) * var(--project-content-scale, 1));
    }
    .toc-title {
      font-size: calc(clamp(30px, 5.4cqw, 68px) * var(--project-content-scale, 1));
    }
    .toc-section-number {
      font-size: calc(clamp(13px, 1.8cqw, 24px) * var(--project-content-scale, 1));
    }
    .toc-section-title {
      font-size: calc(clamp(17px, 2.4cqw, 32px) * var(--project-content-scale, 1));
    }
    .toc-many .toc-section-title {
      font-size: calc(clamp(14px, 2cqw, 26px) * var(--project-content-scale, 1));
    }
    .toc-many .toc-section-number {
      font-size: calc(clamp(12px, 1.6cqw, 21px) * var(--project-content-scale, 1));
    }
    .toc-empty {
      font-size: calc(clamp(16px, 2cqw, 25px) * var(--project-content-scale, 1));
    }
    .toc-message {
      font-size: calc(clamp(15px, 1.9cqw, 25px) * var(--project-content-scale, 1));
    }
  `;
  document.head.appendChild(style);

  scaleInput?.addEventListener("input", () => {
    syncProjectCanvas();
    requestAnimationFrame(() => {
      rescaleOrdinaryTextBoxes();
      if (typeof renderThumbnailGrid === "function") renderThumbnailGrid();
    });
  });

  window.addEventListener("resize", () => {
    syncProjectCanvas();
    rescaleOrdinaryTextBoxes();
  });

  syncProjectCanvas();
  if (typeof renderDeckMeta === "function") renderDeckMeta();
  if (typeof renderStage === "function") renderStage();
  if (typeof renderThumbnailGrid === "function") renderThumbnailGrid();
  window.__interactivePresenterProjectCanvasInstalled = true;
})();
