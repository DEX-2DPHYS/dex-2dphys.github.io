/* Extensions for InteractivePresenter.html: individual slide packages,
 * white-slide creation, and title typography. Kept separate from app14.js so
 * the preserved v1 presenter remains unchanged. */
(() => {
  "use strict";

  const PACKAGE_TYPE = "interactive-presenter-slide";
  const PACKAGE_VERSION = 1;
  const MAX_COMPRESSED_BYTES = 512 * 1024 * 1024;
  const MAX_UNCOMPRESSED_BYTES = 1536 * 1024 * 1024;
  const MAX_ARCHIVE_ENTRIES = 5000;
  const MAX_ASSETS = 1000;
  const MAX_OVERLAYS = 1000;
  const BACKUP_INTERVAL_MS = 30_000;
  const FILE_HANDLE_DB_NAME = "InteractivePresenterFileHandles";
  const FILE_HANDLE_STORE_NAME = "handles";
  const FILE_HANDLE_DB_VERSION = 1;
  const WHITE_SLIDE_WIDTH = 1920;
  const WHITE_SLIDE_HEIGHT = 1080;
  const SPECIAL_SOURCE_IDS = new Set(["", "__canvas__"]);
  const TITLE_FONT_STACKS = Object.freeze({
    system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    arial: 'Arial, Helvetica, sans-serif',
    verdana: 'Verdana, Geneva, sans-serif',
    trebuchet: '"Trebuchet MS", Arial, sans-serif',
    georgia: 'Georgia, "Times New Roman", serif',
    times: '"Times New Roman", Times, serif',
  });
  const LOGO_SCALE_UNIT_KEY = "logoScaleUnit";
  const LOGO_HEIGHT_UNIT = "height";
  const DEFAULT_LOGO_HEIGHT_SCALE = 0.08;
  const MIN_LOGO_HEIGHT_SCALE = 0.01;
  const MAX_LOGO_HEIGHT_SCALE = 0.2;
  // Intrinsic dimensions of DTUlogo.png. Used only to preserve the displayed
  // size when an older deck's width-based setting is first migrated.
  const DTU_LOGO_ASPECT_RATIO = 300 / 438;

  const importInput = document.getElementById("importSlidePackageInput");
  const thumbnailContainer = document.getElementById("thumbnailGridContainer");
  const addWhiteSlideButton = document.getElementById("addWhiteSlideBtn");
  const addTocSlideButton = document.getElementById("addTocSlideBtn");
  const tocPanel = document.getElementById("tocPanel");
  const tocTitleInput = document.getElementById("tocTitleInput");
  const tocMessageInput = document.getElementById("tocMessageInput");
  const convertTocToRegularButton = document.getElementById("convertTocToRegularBtn");
  const showSectionDividersToggle = document.getElementById("showSectionDividersToggle");
  const ordinarySectionProgressToggle = document.getElementById("ordinarySectionProgressToggle");
  const titleFontSelect = document.getElementById("titleFontSelect");
  const titleBoldToggle = document.getElementById("titleBoldToggle");

  let restoredBackupNeedsPermission = false;

  function currentDeckHandleKey(kind) {
    const deckId = String(state.deck?.meta?.deckId || "").trim();
    return deckId ? `${kind}:${deckId}` : "";
  }

  function openFileHandleDatabase() {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(FILE_HANDLE_DB_NAME, FILE_HANDLE_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(FILE_HANDLE_STORE_NAME)) {
          database.createObjectStore(FILE_HANDLE_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the file-handle store."));
    });
  }

  async function readStoredFileHandle(kind) {
    const key = currentDeckHandleKey(kind);
    if (!key) return null;
    const database = await openFileHandleDatabase();
    if (!database) return null;
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(FILE_HANDLE_STORE_NAME, "readonly");
        const request = transaction.objectStore(FILE_HANDLE_STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result?.handle || null);
        request.onerror = () => reject(request.error || new Error("Could not read the saved file handle."));
      });
    } finally {
      database.close();
    }
  }

  async function storeFileHandle(kind, handle) {
    const key = currentDeckHandleKey(kind);
    if (!key || !handle) return;
    const database = await openFileHandleDatabase();
    if (!database) return;
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(FILE_HANDLE_STORE_NAME, "readwrite");
        transaction.objectStore(FILE_HANDLE_STORE_NAME).put({ handle, updatedAt: Date.now() }, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not retain the file handle."));
        transaction.onabort = () => reject(transaction.error || new Error("Retaining the file handle was aborted."));
      });
    } finally {
      database.close();
    }
  }

  async function forgetStoredFileHandle(kind) {
    const key = currentDeckHandleKey(kind);
    if (!key) return;
    const database = await openFileHandleDatabase();
    if (!database) return;
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(FILE_HANDLE_STORE_NAME, "readwrite");
        transaction.objectStore(FILE_HANDLE_STORE_NAME).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not clear the retained file handle."));
      });
    } finally {
      database.close();
    }
  }

  async function fileHandlePermission(handle, { request = false } = {}) {
    if (!handle) return "denied";
    const options = { mode: "readwrite" };
    try {
      if (typeof handle.queryPermission === "function") {
        const current = await handle.queryPermission(options);
        if (current === "granted" || !request) return current;
      }
      if (request && typeof handle.requestPermission === "function") {
        return await handle.requestPermission(options);
      }
      // Older implementations expose writable handles without the explicit
      // permission helpers. Let createWritable() be the final authority.
      return "granted";
    } catch {
      return "denied";
    }
  }

  function reportHandlePersistenceError(action, error) {
    console.warn(`Could not ${action} the presenter file handle:`, error);
  }

  function applyAuthoritativePresentationRoot(rootUrl) {
    const root = String(rootUrl || "").trim();
    if (!root || !/^file:/i.test(root)) return false;
    state.deck.settings = state.deck.settings || {};
    state.presentationRootFileUrl = root.endsWith("/") ? root : `${root}/`;
    const relative = typeof computePresenterRelativeFromAbsolute === "function"
      ? computePresenterRelativeFromAbsolute(state.presentationRootFileUrl)
      : "";
    state.deck.settings.presentationRootPath = relative || state.presentationRootFileUrl;
    if (typeof savePresentationRootToLocalStorage === "function") {
      savePresentationRootToLocalStorage(
        state.deck.meta?.title || "",
        state.deck.settings.presentationRootPath,
        state.currentZipFileHandle?.name || "",
      );
    }
    return true;
  }

  function presentationRootFromLoadedFile(file, options = {}) {
    const pathCandidate = String(options?.zipPath || file?.path || "").trim();
    if (!pathCandidate || typeof toFileUrl !== "function") return "";
    const fileUrl = toFileUrl(pathCandidate);
    if (!/^file:/i.test(fileUrl)) return "";
    try {
      return new URL("./", fileUrl).href;
    } catch {
      return "";
    }
  }

  function presentationRootFromSelectedSim(file) {
    if (typeof getSelectedHtmlFileReferenceUrl !== "function") return "";
    const directUrl = getSelectedHtmlFileReferenceUrl(file);
    if (!/^file:/i.test(directUrl)) return "";
    try {
      const parsed = new URL(directUrl);
      const decodedPath = decodeURIComponent(parsed.pathname).replace(/\\/g, "/");
      const markerIndex = decodedPath.toLowerCase().lastIndexOf("/sims/");
      if (markerIndex < 0) return "";
      parsed.pathname = decodedPath.slice(0, markerIndex + 1);
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function setTransferStatus(message) {
    if (typeof dom !== "undefined" && dom.modeHint) {
      dom.modeHint.textContent = message;
    }
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function whiteSlideDataUrl() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WHITE_SLIDE_WIDTH}" height="${WHITE_SLIDE_HEIGHT}" viewBox="0 0 ${WHITE_SLIDE_WIDTH} ${WHITE_SLIDE_HEIGHT}"><rect width="100%" height="100%" fill="#ffffff"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function repairExtensionWhiteSlideCanvases() {
    const assets = state.deck?.assets || {};
    const correctedDataUrl = whiteSlideDataUrl();
    let repaired = 0;
    for (const asset of Object.values(assets)) {
      if (asset?.kind !== "slide-image" || asset.name !== "blank-white-slide.svg") continue;
      if (asset.dataUrl === correctedDataUrl) continue;
      asset.mime = "image/svg+xml";
      asset.dataUrl = correctedDataUrl;
      repaired += 1;
    }
    for (const slide of state.deck?.slides || []) {
      const asset = typeof resolveAssetByAnyId === "function"
        ? resolveAssetByAnyId(slide?.slideAssetId)
        : assets[slide?.slideAssetId];
      const isCreatedWhiteSlide = asset?.name === "blank-white-slide.svg";
      const isLegacyBlankSlide = !slide?.type
        && !slide?.slideAssetId
        && /^Blank slide(?: \d+)?$/i.test(String(slide?.name || ""));
      if (!isCreatedWhiteSlide && !isLegacyBlankSlide) continue;
      if (slide.canvasBackground !== "#ffffff") {
        slide.canvasBackground = "#ffffff";
        repaired += 1;
      }
    }
    return repaired;
  }

  // An actual background image always wins over the canvasBackground flag. That
  // flag is set when the slide is created as a white canvas and is never cleared,
  // so a slide whose background was later overwritten still carried it — and the
  // white canvas layer, being absolutely positioned, painted over the new image
  // on the stage while the thumbnail (which only tints its container) showed it.
  function isWhiteCanvasSlide(slide) {
    if (!slide || slide.type) return false;
    const asset = typeof resolveAssetByAnyId === "function"
      ? resolveAssetByAnyId(slide.slideAssetId)
      : state.deck?.assets?.[slide.slideAssetId];
    if (asset) return asset.name === "blank-white-slide.svg";
    return String(slide.canvasBackground || "").toLowerCase() === "#ffffff";
  }

  function presenterUid() {
    if (typeof uid === "function") {
      return uid();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeTitleFontKey(value) {
    const key = String(value || "system").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(TITLE_FONT_STACKS, key) ? key : "system";
  }

  function ensureTitleTypographyDefaults(slide) {
    if (!slide || slide.type !== "title-page") return slide;
    slide.titleFont = normalizeTitleFontKey(slide.titleFont);
    slide.titleBold = slide.titleBold !== false;
    return slide;
  }

  function applyTitleTypography(block, slide) {
    ensureTitleTypographyDefaults(slide);
    const title = block?.querySelector?.(".tp-title");
    if (!title) return block;
    title.style.fontFamily = TITLE_FONT_STACKS[slide.titleFont];
    title.style.fontWeight = slide.titleBold ? "800" : "400";
    return block;
  }

  function syncTitleTypographyControls() {
    if (typeof currentSlide !== "function") return;
    const slide = currentSlide();
    if (!slide || slide.type !== "title-page") return;
    ensureTitleTypographyDefaults(slide);
    if (titleFontSelect) titleFontSelect.value = slide.titleFont;
    if (titleBoldToggle) titleBoldToggle.checked = slide.titleBold;
  }

  function updateCurrentTitleTypography(mutate) {
    if (typeof currentSlide !== "function") return;
    const slide = currentSlide();
    if (!slide || slide.type !== "title-page") return;
    ensureTitleTypographyDefaults(slide);
    mutate(slide);
    ensureTitleTypographyDefaults(slide);
    if (typeof touch === "function") touch();
    if (typeof renderStage === "function") renderStage();
    if (typeof renderThumbnailGrid === "function") renderThumbnailGrid();
    syncTitleTypographyControls();
  }

  function installTitleTypographyHooks() {
    if (window.__interactivePresenterTitleTypographyInstalled) return;

    if (typeof normalizeTitleSlide === "function") {
      const baseNormalizeTitleSlide = normalizeTitleSlide;
      normalizeTitleSlide = function normalizeTitleSlideWithTypography(slide) {
        baseNormalizeTitleSlide(slide);
        ensureTitleTypographyDefaults(slide);
      };
    }

    if (typeof buildTitleTextBlock === "function") {
      const baseBuildTitleTextBlock = buildTitleTextBlock;
      buildTitleTextBlock = function buildTitleTextBlockWithTypography(slide) {
        return applyTitleTypography(baseBuildTitleTextBlock(slide), slide);
      };
    }

    if (typeof renderTitleControls === "function") {
      const baseRenderTitleControls = renderTitleControls;
      renderTitleControls = function renderTitleControlsWithTypography() {
        baseRenderTitleControls();
        syncTitleTypographyControls();
      };
    }

    window.__interactivePresenterTitleTypographyInstalled = true;
  }

  function clampLogoHeightScale(value, fallback = DEFAULT_LOGO_HEIGHT_SCALE) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(MAX_LOGO_HEIGHT_SCALE, Math.max(MIN_LOGO_HEIGHT_SCALE, numeric));
  }

  function migrateLogoWidthScaleToHeight(scale, deck) {
    const width = Number(deck?.settings?.referenceWidth) || 960;
    const height = Number(deck?.settings?.referenceHeight) || 640;
    const slideAspectRatio = width / height;
    return clampLogoHeightScale(Number(scale) * slideAspectRatio / DTU_LOGO_ASPECT_RATIO);
  }

  function installLogoHeightScalingHooks() {
    if (window.__interactivePresenterLogoHeightScalingInstalled) return;
    if (typeof ensureDeckLogoSettings !== "function") return;

    const baseEnsureDeckLogoSettings = ensureDeckLogoSettings;
    ensureDeckLogoSettings = function ensureDeckLogoHeightSettings(deck = state.deck) {
      if (!deck || typeof deck !== "object") return;
      deck.settings = deck.settings || {};

      const rawLogo = deck.settings.logo && typeof deck.settings.logo === "object"
        ? deck.settings.logo
        : null;
      const rawScale = rawLogo?.scale;
      const alreadyHeightBased = deck.settings[LOGO_SCALE_UNIT_KEY] === LOGO_HEIGHT_UNIT;
      const wasUntouchedDefault = rawLogo
        && rawLogo.enabled !== true
        && Math.abs(Number(rawScale) - 0.1) < 0.000001;

      const logo = baseEnsureDeckLogoSettings(deck);
      if (!logo) return logo;

      if (alreadyHeightBased) {
        // Restore values below the old core's 3% lower bound after it has
        // normalized the rest of the logo settings.
        logo.scale = clampLogoHeightScale(rawScale);
      } else if (!rawLogo || wasUntouchedDefault) {
        logo.scale = DEFAULT_LOGO_HEIGHT_SCALE;
      } else {
        logo.scale = migrateLogoWidthScaleToHeight(rawScale, deck);
      }
      deck.settings[LOGO_SCALE_UNIT_KEY] = LOGO_HEIGHT_UNIT;
      return logo;
    };

    if (typeof buildSlideLogo === "function") {
      const baseBuildSlideLogo = buildSlideLogo;
      buildSlideLogo = function buildSlideLogoByHeight(slide, slideIndex) {
        const element = baseBuildSlideLogo(slide, slideIndex);
        if (!element) return element;
        const logo = ensureDeckLogoSettings(state.deck);
        element.style.width = "auto";
        element.style.height = `${logo.scale * 100}%`;
        return element;
      };
    }

    window.__interactivePresenterLogoHeightScalingInstalled = true;
  }

  function isTocSlide(slide) {
    return !!slide && slide.type === "toc";
  }

  function normalizeTocSlide(slide) {
    if (!isTocSlide(slide)) return slide;
    slide.uid = slide.uid || presenterUid();
    slide.name = typeof slide.name === "string" && slide.name.trim() ? slide.name : "Overview";
    slide.tocTitle = typeof slide.tocTitle === "string" ? slide.tocTitle : "Overview";
    slide.tocMessage = typeof slide.tocMessage === "string" ? slide.tocMessage : "";
    slide.slideAssetId = "";
    slide.overlays = Array.isArray(slide.overlays) ? slide.overlays : [];
    slide.textBoxes = Array.isArray(slide.textBoxes) ? slide.textBoxes : [];
    return slide;
  }

  function getTocSections() {
    const slides = Array.isArray(state.deck?.slides) ? state.deck.slides : [];
    const numbered = [];
    const allDividers = [];
    slides.forEach((slide, index) => {
      if (slide?.type !== "section-divider") return;
      const entry = {
        index,
        title: String(slide.titleLong || slide.name || "Untitled section").trim() || "Untitled section",
        shortTitle: String(slide.titleShort || "").trim(),
      };
      allDividers.push(entry);
      if (String(slide.sectionRole || "section") === "section") numbered.push(entry);
    });
    // Older decks may not have sectionRole. In the unlikely event that every
    // divider was explicitly classified as front/end matter, showing them is
    // still more useful than an empty overview.
    return numbered.length ? numbered : allDividers;
  }

  function createTocSlide() {
    const slide = typeof createSlide === "function"
      ? createSlide("", "Overview", "", 0)
      : { uid: presenterUid(), name: "Overview", slideAssetId: "", overlays: [], textBoxes: [] };
    slide.type = "toc";
    slide.tocTitle = "Overview";
    slide.tocMessage = "";
    return normalizeTocSlide(slide);
  }

  function addTocSlideAfterCurrent() {
    if (!state.deck || !Array.isArray(state.deck.slides)) return;
    const slide = createTocSlide();
    const insertAt = Math.min(Math.max(Number(state.currentSlideIndex) + 1, 0), state.deck.slides.length);
    state.deck.slides.splice(insertAt, 0, slide);
    state.currentSlideIndex = insertAt;
    state.selectedOverlayId = null;
    state.animationStepIndex = -1;
    if (typeof touch === "function") touch();
    if (typeof renderAll === "function") renderAll();
  }

  function convertCurrentTocToRegular() {
    if (typeof currentSlide !== "function") return;
    const slide = currentSlide();
    if (!isTocSlide(slide)) return;
    delete slide.type;
    delete slide.tocTitle;
    delete slide.tocMessage;
    slide.name = slide.name || "Slide";
    if (typeof touch === "function") touch();
    if (typeof renderAll === "function") renderAll();
  }

  function buildTocLayer(slide, { interactive = true } = {}) {
    normalizeTocSlide(slide);
    const sections = getTocSections();
    const layer = document.createElement("div");
    layer.className = `toc-slide-layer${sections.length > 6 ? " toc-many" : ""}`;

    const eyebrow = document.createElement("div");
    eyebrow.className = "toc-eyebrow";
    eyebrow.textContent = "CONTENTS";
    layer.appendChild(eyebrow);

    const title = document.createElement("div");
    title.className = "toc-title";
    title.textContent = slide.tocTitle || "Overview";
    layer.appendChild(title);

    const rule = document.createElement("div");
    rule.className = "toc-rule";
    layer.appendChild(rule);

    const list = document.createElement("div");
    list.className = "toc-section-list";
    if (!sections.length) {
      const empty = document.createElement("div");
      empty.className = "toc-empty";
      empty.textContent = "Add section-divider slides to populate this overview.";
      list.appendChild(empty);
    } else {
      sections.forEach((section, sectionNumber) => {
        const item = document.createElement("div");
        item.className = "toc-section-item";
        const number = document.createElement("span");
        number.className = "toc-section-number";
        number.textContent = String(sectionNumber + 1).padStart(2, "0");
        const text = document.createElement("span");
        text.className = "toc-section-title";
        text.textContent = section.title;
        item.append(number, text);
        if (interactive && typeof gotoSlide === "function") {
          item.classList.add("is-clickable");
          item.title = `Go to section ${sectionNumber + 1}: ${section.title}`;
          item.addEventListener("click", (event) => {
            event.stopPropagation();
            gotoSlide(section.index);
          });
        }
        list.appendChild(item);
      });
    }
    layer.appendChild(list);

    if (slide.tocMessage.trim()) {
      const message = document.createElement("div");
      message.className = "toc-message";
      message.textContent = slide.tocMessage.trim();
      layer.appendChild(message);
    }
    return layer;
  }

  function syncTocControls() {
    if (typeof currentSlide !== "function") return;
    const slide = currentSlide();
    const active = isTocSlide(slide);
    if (tocPanel) tocPanel.hidden = !active;
    if (!active) return;
    normalizeTocSlide(slide);
    if (tocTitleInput && document.activeElement !== tocTitleInput) tocTitleInput.value = slide.tocTitle;
    if (tocMessageInput && document.activeElement !== tocMessageInput) tocMessageInput.value = slide.tocMessage;
  }

  function installTocHooks() {
    if (window.__interactivePresenterTocInstalled) return;

    if (typeof renderSectionControls === "function") {
      const baseRenderSectionControls = renderSectionControls;
      renderSectionControls = function renderSectionControlsWithToc() {
        baseRenderSectionControls();
        syncTocControls();
      };
    }

    if (typeof renderStage === "function") {
      const baseRenderStage = renderStage;
      renderStage = function renderStageWithToc() {
        baseRenderStage();
        const slide = typeof currentSlide === "function" ? currentSlide() : null;
        if (!isTocSlide(slide) || !dom?.stage) return;
        const layer = buildTocLayer(slide, { interactive: true });
        dom.stage.insertBefore(layer, dom.stage.firstChild);
      };
    }

    if (typeof renderThumbnailGrid === "function") {
      const baseRenderThumbnailGrid = renderThumbnailGrid;
      renderThumbnailGrid = function renderThumbnailGridWithToc() {
        baseRenderThumbnailGrid();
        if (!thumbnailContainer) return;
        for (const item of thumbnailContainer.querySelectorAll(".thumbnail-item")) {
          const index = Number(item.dataset.slideIndex);
          const slide = state.deck?.slides?.[index];
          if (!isTocSlide(slide)) continue;
          item.classList.add("is-toc");
          const inner = item.querySelector(".thumb-inner-stage");
          if (!inner || inner.querySelector(".toc-slide-layer")) continue;
          inner.style.background = "#ffffff";
          inner.insertBefore(buildTocLayer(slide, { interactive: false }), inner.firstChild);
        }
      };
    }

    if (typeof renderSlideList === "function") {
      const baseRenderSlideList = renderSlideList;
      renderSlideList = function renderSlideListWithToc() {
        baseRenderSlideList();
        if (!dom?.slideList) return;
        const tocIndexes = new Set();
        state.deck?.slides?.forEach((slide, index) => { if (isTocSlide(slide)) tocIndexes.add(index + 1); });
        for (const row of dom.slideList.querySelectorAll("li")) {
          const label = row.querySelector(".slide-label");
          const match = label?.textContent?.match(/^(\d+)\./);
          if (!match || !tocIndexes.has(Number(match[1]))) continue;
          row.classList.add("slide-toc");
          label.textContent = label.textContent.replace(/ \(\d+ overlays\)$/, "");
        }
      };
    }

    window.__interactivePresenterTocInstalled = true;
  }

  function installWhiteSlideCanvasHooks() {
    if (window.__interactivePresenterWhiteCanvasInstalled) return;

    if (typeof renderStage === "function") {
      const baseRenderStage = renderStage;
      renderStage = function renderStageWithWhiteCanvas() {
        baseRenderStage();
        const slide = typeof currentSlide === "function" ? currentSlide() : null;
        if (!isWhiteCanvasSlide(slide) || !dom?.stage) return;
        const canvas = document.createElement("div");
        canvas.className = "blank-white-slide-canvas";
        canvas.setAttribute("aria-hidden", "true");
        dom.stage.insertBefore(canvas, dom.stage.firstChild);
      };
    }

    if (typeof renderThumbnailGrid === "function") {
      const baseRenderThumbnailGrid = renderThumbnailGrid;
      renderThumbnailGrid = function renderThumbnailGridWithWhiteCanvases() {
        baseRenderThumbnailGrid();
        if (!thumbnailContainer) return;
        for (const item of thumbnailContainer.querySelectorAll(".thumbnail-item")) {
          const slide = state.deck?.slides?.[Number(item.dataset.slideIndex)];
          if (!isWhiteCanvasSlide(slide)) continue;
          const inner = item.querySelector(".thumb-inner-stage");
          if (inner) inner.style.background = "#ffffff";
        }
      };
    }

    // Ctrl/Cmd+N uses the presenter's original blank-slide command. Route it
    // through the same white-slide creator so both entry points behave alike.
    if (typeof addBlankSlideAfterIndex === "function") {
      addBlankSlideAfterIndex = function addWhiteSlideAfterIndex(index) {
        addEmptyWhiteSlide(index);
      };
    }

    window.__interactivePresenterWhiteCanvasInstalled = true;
  }

  function ensureSectionPlaybackSettings() {
    if (!state.deck || typeof state.deck !== "object") return;
    state.deck.settings = state.deck.settings || {};
    state.deck.settings.showSectionDividers = state.deck.settings.showSectionDividers !== false;
    state.deck.settings.showSectionProgress = state.deck.settings.showSectionProgress !== false;
    state.deck.settings.showSectionProgressOnOrdinarySlides = state.deck.settings.showSectionProgressOnOrdinarySlides === true;
  }

  function shouldSkipSectionDividerInPresentation(slide) {
    ensureSectionPlaybackSettings();
    return state.mode === "present"
      && state.deck.settings.showSectionDividers === false
      && slide?.type === "section-divider";
  }

  function isOrdinarySlideForSectionProgress(slide) {
    if (!slide) return false;
    if (["section-divider", "title-page", "summary", "toc"].includes(slide.type)) return false;
    // Acknowledgements are composed on otherwise regular slides, so exclude
    // those explicitly set to acknowledgement mode as requested.
    if (slide.credits?.mode === "ack") return false;
    return true;
  }

  function findSectionDividerForSlide(slide) {
    const slides = Array.isArray(state.deck?.slides) ? state.deck.slides : [];
    let index = slides.indexOf(slide);
    if (index < 0) return null;
    for (; index >= 0; index -= 1) {
      if (slides[index]?.type === "section-divider") return slides[index];
    }
    return null;
  }

  function syncSectionPlaybackControls() {
    ensureSectionPlaybackSettings();
    if (showSectionDividersToggle) {
      showSectionDividersToggle.checked = state.deck.settings.showSectionDividers;
    }
    if (ordinarySectionProgressToggle) {
      ordinarySectionProgressToggle.checked = state.deck.settings.showSectionProgressOnOrdinarySlides;
    }
  }

  function installSectionPlaybackHooks() {
    if (window.__interactivePresenterSectionPlaybackInstalled) return;
    ensureSectionPlaybackSettings();

    if (typeof nextVisibleSlideIndex === "function") {
      const baseNextVisibleSlideIndex = nextVisibleSlideIndex;
      nextVisibleSlideIndex = function nextPresentableSlideIndex(fromIndex, direction) {
        let candidate = baseNextVisibleSlideIndex(fromIndex, direction);
        while (candidate >= 0 && shouldSkipSectionDividerInPresentation(state.deck.slides[candidate])) {
          candidate = baseNextVisibleSlideIndex(candidate, direction);
        }
        return candidate;
      };
    }

    if (typeof gotoSlide === "function") {
      const baseGotoSlide = gotoSlide;
      gotoSlide = function gotoPresentableSlide(index) {
        let target = Number(index);
        if (Number.isInteger(target) && shouldSkipSectionDividerInPresentation(state.deck.slides[target])) {
          const forward = typeof nextVisibleSlideIndex === "function" ? nextVisibleSlideIndex(target, 1) : -1;
          const backward = typeof nextVisibleSlideIndex === "function" ? nextVisibleSlideIndex(target, -1) : -1;
          target = forward >= 0 ? forward : backward;
          if (target < 0) return;
        }
        return baseGotoSlide(target);
      };
    }

    if (typeof setMode === "function") {
      const baseSetMode = setMode;
      setMode = function setModeWithOptionalDividers(mode) {
        baseSetMode(mode);
        if (mode !== "present" || !shouldSkipSectionDividerInPresentation(currentSlide?.())) return;
        const forward = nextVisibleSlideIndex(state.currentSlideIndex, 1);
        const backward = nextVisibleSlideIndex(state.currentSlideIndex, -1);
        const target = forward >= 0 ? forward : backward;
        if (target >= 0) {
          state.currentSlideIndex = target;
          state.animationStepIndex = -1;
          if (typeof renderStage === "function") renderStage();
        }
      };
    }

    if (typeof renderStage === "function") {
      const baseRenderStage = renderStage;
      renderStage = function renderStageWithOrdinarySectionProgress() {
        baseRenderStage();
        ensureSectionPlaybackSettings();
        const slide = typeof currentSlide === "function" ? currentSlide() : null;
        if (!state.deck.settings.showSectionProgressOnOrdinarySlides
            || !isOrdinarySlideForSectionProgress(slide)
            || !dom?.stage
            || typeof buildSectionProgressStrip !== "function") return;
        const anchor = findSectionDividerForSlide(slide);
        const strip = buildSectionProgressStrip(anchor);
        if (!strip) return;
        strip.classList.add("ordinary-section-progress");
        dom.stage.appendChild(strip);
      };
    }

    if (typeof renderSectionControls === "function") {
      const baseRenderSectionControls = renderSectionControls;
      renderSectionControls = function renderSectionPlaybackControls() {
        baseRenderSectionControls();
        syncSectionPlaybackControls();
      };
    }

    window.__interactivePresenterSectionPlaybackInstalled = true;
  }

  function installTocStyles() {
    if (document.getElementById("interactivePresenterTocStyles")) return;
    const style = document.createElement("style");
    style.id = "interactivePresenterTocStyles";
    style.textContent = `
      #tocPanel[hidden] { display: none; }
      .blank-white-slide-canvas { position:absolute; inset:0; z-index:0; background:#fff; pointer-events:none; }
      .toc-slide-layer { position:absolute; inset:0; z-index:0; box-sizing:border-box; overflow:hidden; padding:7% 8% 6%; background:#fff; color:#10233b; font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif; display:flex; flex-direction:column; }
      .toc-eyebrow { color:#990000; font-size:clamp(11px,1.4vw,18px); line-height:1; font-weight:800; letter-spacing:.18em; }
      .toc-title { margin-top:1.5%; font-size:clamp(30px,5.4vw,68px); line-height:1.04; font-weight:750; letter-spacing:-.025em; }
      .toc-rule { width:10%; height:.7%; min-height:3px; margin:2.6% 0 3.4%; background:#990000; }
      .toc-section-list { display:grid; grid-template-columns:1fr; gap:1.5%; align-content:start; min-height:0; flex:1; }
      .toc-slide-layer.toc-many .toc-section-list { grid-template-columns:1fr 1fr; column-gap:5%; }
      .toc-section-item { display:grid; grid-template-columns:10% 1fr; align-items:baseline; gap:2.5%; padding:1.15% 1.3%; border-bottom:1px solid #d8dee6; box-sizing:border-box; }
      .toc-section-item.is-clickable { cursor:pointer; }
      .toc-section-item.is-clickable:hover { background:#f5f7fa; }
      .toc-section-number { color:#990000; font-size:clamp(13px,1.8vw,24px); line-height:1.15; font-weight:800; font-variant-numeric:tabular-nums; }
      .toc-section-title { font-size:clamp(17px,2.4vw,32px); line-height:1.15; font-weight:650; }
      .toc-many .toc-section-title { font-size:clamp(14px,2vw,26px); }
      .toc-many .toc-section-number { font-size:clamp(12px,1.6vw,21px); }
      .toc-empty { padding:2% 0; color:#687687; font-size:clamp(16px,2vw,25px); font-style:italic; }
      .toc-message { flex:0 0 auto; margin-top:3%; padding:2.1% 2.6%; border-left:7px solid #990000; background:#f2f4f7; font-size:clamp(15px,1.9vw,25px); line-height:1.28; font-weight:600; white-space:pre-wrap; }
      .thumbnail-item.is-toc { box-shadow:inset 0 0 0 2px rgba(153,0,0,.35); }
      .slide-list li.slide-toc { border-left:3px solid #990000; }
      .section-slide-controls { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:5px; }
      .section-slide-controls > button { min-width:0; min-height:34px; padding:5px 2px; border-radius:8px; font-size:.68rem; line-height:1.05; font-weight:700; letter-spacing:-.01em; white-space:nowrap; }
      .section-progress.ordinary-section-progress { z-index:20; padding-top:2.2%; background:linear-gradient(0deg,rgba(255,255,255,.96) 0%,rgba(255,255,255,.88) 48%,rgba(255,255,255,0) 100%); }
      .section-progress.ordinary-section-progress .section-progress-item { color:#526b84; text-shadow:0 1px 0 rgba(255,255,255,.9); }
      .section-progress.ordinary-section-progress .section-progress-item.is-current { color:#990000; }
    `;
    document.head.appendChild(style);
  }

  function installIndependentEditorScrolling() {
    if (document.getElementById("interactivePresenterPinnedLayoutStyles")) return;
    const style = document.createElement("style");
    style.id = "interactivePresenterPinnedLayoutStyles";
    style.textContent = `
      /* Keep the controls available without constraining the workspace's
         height. The earlier viewport-lock approach could collapse the preview
         in some browser/window-size combinations. */
      @media (min-width: 1101px) {
        body:not(.present-mode) > .topbar {
          position: sticky;
          top: 0;
          z-index: 850;
        }
        body:not(.present-mode) > .app {
          align-items: start;
        }
        body:not(.present-mode) .sidebar {
          position: sticky;
          top: 64px;
          height: calc(100vh - 64px);
          max-height: calc(100vh - 64px);
          overflow-y: auto;
          overflow-x: hidden;
          overscroll-behavior: contain;
          scrollbar-gutter: stable;
        }
        body:not(.present-mode) .stage-wrap {
          min-width: 0;
          min-height: calc(100vh - 64px);
          overflow: visible;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // How the currently applied presentation root was obtained, so the UI can say
  // so rather than leaving a wrong-but-plausible folder silently in place.
  let rootProvenance = "";

  // A deck only needs a root if it actually carries convention-relative links.
  // Decks with everything embedded resolve fine without one.
  function deckNeedsPresentationRoot() {
    const assets = (typeof state !== "undefined" && state?.deck?.assets) || null;
    if (!assets) return false;
    for (const asset of Object.values(assets)) {
      const url = String(asset?.url || "").replace(/\\/g, "/");
      if (ROOT_LINK_FOLDER_RE.test(url)) return true; // sims/ html/ pdf/ figures/ movies/ (appX.js)
    }
    return false;
  }

  function installHtmlLinkRootHooks() {
    if (window.__interactivePresenterHtmlLinkRootInstalled) return;

    // An exact ZIP-name or deck-title match is always safe. Borrowing the
    // globally last-used folder is not, so it is used only as a last resort and
    // only for decks that would otherwise have no way to resolve their links —
    // where the alternative is not "no root" but "every link silently falls back
    // to the frozen snapshot taken when it was added". A visibly wrong root can
    // be corrected; a silent snapshot cannot even be noticed.
    if (typeof loadPresentationRootFromLocalStorage === "function") {
      loadPresentationRootFromLocalStorage = function loadPresentationRootWithProvenance(deckTitle, zipFileName = "") {
        rootProvenance = "";
        try {
          const zipKey = `presRoot:zip:${String(zipFileName || "").trim().toLowerCase() || "_default"}`;
          const titleKey = `presRoot:title:${String(deckTitle || "").trim().toLowerCase() || "_default"}`;
          const exact = localStorage.getItem(zipKey) || localStorage.getItem(titleKey) || "";
          if (exact) {
            rootProvenance = "exact";
            return exact;
          }
          if (!deckNeedsPresentationRoot()) return "";
          const borrowed = localStorage.getItem("presRoot:lastUsed") || "";
          if (borrowed) rootProvenance = "borrowed";
          return borrowed;
        } catch {
          return "";
        }
      };
    }

    if (typeof loadDeckZip === "function") {
      const baseLoadDeckZip = loadDeckZip;
      loadDeckZip = async function loadDeckZipWithAuthoritativeFolder(file, options = {}) {
        const loadedFileRoot = presentationRootFromLoadedFile(file, options);
        await baseLoadDeckZip(file, options);
        // When the host exposes the loaded ZIP's real path, its containing
        // folder is authoritative even if the deck contains a stale root.
        if (loadedFileRoot && applyAuthoritativePresentationRoot(loadedFileRoot)) {
          if (typeof touch === "function") touch();
          if (typeof renderDeckMeta === "function") renderDeckMeta();
          if (typeof renderStage === "function") renderStage();
          if (typeof persistLastDeckToStorage === "function") persistLastDeckToStorage();
        }
      };
    }

    if (typeof addHtmlFileLinkFiles === "function") {
      const baseAddHtmlFileLinkFiles = addHtmlFileLinkFiles;
      addHtmlFileLinkFiles = async function addHtmlLinksRelativeToSelectedSimFolder(fileList) {
        const files = Array.from(fileList || []);
        const selectedRoot = files.map(presentationRootFromSelectedSim).find(Boolean) || "";
        if (selectedRoot) {
          applyAuthoritativePresentationRoot(selectedRoot);
        }
        await baseAddHtmlFileLinkFiles(fileList);
        if (selectedRoot && dom?.modeHint) {
          dom.modeHint.textContent = `HTML link added relative to the selected sim's presentation folder: ${state.deck.settings.presentationRootPath}`;
        }
      };
    }

    // A root typed into the box is authoritative, never "borrowed".
    document.getElementById("applyPresentationRootBtn")
      ?.addEventListener("click", () => { rootProvenance = "exact"; }, true);

    // Make the root state legible. app14 reports "links resolve relative to
    // presenter file" when no root is set, but resolveHtmlFileLinkUrl() actually
    // returns "" for sims/-convention paths and the overlay falls back to the
    // stored snapshot — so an unset root has to read as a problem, not a default.
    if (typeof renderDeckMeta === "function") {
      const baseRenderDeckMeta = renderDeckMeta;
      renderDeckMeta = function renderDeckMetaWithRootProvenance() {
        baseRenderDeckMeta();
        const hint = document.getElementById("presentationRootHint");
        if (!hint) return;
        const root = typeof getPresentationRootFileUrl === "function" ? getPresentationRootFileUrl() : "";
        if (root) {
          hint.textContent = rootProvenance === "borrowed"
            ? `Resolved root — borrowed from the last deck you set, verify it: ${root}`
            : `Resolved root: ${root}`;
          hint.style.color = rootProvenance === "borrowed" ? "#b45309" : "";
          hint.style.fontWeight = rootProvenance === "borrowed" ? "600" : "";
        } else if (deckNeedsPresentationRoot()) {
          hint.textContent = "No presentation root set — sims/ links cannot resolve, so they are showing the frozen snapshot taken when they were added, not the live file. Enter the folder that contains sims/ and end it with a slash.";
          hint.style.color = "#b91c1c";
          hint.style.fontWeight = "600";
        } else {
          hint.style.color = "";
          hint.style.fontWeight = "";
        }
      };
    }

    window.__interactivePresenterHtmlLinkRootInstalled = true;
  }

  function installPersistentSaveAndBackupHooks() {
    if (window.__interactivePresenterPersistentSaveInstalled) return;

    if (typeof saveDeckZip === "function") {
      const baseSaveDeckZip = saveDeckZip;
      saveDeckZip = async function saveDeckZipWithRetainedTarget(forceSaveAs = false) {
        // Save As must enter the native picker immediately while the click's
        // user activation is fresh. Plain Save first renews access only when a
        // previously retained target requires it.
        if (!forceSaveAs && state.currentZipFileHandle) {
          const permission = await fileHandlePermission(state.currentZipFileHandle, { request: true });
          if (permission !== "granted") {
            if (dom?.modeHint) dom.modeHint.textContent = "Save permission was not granted. Use Save As to choose a new target.";
            return;
          }
        }
        await baseSaveDeckZip(forceSaveAs);
        if (state.currentZipFileHandle) {
          storeFileHandle("primary", state.currentZipFileHandle)
            .catch((error) => reportHandlePersistenceError("retain", error));
        }
      };
    }

    if (typeof loadDeckZip === "function") {
      const baseLoadDeckZip = loadDeckZip;
      loadDeckZip = async function loadDeckZipWithRetainedTarget(file, options = {}) {
        await baseLoadDeckZip(file, options);
        repairExtensionWhiteSlideCanvases();
        if (state.currentZipFileHandle) {
          storeFileHandle("primary", state.currentZipFileHandle)
            .catch((error) => reportHandlePersistenceError("retain", error));
        } else {
          // A fallback <input type=file> supplies bytes but no writable handle;
          // do not associate an unrelated old target with the loaded deck.
          forgetStoredFileHandle("primary")
            .catch((error) => reportHandlePersistenceError("clear", error));
        }
        await restorePersistentFileHandlesForCurrentDeck({ restorePrimary: false });
      };
    }

    window.__interactivePresenterPersistentSaveInstalled = true;
  }

  let fileHandleRestoreGeneration = 0;
  async function restorePersistentFileHandlesForCurrentDeck({ restorePrimary = true } = {}) {
    const generation = ++fileHandleRestoreGeneration;
    const deckId = String(state.deck?.meta?.deckId || "");
    try {
      const primaryHandle = restorePrimary ? await readStoredFileHandle("primary") : null;
      if (generation !== fileHandleRestoreGeneration || deckId !== String(state.deck?.meta?.deckId || "")) return;
      if (restorePrimary && primaryHandle) {
        const permission = await fileHandlePermission(primaryHandle);
        if (permission === "denied") {
          forgetStoredFileHandle("primary").catch((error) => reportHandlePersistenceError("clear", error));
        } else {
          // A "prompt" state is intentionally retained. The next explicit Save
          // click can renew it without asking the user to pick the file again.
          state.currentZipFileHandle = primaryHandle;
          if (typeof window.__deckPanelFileChanged === "function") window.__deckPanelFileChanged();
        }
      }
      forgetStoredFileHandle("backup").catch(() => {}); // the old on-disk backup target is no longer used
    } catch (error) {
      reportHandlePersistenceError("restore", error);
    }
  }

  function safeFileBase(value) {
    if (typeof sanitizeFileName === "function") {
      return sanitizeFileName(value) || "slide";
    }
    return String(value || "slide")
      .replace(/[\\/]+/g, "-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-._]+|[-._]+$/g, "")
      .slice(0, 80) || "slide";
  }

  function downloadPackage(blob, name) {
    if (typeof downloadBlob === "function") {
      downloadBlob(blob, name);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function findAssetKey(assets, reference) {
    const ref = String(reference || "").trim();
    if (!ref) return "";
    if (Object.prototype.hasOwnProperty.call(assets || {}, ref)) return ref;
    for (const [key, asset] of Object.entries(assets || {})) {
      if (asset && String(asset.id || "") === ref) return key;
    }
    return "";
  }

  function collectSlideDependencyKeys(slide, assets) {
    const keys = new Set();
    const missing = [];
    const addReference = (reference, location, allowSpecial = false) => {
      const ref = String(reference || "").trim();
      if (!ref || (allowSpecial && SPECIAL_SOURCE_IDS.has(ref))) return;
      const key = findAssetKey(assets, ref);
      if (key) keys.add(key); else missing.push(`${location}: ${ref}`);
    };

    addReference(slide?.slideAssetId, "slide background");
    for (const overlay of slide?.overlays || []) {
      addReference(overlay?.sourceId, `overlay ${overlay?.id || "(unnamed)"}`, true);
    }
    for (const item of slide?.summaryItems || []) {
      addReference(item?.assetId, `summary item ${item?.id || "(unnamed)"}`);
    }
    return { keys, missing };
  }

  function collectSlideNotes(slide, notesStore) {
    const notes = {};
    const missing = [];
    for (const overlay of slide?.overlays || []) {
      const key = String(overlay?.notesKey || "").trim();
      if (!key) continue;
      const record = notesStore?.[key];
      if (!record) {
        missing.push(key);
      } else {
        notes[key] = deepClone(record);
      }
    }
    return { notes, missing };
  }

  async function snapshotHtmlDependencies(assets) {
    let bundledRefs = 0;
    let failedRefs = 0;
    const fetchCache = new Map();
    if (typeof inlineRelativeDependenciesInHtml !== "function") {
      return { bundledRefs, failedRefs };
    }
    for (const asset of Object.values(assets || {})) {
      if (!asset || !asset.htmlText || !(
        asset.kind === "overlay-html-file" || asset.kind === "overlay-html-filelink"
      )) continue;
      const bases = typeof getDependencyBaseUrlsForSource === "function"
        ? getDependencyBaseUrlsForSource(asset)
        : [];
      const result = await inlineRelativeDependenciesInHtml(asset.htmlText, bases, fetchCache);
      asset.htmlText = result.htmlText;
      bundledRefs += Number(result.bundledCount || 0);
      failedRefs += Number(result.failedCount || 0);
    }
    return { bundledRefs, failedRefs };
  }

  async function exportSlidePackage(index) {
    try {
      if (!window.JSZip) throw new Error("JSZip is not available.");
      const slide = state.deck?.slides?.[index];
      if (!slide) throw new Error("The selected slide no longer exists.");

      setTransferStatus(`Preparing slide ${index + 1} for export…`);
      const dependencyResult = collectSlideDependencyKeys(slide, state.deck.assets || {});
      if (dependencyResult.missing.length) {
        throw new Error(`Cannot export because references are missing:\n${dependencyResult.missing.join("\n")}`);
      }
      const noteResult = collectSlideNotes(slide, state.deck.notes || {});
      if (noteResult.missing.length) {
        throw new Error(`Cannot export because note records are missing: ${noteResult.missing.join(", ")}`);
      }

      const assets = {};
      for (const key of dependencyResult.keys) {
        assets[key] = deepClone(state.deck.assets[key]);
      }
      const dependencyStats = await snapshotHtmlDependencies(assets);

      const slidePackage = {
        packageType: PACKAGE_TYPE,
        packageVersion: PACKAGE_VERSION,
        deckSchemaVersion: Number(state.deck.schemaVersion || 1),
        exportedAt: new Date().toISOString(),
        source: {
          deckId: String(state.deck.meta?.deckId || ""),
          deckTitle: String(state.deck.meta?.title || ""),
          referenceWidth: Number(state.deck.settings?.referenceWidth || 960),
          referenceHeight: Number(state.deck.settings?.referenceHeight || 640),
        },
        slide: deepClone(slide),
        assets,
        notes: noteResult.notes,
        packaging: {
          assetStorage: "unpacked",
          bundledRefs: dependencyStats.bundledRefs,
          failedRefs: dependencyStats.failedRefs,
        },
      };

      const zip = new JSZip();
      if (typeof externalizeDeckAssetsIntoZip !== "function") {
        throw new Error("The presenter ZIP packaging helper is unavailable.");
      }
      externalizeDeckAssetsIntoZip(slidePackage, zip);
      zip.file("slide.json", JSON.stringify(slidePackage, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      if (!blob || !blob.size) throw new Error("The generated slide package was empty.");

      const fileName = `${safeFileBase(slide.name || `slide-${index + 1}`)}.ipslide`;
      downloadPackage(blob, fileName);
      const warning = dependencyStats.failedRefs
        ? ` (${dependencyStats.failedRefs} relative HTML dependencies could not be bundled)`
        : "";
      setTransferStatus(`Exported ${fileName}${warning}.`);
    } catch (error) {
      console.error("Slide export failed:", error);
      alert(`Slide export failed.\n\n${error?.message || error}`);
      setTransferStatus("Slide export failed; the deck was not changed.");
    }
  }

  function assertNoDangerousKeys(value, path = "package") {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoDangerousKeys(item, `${path}[${index}]`));
      return;
    }
    for (const key of Object.keys(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error(`Unsafe object key at ${path}.${key}.`);
      }
      assertNoDangerousKeys(value[key], `${path}.${key}`);
    }
  }

  function validateArchiveEntries(zip, file) {
    if (Number(file?.size || 0) > MAX_COMPRESSED_BYTES) {
      throw new Error("The package is larger than the 512 MB safety limit.");
    }
    const entries = Object.values(zip.files || {});
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`The package contains too many files (${entries.length}).`);
    }
    let knownUncompressed = 0;
    for (const entry of entries) {
      const original = String(entry.unsafeOriginalName || entry.name || "").replace(/\\/g, "/");
      const parts = original.split("/").filter(Boolean);
      if (
        !original
        || original.startsWith("/")
        || /^[A-Za-z]:/.test(original)
        || parts.includes("..")
      ) {
        throw new Error(`Unsafe archive path: ${original || "(empty)"}.`);
      }
      if (!entry.dir && original !== "slide.json" && !original.startsWith("assets/")) {
        throw new Error(`Unexpected file in slide package: ${original}.`);
      }
      knownUncompressed += Number(entry?._data?.uncompressedSize || 0);
      if (knownUncompressed > MAX_UNCOMPRESSED_BYTES) {
        throw new Error("The expanded package exceeds the 1.5 GB safety limit.");
      }
    }
  }

  function validatePackageShape(slidePackage) {
    assertNoDangerousKeys(slidePackage);
    if (!slidePackage || slidePackage.packageType !== PACKAGE_TYPE) {
      throw new Error("This is not an Interactive Presenter slide package.");
    }
    const version = Number(slidePackage.packageVersion || 0);
    if (!Number.isInteger(version) || version < 1 || version > PACKAGE_VERSION) {
      throw new Error(`Unsupported slide package version: ${slidePackage.packageVersion}.`);
    }
    const currentSchema = Number(state.deck?.schemaVersion || 1);
    const sourceSchema = Number(slidePackage.deckSchemaVersion || 1);
    if (sourceSchema > currentSchema) {
      throw new Error(`This slide uses deck schema ${sourceSchema}; this presenter supports schema ${currentSchema}.`);
    }
    if (!slidePackage.slide || typeof slidePackage.slide !== "object" || Array.isArray(slidePackage.slide)) {
      throw new Error("The package does not contain a valid slide object.");
    }
    if (!slidePackage.assets || typeof slidePackage.assets !== "object" || Array.isArray(slidePackage.assets)) {
      throw new Error("The package does not contain a valid asset registry.");
    }
    if (Object.keys(slidePackage.assets).length > MAX_ASSETS) {
      throw new Error("The package contains too many assets.");
    }
    if (!Array.isArray(slidePackage.slide.overlays)) slidePackage.slide.overlays = [];
    if (slidePackage.slide.overlays.length > MAX_OVERLAYS) {
      throw new Error("The package contains too many overlays.");
    }
    if (!Array.isArray(slidePackage.slide.animationEvents)) slidePackage.slide.animationEvents = [];
    if (!Array.isArray(slidePackage.slide.textBoxes)) slidePackage.slide.textBoxes = [];
    if (!slidePackage.notes || typeof slidePackage.notes !== "object" || Array.isArray(slidePackage.notes)) {
      slidePackage.notes = {};
    }
  }

  function validateBundledPathsExist(slidePackage, zip) {
    for (const [key, asset] of Object.entries(slidePackage.assets || {})) {
      if (!asset || typeof asset !== "object") throw new Error(`Invalid asset record: ${key}.`);
      if (asset.bundlePath && !zip.file(asset.bundlePath)) {
        throw new Error(`Asset file is missing: ${asset.bundlePath}.`);
      }
      for (const frame of asset.frames || []) {
        if (frame?.bundlePath && !zip.file(frame.bundlePath)) {
          throw new Error(`Sequence frame is missing: ${frame.bundlePath}.`);
        }
      }
    }
  }

  function findExistingNotesBoardKey(assets) {
    for (const [key, asset] of Object.entries(assets || {})) {
      if (asset?.kind === "overlay-notes-board") return key;
    }
    return "";
  }

  function remapImportedPackage(slidePackage) {
    const sourceAssets = slidePackage.assets || {};
    const sourceSlide = deepClone(slidePackage.slide);
    const dependencyResult = collectSlideDependencyKeys(sourceSlide, sourceAssets);
    if (dependencyResult.missing.length) {
      throw new Error(`The package has unresolved references:\n${dependencyResult.missing.join("\n")}`);
    }

    const stagedAssets = {};
    const stagedNotes = {};
    const assetIdMap = new Map();
    let existingNotesBoardKey = findExistingNotesBoardKey(state.deck.assets || {});

    for (const [oldKey, oldAsset] of Object.entries(sourceAssets)) {
      if (!oldAsset || typeof oldAsset !== "object") {
        throw new Error(`Invalid asset: ${oldKey}.`);
      }
      if (oldAsset.kind === "overlay-notes-board" && existingNotesBoardKey) {
        assetIdMap.set(oldKey, existingNotesBoardKey);
        if (oldAsset.id) assetIdMap.set(String(oldAsset.id), existingNotesBoardKey);
        continue;
      }
      const newKey = presenterUid();
      const clone = deepClone(oldAsset);
      clone.id = newKey;
      delete clone.bundlePath;
      stagedAssets[newKey] = clone;
      assetIdMap.set(oldKey, newKey);
      if (oldAsset.id) assetIdMap.set(String(oldAsset.id), newKey);
      if (clone.kind === "overlay-notes-board") existingNotesBoardKey = newKey;
    }

    const remapAssetReference = (reference, location, allowSpecial = false) => {
      const ref = String(reference || "").trim();
      if (!ref || (allowSpecial && SPECIAL_SOURCE_IDS.has(ref))) return ref;
      const mapped = assetIdMap.get(ref);
      if (!mapped) throw new Error(`Cannot remap ${location}: ${ref}.`);
      return mapped;
    };

    sourceSlide.uid = presenterUid();
    sourceSlide.name = `${String(sourceSlide.name || "Imported slide")} (imported)`;
    sourceSlide.slideAssetId = remapAssetReference(sourceSlide.slideAssetId, "slide background");

    const overlayIdMap = new Map();
    for (const overlay of sourceSlide.overlays) {
      const oldId = String(overlay?.id || "");
      const newId = presenterUid();
      if (oldId) overlayIdMap.set(oldId, newId);
      overlay.id = newId;
      overlay.sourceId = remapAssetReference(overlay.sourceId, `overlay ${oldId || newId}`, true);

      const oldNotesKey = String(overlay.notesKey || "").trim();
      if (oldNotesKey) {
        const record = slidePackage.notes?.[oldNotesKey];
        if (!record) throw new Error(`Note record is missing: ${oldNotesKey}.`);
        const newNotesKey = presenterUid();
        stagedNotes[newNotesKey] = deepClone(record);
        overlay.notesKey = newNotesKey;
      } else {
        overlay.notesKey = "";
      }
    }

    sourceSlide.animationEvents = sourceSlide.animationEvents.map((event) => {
      const oldOverlayId = String(event?.overlayId || "");
      const mappedOverlayId = overlayIdMap.get(oldOverlayId);
      if (!mappedOverlayId) {
        throw new Error(`Animation refers to a missing overlay: ${oldOverlayId || "(empty)"}.`);
      }
      return {
        ...event,
        id: presenterUid(),
        overlayId: mappedOverlayId,
      };
    });

    sourceSlide.textBoxes = sourceSlide.textBoxes.map((textBox) => ({
      ...textBox,
      id: `textbox-${presenterUid()}`,
    }));

    if (Array.isArray(sourceSlide.summaryItems)) {
      sourceSlide.summaryItems = sourceSlide.summaryItems.map((item) => ({
        ...item,
        id: presenterUid(),
        assetId: remapAssetReference(item?.assetId, `summary item ${item?.id || "(unnamed)"}`),
      }));
    }
    if (Array.isArray(sourceSlide.titlePresenters)) {
      sourceSlide.titlePresenters = sourceSlide.titlePresenters.map((person) => ({
        ...person,
        id: presenterUid(),
      }));
    }

    if (typeof ensureSlideAnimationDefaults === "function") ensureSlideAnimationDefaults(sourceSlide);
    if (typeof normalizeSectionDividerSlide === "function") normalizeSectionDividerSlide(sourceSlide);
    if (typeof normalizeSummarySlide === "function") normalizeSummarySlide(sourceSlide);
    if (typeof normalizeTitleSlide === "function") normalizeTitleSlide(sourceSlide);

    const combinedAssets = { ...(state.deck.assets || {}), ...stagedAssets };
    const finalReferences = collectSlideDependencyKeys(sourceSlide, combinedAssets);
    if (finalReferences.missing.length) {
      throw new Error(`The staged slide is incomplete:\n${finalReferences.missing.join("\n")}`);
    }
    const overlayIds = new Set(sourceSlide.overlays.map((overlay) => overlay.id));
    for (const event of sourceSlide.animationEvents) {
      if (!overlayIds.has(event.overlayId)) {
        throw new Error(`Animation remapping failed for event ${event.id}.`);
      }
    }

    return { slide: sourceSlide, assets: stagedAssets, notes: stagedNotes };
  }

  function buildImportSummary(slidePackage) {
    const sourceWidth = Number(slidePackage.source?.referenceWidth || 0);
    const sourceHeight = Number(slidePackage.source?.referenceHeight || 0);
    const targetWidth = Number(state.deck.settings?.referenceWidth || 960);
    const targetHeight = Number(state.deck.settings?.referenceHeight || 640);
    const sourceRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 0;
    const targetRatio = targetWidth / targetHeight;
    const ratioWarning = sourceRatio && Math.abs(sourceRatio - targetRatio) / targetRatio > 0.01;
    const assets = Object.values(slidePackage.assets || {});
    const activeAssets = assets.filter((asset) => String(asset?.kind || "").includes("html"));
    const externalAssets = assets.filter((asset) => asset?.url && !asset?.htmlText);
    const lines = [
      `Import slide “${slidePackage.slide.name || "Untitled slide"}”?`,
      "",
      `Assets: ${assets.length}`,
      `Overlays: ${(slidePackage.slide.overlays || []).length}`,
      `Animations: ${(slidePackage.slide.animationEvents || []).length}`,
    ];
    if (ratioWarning) {
      lines.push(`Warning: source size ${sourceWidth}×${sourceHeight}; destination ${targetWidth}×${targetHeight}. Layout may differ.`);
    }
    if (activeAssets.length) {
      lines.push(`Security: ${activeAssets.length} embedded HTML item(s) can run scripts. Import only packages you trust.`);
    }
    if (externalAssets.length) {
      lines.push(`Warning: ${externalAssets.length} item(s) still depend on an external path or URL.`);
    }
    const unresolvedBundling = Number(slidePackage.packaging?.failedRefs || 0);
    if (unresolvedBundling) {
      lines.push(`Warning: ${unresolvedBundling} relative HTML dependency reference(s) were not bundled.`);
    }
    lines.push("", "The destination deck settings and existing assets will not be changed.");
    return lines.join("\n");
  }

  async function importSlidePackage(file) {
    try {
      if (!window.JSZip) throw new Error("JSZip is not available.");
      setTransferStatus(`Checking ${file.name}…`);
      const zip = await JSZip.loadAsync(file);
      validateArchiveEntries(zip, file);
      const manifestEntry = zip.file("slide.json");
      if (!manifestEntry) throw new Error("slide.json was not found in the package.");

      const slidePackage = JSON.parse(await manifestEntry.async("string"));
      validatePackageShape(slidePackage);
      validateBundledPathsExist(slidePackage, zip);
      if (typeof hydrateUnpackedAssets !== "function") {
        throw new Error("The presenter ZIP hydration helper is unavailable.");
      }
      await hydrateUnpackedAssets(slidePackage, zip);

      if (!confirm(buildImportSummary(slidePackage))) {
        setTransferStatus("Slide import cancelled; the deck was not changed.");
        return;
      }

      // Everything above is read-only. Build all imported records in staging
      // objects, validate them, and commit by replacing the deck collections once.
      const staged = remapImportedPackage(slidePackage);
      const insertIndex = Math.min(
        Math.max(0, Number(state.currentSlideIndex || 0) + 1),
        state.deck.slides.length,
      );
      const nextSlides = [...state.deck.slides];
      nextSlides.splice(insertIndex, 0, staged.slide);
      const nextDeck = {
        ...state.deck,
        assets: { ...(state.deck.assets || {}), ...staged.assets },
        notes: { ...(state.deck.notes || {}), ...staged.notes },
        slides: nextSlides,
      };

      state.deck = nextDeck;
      state.currentSlideIndex = insertIndex;
      state.selectedOverlayId = null;
      state.selectedTextBoxId = null;
      state.animationStepIndex = -1;
      if (typeof touch === "function") touch();
      if (typeof renderAll === "function") renderAll();
      if (typeof persistLastDeckToStorage === "function") persistLastDeckToStorage();
      setTransferStatus(`Imported “${staged.slide.name}” as slide ${insertIndex + 1}.`);
    } catch (error) {
      console.error("Slide import failed:", error);
      alert(`Slide import failed.\n\n${error?.message || error}`);
      setTransferStatus("Slide import failed; the deck was not changed.");
    } finally {
      if (importInput) importInput.value = "";
    }
  }

  function addEmptyWhiteSlide(afterIndex = state.currentSlideIndex) {
    try {
      const requestedIndex = Number(afterIndex);
      const insertionBase = Number.isInteger(requestedIndex)
        ? requestedIndex
        : Number(state.currentSlideIndex || 0);
      const assetId = presenterUid();
      const asset = {
        id: assetId,
        kind: "slide-image",
        mime: "image/svg+xml",
        name: "blank-white-slide.svg",
        dataUrl: whiteSlideDataUrl(),
      };
      const existingWhiteSlides = (state.deck.slides || []).filter((slide) => /^White slide(?: \d+)?$/i.test(String(slide?.name || ""))).length;
      const slideName = existingWhiteSlides ? `White slide ${existingWhiteSlides + 1}` : "White slide";
      const slide = typeof createSlide === "function"
        ? createSlide(assetId, slideName, "", 0)
        : {
          uid: presenterUid(),
          name: slideName,
          slideAssetId: assetId,
          fingerprint: "",
          fileSize: 0,
          overlays: [],
          animationEvents: [],
          textBoxes: [],
        };
      slide.canvasBackground = "#ffffff";
      const insertIndex = Math.min(
        Math.max(0, insertionBase + 1),
        state.deck.slides.length,
      );
      const nextSlides = [...state.deck.slides];
      nextSlides.splice(insertIndex, 0, slide);
      state.deck = {
        ...state.deck,
        assets: { ...(state.deck.assets || {}), [assetId]: asset },
        slides: nextSlides,
      };
      state.currentSlideIndex = insertIndex;
      state.selectedOverlayId = null;
      state.selectedTextBoxId = null;
      state.animationStepIndex = -1;
      if (typeof touch === "function") touch();
      if (typeof renderAll === "function") renderAll();
      if (typeof persistLastDeckToStorage === "function") persistLastDeckToStorage();
      setTransferStatus(`Inserted ${slideName} as slide ${insertIndex + 1}.`);
    } catch (error) {
      console.error("Could not add white slide:", error);
      alert(`Could not add a white slide.\n\n${error?.message || error}`);
    }
  }

  function addExportButtonsToThumbnails() {
    if (!thumbnailContainer) return;
    for (const item of thumbnailContainer.querySelectorAll(".thumbnail-item")) {
      const actionBar = item.querySelector(".thumb-action-bar");
      if (!actionBar || actionBar.querySelector(".slide-package-export-btn")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb-action-btn slide-package-export-btn";
      button.textContent = "⇩";
      button.title = "Export slide package";
      button.dataset.tooltip = "Export slide package";
      button.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        event.preventDefault();
      });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const index = Number(item.dataset.slideIndex);
        if (Number.isInteger(index)) void exportSlidePackage(index);
      });
      const deleteButton = actionBar.querySelector(".thumb-action-delete");
      actionBar.insertBefore(button, deleteButton || null);
    }
  }

  if (importInput) {
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (file) void importSlidePackage(file);
    });
  }

  if (addWhiteSlideButton) {
    addWhiteSlideButton.addEventListener("click", () => addEmptyWhiteSlide());
  }

  if (addTocSlideButton) {
    addTocSlideButton.addEventListener("click", addTocSlideAfterCurrent);
  }

  if (tocTitleInput) {
    tocTitleInput.addEventListener("input", () => {
      const slide = typeof currentSlide === "function" ? currentSlide() : null;
      if (!isTocSlide(slide)) return;
      slide.tocTitle = tocTitleInput.value;
      slide.name = tocTitleInput.value.trim() || "Overview";
      if (typeof touch === "function") touch();
      if (typeof renderStage === "function") renderStage();
      if (typeof renderThumbnailGrid === "function") renderThumbnailGrid();
      if (typeof renderSlideList === "function") renderSlideList();
    });
  }

  if (tocMessageInput) {
    tocMessageInput.addEventListener("input", () => {
      const slide = typeof currentSlide === "function" ? currentSlide() : null;
      if (!isTocSlide(slide)) return;
      slide.tocMessage = tocMessageInput.value;
      if (typeof touch === "function") touch();
      if (typeof renderStage === "function") renderStage();
      if (typeof renderThumbnailGrid === "function") renderThumbnailGrid();
    });
  }

  if (convertTocToRegularButton) {
    convertTocToRegularButton.addEventListener("click", convertCurrentTocToRegular);
  }

  if (showSectionDividersToggle) {
    showSectionDividersToggle.addEventListener("change", () => {
      ensureSectionPlaybackSettings();
      state.deck.settings.showSectionDividers = showSectionDividersToggle.checked;
      if (typeof touch === "function") touch();
      if (typeof renderStage === "function") renderStage();
    });
  }

  if (ordinarySectionProgressToggle) {
    ordinarySectionProgressToggle.addEventListener("change", () => {
      ensureSectionPlaybackSettings();
      state.deck.settings.showSectionProgressOnOrdinarySlides = ordinarySectionProgressToggle.checked;
      if (typeof touch === "function") touch();
      if (typeof renderStage === "function") renderStage();
    });
  }

  const newDeckButton = document.getElementById("newDeckBtn");
  if (newDeckButton) {
    let deckIdBeforeNewClick = "";
    newDeckButton.addEventListener("click", () => {
      deckIdBeforeNewClick = String(state.deck?.meta?.deckId || "");
    }, true);
    newDeckButton.addEventListener("click", () => {
      if (deckIdBeforeNewClick === String(state.deck?.meta?.deckId || "")) return;
      // autosave stays as it is: deck-panel.js names the backup after the new deck
    });
  }

  if (titleFontSelect) {
    titleFontSelect.addEventListener("change", () => {
      updateCurrentTitleTypography((slide) => {
        slide.titleFont = normalizeTitleFontKey(titleFontSelect.value);
      });
    });
  }

  if (titleBoldToggle) {
    titleBoldToggle.addEventListener("change", () => {
      updateCurrentTitleTypography((slide) => {
        slide.titleBold = titleBoldToggle.checked;
      });
    });
  }

  installTitleTypographyHooks();
  installLogoHeightScalingHooks();
  installTocStyles();
  installIndependentEditorScrolling();
  installHtmlLinkRootHooks();
  installPersistentSaveAndBackupHooks();
  installSectionPlaybackHooks();
  installTocHooks();
  installWhiteSlideCanvasHooks();
  void restorePersistentFileHandlesForCurrentDeck();
  repairExtensionWhiteSlideCanvases();
  if (typeof state !== "undefined" && state.deck) ensureDeckLogoSettings(state.deck);
  syncTitleTypographyControls();
  if (typeof renderSectionControls === "function") renderSectionControls();
  if (typeof renderThumbnailGrid === "function") renderThumbnailGrid();
  if (typeof renderStage === "function") renderStage();

  if (thumbnailContainer) {
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        addExportButtonsToThumbnails();
      });
    });
    observer.observe(thumbnailContainer, { childList: true, subtree: true });
    addExportButtonsToThumbnails();
  }

  // Small public surface for diagnostics and future UI integrations. The
  // package parser/remapper remain responsible for all validation.
  window.InteractivePresenterSlideTransfer = Object.freeze({
    packageType: PACKAGE_TYPE,
    packageVersion: PACKAGE_VERSION,
    addEmptyWhiteSlide,
    addTocSlideAfterCurrent,
    titleFontStacks: TITLE_FONT_STACKS,
    exportSlidePackage,
    importSlidePackage,
  });
})();
