const SCHEMA_VERSION = 2;
const FINGERPRINT_BITS = 64;
const AUTO_REMAP_THRESHOLD = 0.78;
const SIZE_REMAP_WEIGHT = 0.12;
const NAV_REPEAT_GUARD_MS = 120;

const NEXT_KEYS = new Set(["ArrowRight", "Right", "PageDown", "MediaTrackNext", "BrowserForward"]);
const PREV_KEYS = new Set(["ArrowLeft", "Left", "PageUp", "MediaTrackPrevious", "BrowserBack"]);
const NEXT_CODES = new Set(["ArrowRight", "PageDown", "MediaTrackNext", "BrowserForward"]);
const PREV_CODES = new Set(["ArrowLeft", "PageUp", "MediaTrackPrevious", "BrowserBack"]);
const OVERLAY_CLIPBOARD_MARKER = "interactive-presenter-overlay-v1";
const PANEL_COLLAPSE_STORAGE_KEY = "interactivePresenter.panelCollapse.v2";
const THEME_STORAGE_KEY = "interactivePresenter.theme.v1";
const FLOATING_TOOLBAR_POSITION_STORAGE_KEY = "interactivePresenter.floatingToolbarPos.v2";
const LAST_DECK_STORAGE_KEY = "interactivePresenter.lastDeck.v1";
const LAST_DECK_PERSIST_DEBOUNCE_MS = 700;
const OVERLAY_TOOLBAR_LINGER_MS = 5000;
const PRESENT_CORNER_HIT_PX = 20;
const PRESENT_CORNER_INSET_PX = 0;
const PRESENT_EDGE_NAV_HIT_PX = 10;
const NOTEBOOK_EDGE_HIT_PX = 44;
const NOTEBOOK_BOTTOM_HIT_PX = 58;
const NOTES_BOARD_FILE_NAME = "notes-boardX.html";
// Decks authored in earlier builds store the pre-X board filename. Both names
// resolve to the same overlay kind, so either one keeps working.
const NOTES_BOARD_LEGACY_FILE_NAMES = ["notes-board.html"];
// Folder of the most recently confirmed HTML link, reused as the default for
// the next one. Learned from use, so no folder layout is baked into the app.
const HTML_LINK_BASE_STORAGE_KEY = "htmlLinkBase:lastUsed";
const NOTES_DRAFT_STORAGE_PREFIX = "interactivePresenter.notesDraft.v1";
const DEFAULT_NOTES_DOC = "<p><br></p>";
const DEFAULT_ANIMATION_AUTOPLAY_DELAY_MS = 900;
const DEFAULT_NEW_SLIDE_WIDTH = 1920;
const DEFAULT_NEW_SLIDE_HEIGHT = 1080;
const PRESENTER_HIGHLIGHTER_FADE_MS = 6000;
const PRESENTER_HIGHLIGHTER_MAX_POINTS = 3200;
const EMPTY_STAGE_GUIDE_TITLE = "How to get started";
const EMPTY_STAGE_GUIDE_SUBTEXT = "Choose one of these actions to start your deck.";
const ERASER_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="3"/><circle cx="12" cy="12" r="8" fill="none" stroke="white" stroke-width="2"/></svg>')}") 12 12, crosshair`;
const SHIFT_ERASER_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="13" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="3"/><circle cx="17" cy="17" r="13" fill="none" stroke="white" stroke-width="2"/></svg>')}") 17 17, crosshair`;
const TEXT_BOX_MIN_WIDTH = 120;
const TEXT_BOX_MIN_HEIGHT = 40;
// Width of the border band that moves a text box instead of placing the caret.
// The old build used 8px, which was almost impossible to hit; a visible grip
// handles the common case and this band is the fallback along every edge.
const TEXT_BOX_EDGE_GRAB_PX = 10;

// ── Slide-relative typography ────────────────────────────────────────────────
// Text sizes are authored against a fixed reference slide (like PowerPoint's
// 960x540pt canvas) and rendered as a fraction of the live stage width. The
// same number therefore looks identical while editing, while presenting, and
// on a 4K projector, instead of being a literal CSS pixel value that shrinks
// as the stage grows.
// (Up here, before bootstrap() runs: start-up restores the last deck and resolves its links.)
// Subfolders of the presentation folder whose links follow it (a deck's sims, html, pdf, figures and movies
// folders). A link stored as e.g. "html/demo.html" loads from <presentation folder>/html/demo.html wherever
// the folder is copied. Case does not matter (HTML/ and html/ both work).
const ROOT_LINK_FOLDERS = ["sims", "html", "pdf", "figures", "movies"];
const ROOT_LINK_FOLDER_RE = new RegExp("^(?:\\./)?(" + ROOT_LINK_FOLDERS.join("|") + ")/", "i");

const TEXT_REFERENCE_SLIDE_WIDTH = 960;
const TEXT_SIZE_MIN = 6;
const TEXT_SIZE_MAX = 240;
const TEXT_SIZE_DEFAULT = 24;
const TEXT_SIZE_LADDER = [
  6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 66, 80, 96, 120, 160, 200, 240,
];
// Legacy decks stored fontSize as raw CSS px clamped to 9..24. Those numbers
// map 1:1 onto the reference slide, so no conversion is needed — a 24 from an
// old deck still renders ~24px on a 960px-wide stage and now scales up with it.
const TEXT_ALIGNMENTS = ["left", "center", "right", "justify"];
const TEXT_VERTICAL_ALIGNMENTS = ["top", "middle", "bottom"];
const TEXT_AUTOFIT_MODES = ["grow", "shrink", "none"];
const TEXT_BULLET_STYLES = ["disc", "dash", "chevron", "diamond", "glow", "bar", "slash", "spark", "enum"];
const TEXT_AUTOFIT_LABELS = { grow: "Grow", shrink: "Shrink", none: "Off" };
const TEXT_VALIGN_GLYPHS = { top: "⊤", middle: "⊟", bottom: "⊥" };
// Inline markup we accept inside a text overlay. Anything else is stripped on
// paste and on load, so a deck can never carry scripts or layout-breaking HTML.
const TEXT_ALLOWED_INLINE_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP", "SPAN", "BR", "DIV", "P", "UL", "OL", "LI", "FONT",
]);
const TEXT_ALLOWED_INLINE_STYLES = new Set([
  "font-weight", "font-style", "text-decoration", "text-decoration-line", "color", "font-family", "font-size", "text-align",
]);
const MANUAL_MIN_WIDTH = 560;
const MANUAL_MIN_HEIGHT = 360;
const PROTOTYPE_NOTICE = [
  "This is a prototype made with VSCode and Github Copilot by Peter Bøggild.",
  "It is not a finished product.",
  "Do not use without explicit permission by Peter Bøggild, DTU Physics, Technical University of Denmark (pbog@dtu.dk).",
  "Please send me feedback.",
];
let popupTooltipEl = null;
const overlayToolbarTimers = new Map();
let lastDeckPersistTimer = 0;

const dom = {
  appRoot: document.getElementById("appRoot"),
  stage: document.getElementById("stage"),
  slideCounter: document.getElementById("slideCounter"),
  slideTitleBar: document.getElementById("slideTitleBar"),
  slideTitleToggle: document.getElementById("slideTitleToggle"),
  slideTitleInput: document.getElementById("slideTitleInput"),
  slideTitleStyleSelect: document.getElementById("slideTitleStyleSelect"),
  modeHint: document.getElementById("modeHint"),
  remapReport: document.getElementById("remapReport"),
  animPrevStepBtn: document.getElementById("animPrevStepBtn"),
  animNextStepBtn: document.getElementById("animNextStepBtn"),
  animResetStepBtn: document.getElementById("animResetStepBtn"),
  animAutoplayCheckbox: document.getElementById("animAutoplayCheckbox"),
  animAutoplayDelayInput: document.getElementById("animAutoplayDelayInput"),
  animStepStatus: document.getElementById("animStepStatus"),
  animAddAppearInstantBtn: document.getElementById("animAddAppearInstantBtn"),
  animAddAppearFadeBtn: document.getElementById("animAddAppearFadeBtn"),
  animAddDisappearInstantBtn: document.getElementById("animAddDisappearInstantBtn"),
  animAddDisappearFadeBtn: document.getElementById("animAddDisappearFadeBtn"),
  animationEventList: document.getElementById("animationEventList"),

  editModeBtn: document.getElementById("editModeBtn"),
  presentModeBtn: document.getElementById("presentModeBtn"),
  manualHelpBtn: document.getElementById("manualHelpBtn"),
  aboutBtn: document.getElementById("aboutBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  themeSelect: document.getElementById("themeSelect"),

  deckTitleInput: document.getElementById("deckTitleInput"),
  globalContentScaleInput: document.getElementById("globalContentScaleInput"),
  globalContentScaleResetBtn: document.getElementById("globalContentScaleResetBtn"),
  globalContentScaleValue: document.getElementById("globalContentScaleValue"),
  scaleLockModeSelect: document.getElementById("scaleLockModeSelect"),
  customRefSizeRow: document.getElementById("customRefSizeRow"),
  customRefWidthInput: document.getElementById("customRefWidthInput"),
  customRefHeightInput: document.getElementById("customRefHeightInput"),
  scaleContextHint: document.getElementById("scaleContextHint"),
  presentationRootInput: document.getElementById("presentationRootInput"),
  applyPresentationRootBtn: document.getElementById("applyPresentationRootBtn"),
  presentationRootHint: document.getElementById("presentationRootHint"),
  newDeckBtn: document.getElementById("newDeckBtn"),
  printDeckBtn: document.getElementById("printDeckBtn"),
  saveZipBtn: document.getElementById("saveZipBtn"),
  saveAsZipBtn: document.getElementById("saveAsZipBtn"),
  loadZipBtn: document.getElementById("loadZipBtn"),
  loadZipInput: document.getElementById("loadZipInput"),
  autosaveEnabledCheckbox: document.getElementById("autosaveEnabledCheckbox"),
  autosaveHint: document.getElementById("autosaveHint"),
  unpackedAssetsCheckbox: document.getElementById("unpackedAssetsCheckbox"),
  unpackedAssetsHint: document.getElementById("unpackedAssetsHint"),

  importSlidesInput: document.getElementById("importSlidesInput"),
  remapSlidesInput: document.getElementById("remapSlidesInput"),
  slideList: document.getElementById("slideList"),

  importOverlayImageInput: document.getElementById("importOverlayImageInput"),
  importOverlaySequenceInput: document.getElementById("importOverlaySequenceInput"),
  importOverlayVideoInput: document.getElementById("importOverlayVideoInput"),
  importOverlayPdfInput: document.getElementById("importOverlayPdfInput"),
  importOverlayHtmlInput: document.getElementById("importOverlayHtmlInput"),
  addHtmlFileLinkInput: document.getElementById("addHtmlFileLinkInput"),
  addExternalHtmlBtn: document.getElementById("addExternalHtmlBtn"),
  addNotesBoardBtn: document.getElementById("addNotesBoardBtn"),
  addNotebookPanelBtn: document.getElementById("addNotebookPanelBtn"),
  pruneUnusedDataBtn: document.getElementById("pruneUnusedDataBtn"),
  clearSourcesBtn: document.getElementById("clearSourcesBtn"),
  sourceList: document.getElementById("sourceList"),

  drawRectBtn: document.getElementById("drawRectBtn"),
  severOverlaySourceBtn: document.getElementById("severOverlaySourceBtn"),
  overlaySourceSelect: document.getElementById("overlaySourceSelect"),
  overlayFramedCheckbox: document.getElementById("overlayFramedCheckbox"),
  overlayShadedCheckbox: document.getElementById("overlayShadedCheckbox"),
  overlayLockedCheckbox: document.getElementById("overlayLockedCheckbox"),
  overlayAllowKeyControlCheckbox: document.getElementById("overlayAllowKeyControlCheckbox"),

  overlayAllowWritingCheckbox: document.getElementById("overlayAllowWritingCheckbox"),

  overlayOpacityRange: document.getElementById("overlayOpacityRange"),
  overlayLocalScaleRange: document.getElementById("overlayLocalScaleRange"),
  overlayLocalScaleValue: document.getElementById("overlayLocalScaleValue"),
  overlayLocalScaleResetBtn: document.getElementById("overlayLocalScaleResetBtn"),
  overlayXInput: document.getElementById("overlayXInput"),
  overlayYInput: document.getElementById("overlayYInput"),
  overlayWInput: document.getElementById("overlayWInput"),
  overlayHInput: document.getElementById("overlayHInput"),
  bringFrontBtn: document.getElementById("bringFrontBtn"),
  sendBackBtn: document.getElementById("sendBackBtn"),

  prevSlideBtn: document.getElementById("prevSlideBtn"),
  nextSlideBtn: document.getElementById("nextSlideBtn"),

  textToolBtn: document.getElementById("textToolBtn"),
  textToolbox: document.getElementById("textToolbox"),
  textFontSelect: document.getElementById("textFontSelect"),
  textSizeInput: document.getElementById("textSizeInput"),
  textSizeUpBtn: document.getElementById("textSizeUpBtn"),
  textSizeDownBtn: document.getElementById("textSizeDownBtn"),
  textBoldBtn: document.getElementById("textBoldBtn"),
  textItalicBtn: document.getElementById("textItalicBtn"),
  textUnderlineBtn: document.getElementById("textUnderlineBtn"),
  textColorInput: document.getElementById("textColorInput"),
  textShadingCheckbox: document.getElementById("textShadingCheckbox"),
  textFillColorInput: document.getElementById("textFillColorInput"),
  textFillOpacityInput: document.getElementById("textFillOpacityInput"),
  textSubBtn: document.getElementById("textSubBtn"),
  textSupBtn: document.getElementById("textSupBtn"),
  textAlignLeftBtn: document.getElementById("textAlignLeftBtn"),
  textAlignCenterBtn: document.getElementById("textAlignCenterBtn"),
  textAlignRightBtn: document.getElementById("textAlignRightBtn"),
  textBulletBtn: document.getElementById("textBulletBtn"),
  textBulletStyleSelect: document.getElementById("textBulletStyleSelect"),
  ftBulletStyleSelect: document.getElementById("ftBulletStyleSelect"),
  textVAlignBtn: document.getElementById("textVAlignBtn"),
  textAutoFitBtn: document.getElementById("textAutoFitBtn"),
  textClearFormatBtn: document.getElementById("textClearFormatBtn"),

  zoomModal: document.getElementById("zoomModal"),
  zoomBackdrop: document.getElementById("zoomBackdrop"),
  zoomCloseBtn: document.getElementById("zoomCloseBtn"),
  zoomViewport: document.getElementById("zoomViewport"),

  manualModal: document.getElementById("manualModal"),
  manualBackdrop: document.getElementById("manualBackdrop"),
  manualDialog: document.getElementById("manualDialog"),
  manualHeader: document.getElementById("manualHeader"),
  manualCloseBtn: document.getElementById("manualCloseBtn"),
  manualScroller: document.getElementById("manualScroller"),
  manualResizeHandle: document.getElementById("manualResizeHandle"),

  aboutModal: document.getElementById("aboutModal"),
  aboutBackdrop: document.getElementById("aboutBackdrop"),
  aboutCloseBtn: document.getElementById("aboutCloseBtn"),
  aboutScroller: document.getElementById("aboutScroller"),

  floatingToolbarToggleBtn: document.getElementById("floatingToolbarToggleBtn"),
  floatingToolbar: document.getElementById("floatingToolbar"),
  floatingToolbarCloseBtn: document.getElementById("floatingToolbarCloseBtn"),
  ftDragHandle: document.getElementById("ftDragHandle"),
  ftSaveBtn: document.getElementById("ftSaveBtn"),
  ftSaveAsBtn: document.getElementById("ftSaveAsBtn"),
  ftTextBtn: document.getElementById("ftTextBtn"),
  ftDrawBtn: document.getElementById("ftDrawBtn"),
  ftSeverSourceBtn: document.getElementById("ftSeverSourceBtn"),
  ftForwardBtn: document.getElementById("ftForwardBtn"),
  ftBackwardBtn: document.getElementById("ftBackwardBtn"),
  ftStyleMenuToggleBtn: document.getElementById("ftStyleMenuToggleBtn"),
  ftStyleMenu: document.getElementById("ftStyleMenu"),
  ftToggleFramedBtn: document.getElementById("ftToggleFramedBtn"),
  ftTogglePenBtn: document.getElementById("ftTogglePenBtn"),
  ftToggleKeyBtn: document.getElementById("ftToggleKeyBtn"),
  ftToggleShadedBtn: document.getElementById("ftToggleShadedBtn"),
  ftToggleLockedBtn: document.getElementById("ftToggleLockedBtn"),
  ftZoomRange: document.getElementById("ftZoomRange"),
  ftAppearAfterClickBtn: document.getElementById("ftAppearAfterClickBtn"),

  thumbnailGridPanel: document.getElementById("thumbnailGridPanel"),
  thumbnailGridContainer: document.getElementById("thumbnailGridContainer"),

  // Section-divider (sections) controls — new in the Sections build.
  addSectionDividerBtn: document.getElementById("addSectionDividerBtn"),
  sectionProgressToggle: document.getElementById("sectionProgressToggle"),
  includeFrontEndToggle: document.getElementById("includeFrontEndToggle"),
  sectionProgressScaleRange: document.getElementById("sectionProgressScaleRange"),
  sectionProgressScaleValue: document.getElementById("sectionProgressScaleValue"),
  sectionDividerPanel: document.getElementById("sectionDividerPanel"),
  sectionDividerHint: document.getElementById("sectionDividerHint"),
  sectionRoleSelect: document.getElementById("sectionRoleSelect"),
  sectionTitleLongInput: document.getElementById("sectionTitleLongInput"),
  sectionTitleShortInput: document.getElementById("sectionTitleShortInput"),
  sectionEyebrowVisibleToggle: document.getElementById("sectionEyebrowVisibleToggle"),
  sectionEyebrowTextInput: document.getElementById("sectionEyebrowTextInput"),
  sectionStyleSelect: document.getElementById("sectionStyleSelect"),
  sectionMediaSelect: document.getElementById("sectionMediaSelect"),
  sectionImageInput: document.getElementById("sectionImageInput"),
  sectionSimInput: document.getElementById("sectionSimInput"),
  convertToRegularSlideBtn: document.getElementById("convertToRegularSlideBtn"),

  // Summary-slide controls.
  addSummarySlideBtn: document.getElementById("addSummarySlideBtn"),
  summaryPanel: document.getElementById("summaryPanel"),
  summaryTitleInput: document.getElementById("summaryTitleInput"),
  summaryEyebrowInput: document.getElementById("summaryEyebrowInput"),
  summaryStyleSelect: document.getElementById("summaryStyleSelect"),
  summaryLayoutSelect: document.getElementById("summaryLayoutSelect"),
  summaryRevealSelect: document.getElementById("summaryRevealSelect"),
  summaryAddCellBtn: document.getElementById("summaryAddCellBtn"),
  summaryRemoveCellBtn: document.getElementById("summaryRemoveCellBtn"),
  summaryCellCountHint: document.getElementById("summaryCellCountHint"),
  summaryImageZoomRange: document.getElementById("summaryImageZoomRange"),
  summaryImageZoomValue: document.getElementById("summaryImageZoomValue"),
  summaryTextZoomRange: document.getElementById("summaryTextZoomRange"),
  summaryTextZoomValue: document.getElementById("summaryTextZoomValue"),
  summarySelectedCellHint: document.getElementById("summarySelectedCellHint"),
  summaryCellImageBtn: document.getElementById("summaryCellImageBtn"),
  summaryCellHtmlBtn: document.getElementById("summaryCellHtmlBtn"),
  summaryCellClearBtn: document.getElementById("summaryCellClearBtn"),
  summaryCellFigureHint: document.getElementById("summaryCellFigureHint"),
  summaryCellTextInput: document.getElementById("summaryCellTextInput"),
  summaryResetLayoutBtn: document.getElementById("summaryResetLayoutBtn"),
  convertSummaryToRegularBtn: document.getElementById("convertSummaryToRegularBtn"),

  // Title-page slide controls (v14).
  addTitleSlideBtn: document.getElementById("addTitleSlideBtn"),
  titlePanel: document.getElementById("titlePanel"),
  titleMainInput: document.getElementById("titleMainInput"),
  titleSubtitleInput: document.getElementById("titleSubtitleInput"),
  titleEventInput: document.getElementById("titleEventInput"),
  titleStyleSelect: document.getElementById("titleStyleSelect"),
  titleVariantSelect: document.getElementById("titleVariantSelect"),
  titleLogoToggle: document.getElementById("titleLogoToggle"),
  titlePresentersList: document.getElementById("titlePresentersList"),
  titleAddPresenterBtn: document.getElementById("titleAddPresenterBtn"),
  titleRemovePresenterBtn: document.getElementById("titleRemovePresenterBtn"),
  titlePresenterCountHint: document.getElementById("titlePresenterCountHint"),
  titleMediaSelect: document.getElementById("titleMediaSelect"),
  titleImageInput: document.getElementById("titleImageInput"),
  titleSimInput: document.getElementById("titleSimInput"),
  convertTitleToRegularBtn: document.getElementById("convertTitleToRegularBtn"),

  // DTU logo watermark controls.
  logoEnabledCheckbox: document.getElementById("logoEnabledCheckbox"),
  logoColorSelect: document.getElementById("logoColorSelect"),
  logoScopeSelect: document.getElementById("logoScopeSelect"),
  logoPositionSelect: document.getElementById("logoPositionSelect"),
  logoScaleRange: document.getElementById("logoScaleRange"),
  logoScaleValue: document.getElementById("logoScaleValue"),
  logoOpacityRange: document.getElementById("logoOpacityRange"),
  logoOpacityValue: document.getElementById("logoOpacityValue"),

  // People credits / acknowledgements / references controls.
  peopleFolderInput: document.getElementById("peopleFolderInput"),
  peopleScanHint: document.getElementById("peopleScanHint"),
  creditsEnabledCheckbox: document.getElementById("creditsEnabledCheckbox"),
  ackEnabledCheckbox: document.getElementById("ackEnabledCheckbox"),
  creditsInvertCheckbox: document.getElementById("creditsInvertCheckbox"),
  creditsPickerOpenBtn: document.getElementById("creditsPickerOpenBtn"),
  referencesTextInput: document.getElementById("referencesTextInput"),
  referencesInvertCheckbox: document.getElementById("referencesInvertCheckbox"),
  creditsPositionSelect: document.getElementById("creditsPositionSelect"),
  creditsNameStyleSelect: document.getElementById("creditsNameStyleSelect"),
  creditsAckStyleSelect: document.getElementById("creditsAckStyleSelect"),
  creditsNarrowFontCheckbox: document.getElementById("creditsNarrowFontCheckbox"),
  creditsShadeCheckbox: document.getElementById("creditsShadeCheckbox"),
  creditsShowAffiliationCheckbox: document.getElementById("creditsShowAffiliationCheckbox"),
  creditsScaleRange: document.getElementById("creditsScaleRange"),
  creditsScaleValue: document.getElementById("creditsScaleValue"),
  ackPortraitScaleRange: document.getElementById("ackPortraitScaleRange"),
  ackPortraitScaleValue: document.getElementById("ackPortraitScaleValue"),
  ackAreaScaleRange: document.getElementById("ackAreaScaleRange"),
  ackAreaScaleValue: document.getElementById("ackAreaScaleValue"),
  referencesScaleRange: document.getElementById("referencesScaleRange"),
  referencesScaleValue: document.getElementById("referencesScaleValue"),
  creditsPicker: document.getElementById("creditsPicker"),
  creditsPickerDragHandle: document.getElementById("creditsPickerDragHandle"),
  creditsPickerCloseBtn: document.getElementById("creditsPickerCloseBtn"),
  creditsPickerHint: document.getElementById("creditsPickerHint"),
  creditsPickerList: document.getElementById("creditsPickerList"),
  creditsPickerClearBtn: document.getElementById("creditsPickerClearBtn"),
};

const state = {
  mode: "edit",
  dirty: false,
  currentSlideIndex: 0,
  selectedOverlayId: null,
  drawingEnabled: false,
  dragCtx: null,
  resizeCtx: null,
  drawCtx: null,
  annotationDrawCtx: null,
  annotationTool: "arrow",
  annotationLineWidth: 1,
  shiftTempEraser: false,
  notebookPenSubBarOpen: false,
  notebookPenSubBarOverlayId: "",
  keyControlOverlayId: null,
  penSubBarOpen: false,
  lastNavAt: 0,
  lastNavDelta: 0,
  overlayClipboard: null,
  overlayPasteCount: 0,
  slideClipboard: null,
  thumbnailPanelActive: false,
  remapHistory: [],
  runtimeImageUrls: new Map(),
  notesIframeWindows: new Map(),
  deckSessionReady: false,
  animationStepIndex: -1,
  // How many cells of the current sequential-reveal summary slide are shown.
  summaryRevealCount: 0,
  autoplayEnabled: false,
  autoplayDelayMs: DEFAULT_ANIMATION_AUTOPLAY_DELAY_MS,
  autoplayTimer: null,
  currentZipFileHandle: null,
  autosaveFileHandle: null,
  autosaveEnabled: false,
  autosaveTimer: null,
  autosaveLastAt: 0,
  autosaveInProgress: false,
  presentationRootFileUrl: "",
  showPresenterEndScreen: false,
  textToolActive: false,
  currentTextColor: "#000000",
  currentTextFont: "Arial, sans-serif",
  currentTextSize: TEXT_SIZE_DEFAULT,
  currentTextBold: false,
  currentTextItalic: false,
  currentTextUnderline: false,
  currentTextShaded: false,
  currentTextFillColor: "#c8dcf0",
  currentTextFillOpacity: 0.3,
  currentTextAlign: "left",
  currentTextVAlign: "top",
  currentTextAutoFit: "grow",
  currentTextBulletStyle: "disc",
  presenterTextEditOverlayId: null,
  presenterTextInsertArmed: false,
  presenterTextDefaultsApplied: false,
  // Id of the text overlay whose editor currently owns the caret. renderStage()
  // preserves and restores the caret across rebuilds for this overlay only, so
  // typing survives the re-renders that style changes and autofit trigger.
  activeTextEditOverlayId: null,
  pendingTextSelection: null,
  // True while renderStage() is replacing the stage. Clearing the stage blurs
  // the focused editor synchronously, and that blur must not read the dying
  // DOM back into the deck: during a rebuild the model is authoritative.
  stageRenderInProgress: false,
  // Active drag while the text tool is armed, so a box can be sized as it is placed.
  textDrawCtx: null,
  // Remembers the selection inside the editor while focus moves to a toolbar
  // control, so B/I/U/colour still apply to what the user had highlighted.
  savedTextRange: null,
  presenterTextBridgeWindows: new Map(),
  pendingOverlaySourceTargetId: null,
  floatingToolbarHidden: false,
  floatingToolbarDragCtx: null,
  presenterHighlighter: {
    ctrlDown: false,
    fading: false,
    fadeStartAt: 0,
    points: [],
    lastX: null,
    lastY: null,
    rafId: 0,
    capture: null,
    canvas: null,
    ctx: null,
    dpr: 1,
    stageWidth: 0,
    stageHeight: 0,
  },
  manualDragCtx: null,
  manualResizeCtx: null,
  manualWindowRect: {
    x: 90,
    y: 64,
    w: 860,
    h: 640,
  },
  thumbDragCtx: null,
  people: [], // scanned People folder: [{ file, name, lastName, affiliation }]
  peopleScannedAt: "",
  creditsPickerHidden: false,
  creditsPickerDragCtx: null,
  creditsHiddenSlides: new WeakSet(), // slides whose portraits the small dot hid; runtime-only, never saved

  // Summary-slide interactions (runtime only, never serialized).
  summaryDragCtx: null,
  summaryResizeCtx: null,
  summarySelectedItemId: null,

  deck: createEmptyDeck(),
};

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/* ─── Sections build: module constants ───────────────────────────────────────
 * Declared here (before the top-level bootstrap() call below) so the hoisted
 * helper functions that reference them do not hit the temporal dead zone when
 * bootstrap() runs during initial script execution. */
const SECTION_STYLE_KEYS = ["minimal-left", "minimal-center", "band", "overlay", "split"];
const DEFAULT_SECTION_STYLE = "minimal-left";
const SECTION_ROLE_KEYS = ["front", "section", "end"];
const DEFAULT_SECTION_ROLE = "section";
const SECTION_ROLE_EYEBROW = { front: "Front matter", section: "Section", end: "End matter" };
// Summary slides: a distinct slide type whose 5 designs deliberately echo the
// section dividers (same fixed --sdv-* palette + type scale). The "block" is a
// movable/resizable container of 1–6 square figure+text cells.
const SUMMARY_STYLE_KEYS = SECTION_STYLE_KEYS; // shares the 5 divider design keys
const DEFAULT_SUMMARY_STYLE = "minimal-left";
const SUMMARY_LAYOUT_KEYS = ["stack", "alt", "lateral"];
const DEFAULT_SUMMARY_LAYOUT = "stack";
const SUMMARY_MIN_CELLS = 1;
const SUMMARY_MAX_CELLS = 6;
const DEFAULT_SUMMARY_RECT = { x: 0.08, y: 0.1, w: 0.84, h: 0.8 };
// Title-page slides (new in v14): opening slides carrying a big title,
// optional subtitle, a list of presenters with their affiliations, an
// optional event/venue line, an optional prominent DTU logo, and — like the
// section dividers — an optional image or live HTML sim as accompanying media.
// Five layout styles × two colour variants (light / dark) = ten total designs.
const TITLE_STYLE_KEYS = ["classic", "banner", "hero", "split", "poster"];
const DEFAULT_TITLE_STYLE = "classic";
const TITLE_VARIANT_KEYS = ["light", "dark"];
const DEFAULT_TITLE_VARIANT = "light";
const TITLE_MIN_PRESENTERS = 1;
const TITLE_MAX_PRESENTERS = 4;
const LOGO_COLOR_KEYS = ["red", "black", "white"];
// The source PNG is solid DTU red (#990000) on transparency, so we recolour a
// plain <img> with a filter: red = as-is, black = flatten to black, white = then invert.
const LOGO_COLOR_FILTERS = { red: "none", black: "brightness(0)", white: "brightness(0) invert(1)" };
const LOGO_POSITION_KEYS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const LOGO_SCOPE_KEYS = ["all", "sections-title", "sections"];
const LOGO_ASSET_URL = "./DTUlogo.png";

/* ─── People credits / acknowledgements ──────────────────────────────────────
 * Portrait images live in a "People" folder next to the presenter file, named
 * "Full Name (Affiliation).png|jpg". Portraits are always referenced by
 * relative URL, so the presenter keeps working when it is moved together with
 * the folder. Browsers cannot enumerate a local folder on their own, so the
 * list of people is captured via the "Scan People folder" picker and cached in
 * localStorage; it restores on every startup, and a re-scan picks up newly
 * added photos. */
const PEOPLE_FOLDER_NAME = "People";
const PEOPLE_STORAGE_KEY = "interactivePresenter.peopleFolder.v1";
const CREDITS_PICKER_POSITION_STORAGE_KEY = "interactivePresenter.creditsPickerPos.v1";
const PEOPLE_IMAGE_FILE_RE = /^(.+?)\s*(?:\(([^()]*)\))?\s*\.(png|jpe?g)$/i;
const CREDITS_POSITION_KEYS = ["bottom-left", "bottom-right", "top-left", "top-right", "right-column"];
const CREDITS_NAME_STYLE_KEYS = ["full", "last"];
const CREDITS_MODE_KEYS = ["off", "credits", "ack"];
// Five acknowledgement layouts, all rendered inside one scalable rectangle
// (the .ack-area, sized by the "Acknowledgements area zoom" control).
const ACK_STYLE_KEYS = ["columns", "card", "banner", "rail", "mosaic"];

bootstrap();

function bootstrap() {
  initThemeSwitcher();
  initCollapsiblePanels();
  applyControlTooltips();
  initPopupTooltips();
  initFloatingToolbar();
  initCreditsPicker();
  initManualWindow();
  initAboutWindow();
  loadPeopleFromStorage();
  bindEvents();
  const restored = restoreLastDeckFromStorage();
  if (!restored) {
    setDeckSessionReady(false);
  }
  if (dom.autosaveEnabledCheckbox) {
    dom.autosaveEnabledCheckbox.checked = true;
    state.autosaveEnabled = true;
    setAutosaveHint(`Autosave ON. Backup file defaults to ${getAutosaveSuggestedName()}.`);
  }
  renderAll();
}

function restoreLastDeckFromStorage() {
  try {
    const raw = localStorage.getItem(LAST_DECK_STORAGE_KEY);
    if (!raw) {
      return false;
    }

    const payload = JSON.parse(raw);
    const loaded = payload?.deck;
    if (!loaded || !Array.isArray(loaded.slides) || !loaded.assets) {
      return false;
    }

    loaded.schemaVersion = loaded.schemaVersion || SCHEMA_VERSION;
    loaded.meta = loaded.meta || {};
    loaded.meta.title = loaded.meta.title || "Recovered Deck";
    loaded.meta.updatedAt = new Date().toISOString();
    loaded.orphanedSlides = loaded.orphanedSlides || [];
    loaded.settings = loaded.settings || {};
    loaded.settings.globalContentScale = safeClampNumber(loaded.settings.globalContentScale, 0.5, 2, 1);
    loaded.settings.scaleLockMode = normalizeScaleLockMode(loaded.settings.scaleLockMode, loaded.settings.resolutionLock);
    loaded.settings.previewFullscreenInEditor = false;
    loaded.settings.referenceWidth = safeClampNumber(loaded.settings.referenceWidth, 320, 7680, loaded.settings.scaleLockMode === "notes960" ? 960 : 1920);
    loaded.settings.referenceHeight = safeClampNumber(loaded.settings.referenceHeight, 180, 4320, loaded.settings.scaleLockMode === "notes960" ? 640 : 1080);
    loaded.settings.showSectionProgress = loaded.settings.showSectionProgress !== false;
    loaded.settings.includeFrontEndInProgress = loaded.settings.includeFrontEndInProgress !== false;
    loaded.settings.sectionProgressScale = safeClampNumber(loaded.settings.sectionProgressScale, 0.5, 2.5, 1);
    loaded.settings.unpackedAssets = loaded.settings.unpackedAssets === true;
    ensureDeckLogoSettings(loaded);

    normalizeLoadedDeckAssetsAndOverlayLinks(loaded);
    ensureDefaultTextBoardSource(loaded);
    (loaded.slides || []).forEach((slide) => {
      ensureSlideAnimationDefaults(slide);
      normalizeSectionDividerSlide(slide);
      normalizeSummarySlide(slide);
      normalizeTitleSlide(slide);
    });
    loaded.schemaVersion = SCHEMA_VERSION;

    revokeRuntimePdfUrlsFromDeck(state.deck);
    revokeRuntimeImageUrls();
    state.deck = loaded;
    state.currentSlideIndex = safeClampNumber(
      payload?.currentSlideIndex,
      0,
      Math.max(0, state.deck.slides.length - 1),
      0,
    );
    state.selectedOverlayId = null;
    state.animationStepIndex = -1;
    state.remapHistory = [];
    state.currentZipFileHandle = null;
    state.dirty = false;
    setDeckSessionReady(true);
    return true;
  } catch {
    return false;
  }
}

function persistLastDeckToStorage() {
  try {
    const payload = {
      savedAt: new Date().toISOString(),
      currentSlideIndex: state.currentSlideIndex,
      deck: state.deck,
    };
    localStorage.setItem(LAST_DECK_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Large decks may exceed localStorage capacity; keep app usable if that happens.
    console.warn("Unable to persist last deck snapshot.", err);
  }
}

function schedulePersistLastDeckToStorage() {
  if (lastDeckPersistTimer) {
    clearTimeout(lastDeckPersistTimer);
  }
  lastDeckPersistTimer = window.setTimeout(() => {
    lastDeckPersistTimer = 0;
    persistLastDeckToStorage();
  }, LAST_DECK_PERSIST_DEBOUNCE_MS);
}

function initThemeSwitcher() {
  if (!dom.themeSelect) {
    return;
  }

  let saved = "studio";
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY) || "studio";
  } catch {
    saved = "studio";
  }

  const theme = normalizeThemeName(saved);
  dom.themeSelect.value = theme;
  applyTheme(theme);
}

function normalizeThemeName(theme) {
  const t = String(theme || "").trim().toLowerCase();
  if (t === "editorial" || t === "executive" || t === "studio") {
    return t;
  }
  return "studio";
}

function applyTheme(themeName) {
  const theme = normalizeThemeName(themeName);
  document.body.setAttribute("data-theme", theme);
  if (dom.themeSelect && dom.themeSelect.value !== theme) {
    dom.themeSelect.value = theme;
  }
}

function initCollapsiblePanels() {
  const panels = Array.from(document.querySelectorAll(".sidebar .panel"));
  if (!panels.length) {
    return;
  }

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY) || "{}") || {};
  } catch {
    saved = {};
  }

  panels.forEach((panel, index) => {
    const titleEl = panel.querySelector("h2");
    if (!titleEl) {
      return;
    }

    const panelKey = panel.id || titleEl.textContent.trim().toLowerCase().replace(/\s+/g, "-") || `panel-${index}`;

    if (!panel.dataset.panelKey) {
      panel.dataset.panelKey = panelKey;
    }

    if (!panel.classList.contains("is-collapsible")) {
      panel.classList.add("is-collapsible");
    }

    let body = panel.querySelector(":scope > .panel-body");
    if (!body) {
      body = document.createElement("div");
      body.className = "panel-body";
      const children = Array.from(panel.children);
      children.forEach((child) => {
        if (child !== titleEl) {
          body.appendChild(child);
        }
      });
      panel.appendChild(body);
    }

    let header = panel.querySelector(":scope > .panel-header");
    let toggleBtn = panel.querySelector(":scope > .panel-header .panel-toggle");
    if (!header) {
      header = document.createElement("div");
      header.className = "panel-header";
      toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "panel-toggle";
      const titleText = titleEl.textContent.trim();
      toggleBtn.setAttribute("data-title", titleText);
      toggleBtn.innerHTML = `<span class="panel-toggle-label">${titleText}</span><span class="panel-toggle-caret" aria-hidden="true">▾</span>`;
      header.appendChild(toggleBtn);
      titleEl.remove();
      panel.insertBefore(header, body);
    }

    const hasSaved = Object.prototype.hasOwnProperty.call(saved, panelKey);
    const defaultCollapsed = panelKey !== "deck";
    const isCollapsed = hasSaved ? !!saved[panelKey] : defaultCollapsed;
    panel.classList.toggle("collapsed", isCollapsed);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      toggleBtn.setAttribute("data-tooltip", `Collapse/expand ${toggleBtn.getAttribute("data-title") || "panel"}`);
      toggleBtn.addEventListener("click", () => {
        const next = !panel.classList.contains("collapsed");
        panel.classList.toggle("collapsed", next);
        toggleBtn.setAttribute("aria-expanded", next ? "false" : "true");
        saved[panelKey] = next;
        try {
          localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, JSON.stringify(saved));
        } catch {
          // Ignore private mode/storage quota issues.
        }
      });
    }
  });
}

function applyControlTooltips() {
  const tips = {
    editModeBtn: "Switch to edit mode to create and adjust overlays.",
    presentModeBtn: "Switch to presenter mode for clean slide playback.",
    floatingToolbarToggleBtn: "Show or hide floating edit toolbar.",
    manualHelpBtn: "Open the v4 manual with setup tips and workflows.",
    aboutBtn: "Open prototype, permission, and feedback notice.",
    fullscreenBtn: "Enter fullscreen presenter mode (F5 also works).",
    themeSelect: "Switch between Editorial, Executive, and Studio visual themes.",
    deckTitleInput: "The deck's name, which is also its file name. Change it and Save asks where to save the renamed copy.",
    globalContentScaleInput: "Makes text and embedded content on all slides larger or smaller. 100% is the authored size.",
    scaleLockModeSelect: "The slide canvas every display shows, scaled to fit. Set it once per deck; overlays keep their place on any screen.",
    customRefWidthInput: "Custom reference width in pixels.",
    customRefHeightInput: "Custom reference height in pixels.",
    printDeckBtn: "Print all slides to PDF or printer.",
    newDeckBtn: "Create a new empty deck.",
    saveZipBtn: "Save and overwrite the current .ipe file. A deck opened from an older .zip is saved as a new .ipe next to it (the .zip stays as it was). If no save location exists yet, this opens Save As.",
    saveAsZipBtn: "Save as an .ipe file with a location and name you choose.",
    loadZipBtn: "Open an .ipe deck. Older .zip decks: choose \"Older deck (.zip)\" in the file type list. Double-clicking an .ipe file also opens it, and then its folder is known for the linked files.",
    loadZipInput: "Open a saved .ipe deck (or an older .zip).",
    importSlidesInput: "Import slide images (JPG/PNG/GIF/SVG).",
    remapSlidesInput: "Re-import slides and remap overlays using visual fingerprints with filename and file-size tie-breakers.",
    importOverlayImageInput: "Add image overlays (JPG/PNG/GIF/SVG) to source library.",
    importOverlaySequenceInput: "Add image sequences named like Image1.jpg, Image2.jpg, Image3.jpg...",
    importOverlayVideoInput: "Add video overlays (MP4/WEBM/OGG/MOV) to source library.",
    importOverlayPdfInput: "Add PDF overlays with in-overlay scrolling.",
    importOverlayHtmlInput: "Add local HTML overlays to source library (copies content into deck; relative asset links may break).",
    addHtmlFileLinkInput: "Add HTML file as a link — stores a reference path instead of copying content, so relative assets (images, JS) still resolve correctly. Edit the path in the source list after adding if needed.",
    addExternalHtmlBtn: "Add an HTML link by pasting a path/URL. Many websites block iframe embedding (X-Frame-Options/CSP), so this often does not work.",
    addNotesBoardBtn: "Add a rich-text notes board. Size and theme are stored in the deck, so it looks the same on every machine.",
    addNotebookPanelBtn: "Add a paged notebook for typing, with optional pen drawing. Its toolbar appears above the panel on hover.",
    pruneUnusedDataBtn: "Remove assets that are not referenced by any slide or overlay in the current deck.",
    clearSourcesBtn: "Remove all overlay sources from the source library. Overlays using them become empty.",
    drawRectBtn: "Toggle overlay drawing mode, then drag on the slide to create a new overlay.",
    severOverlaySourceBtn: "Sever selected overlay from its source without deleting the source asset.",
    overlaySourceSelect: "Pick which source to show inside selected overlay.",
    overlayFramedCheckbox: "Show border/frame around selected overlay.",
    overlayShadedCheckbox: "Add shaded backing/shadow behind selected overlay.",
    overlayLockedCheckbox: "Lock selected overlay so it cannot be moved or resized in presenter mode.",
    overlayAllowKeyControlCheckbox: "Allow this overlay to capture keyboard control in presenter mode using the KEY toggle.",
    overlayAllowWritingCheckbox: "Enable pen annotations on selected overlay.",
    overlayOpacityRange: "Adjust selected overlay transparency.",
    overlayLocalScaleRange: "Local zoom for selected overlay. Multiplies with global scale.",
    overlayLocalScaleResetBtn: "Reset local zoom to 100% for selected overlay.",
    overlayXInput: "Selected overlay X position in percent.",
    overlayYInput: "Selected overlay Y position in percent.",
    overlayWInput: "Selected overlay width in percent.",
    overlayHInput: "Selected overlay height in percent.",
    bringFrontBtn: "Bring selected overlay in front of others.",
    sendBackBtn: "Send selected overlay behind others.",
    prevSlideBtn: "Go to previous slide (Left/PageUp).",
    nextSlideBtn: "Go to next slide (Right/PageDown).",
    animPrevStepBtn: "Go one animation step backward for the current slide.",
    animNextStepBtn: "Go one animation step forward for the current slide.",
    animResetStepBtn: "Reset animation playhead to the state before step 1.",
    animAutoplayCheckbox: "Automatically advance animation steps in presenter mode.",
    animAutoplayDelayInput: "Milliseconds between autoplay step advances.",
    animStepStatus: "Current animation step status for this slide.",
    animAddAppearInstantBtn: "Add an appear-on-click event for the selected overlay.",
    animAddAppearFadeBtn: "Add an appear-with-previous event for the selected overlay.",
    animAddDisappearInstantBtn: "Add a remove-on-click event for the selected overlay.",
    animAddDisappearFadeBtn: "Add a remove-with-previous event for the selected overlay.",
    animationEventList: "Ordered list of overlay animation events for this slide.",
    zoomCloseBtn: "Close zoomed overlay view.",
    zoomBackdrop: "Click backdrop to close zoom view.",
    floatingToolbarCloseBtn: "Hide floating toolbar.",
    ftSaveBtn: "Save current deck.",
    ftSaveAsBtn: "Save deck as a new file.",
    ftTextBtn: "Text tool: click to drop a text box, or drag to set its width.",
    textToolBtn: "Text tool: click to drop a text box, or drag to set its width. Click into any existing box to edit it.",
    textFontSelect: "Font for the selection, or for the whole box when nothing is selected.",
    textSizeInput: "Size in slide points. Scrolls to step; Ctrl+Shift+> and < do the same while typing.",
    textSizeUpBtn: "Larger text (Ctrl+Shift+>).",
    textSizeDownBtn: "Smaller text (Ctrl+Shift+<).",
    textBoldBtn: "Bold (Ctrl+B). Applies to the selection, or the whole box when nothing is selected.",
    textItalicBtn: "Italic (Ctrl+I).",
    textUnderlineBtn: "Underline (Ctrl+U).",
    textSubBtn: "Subscript for the selection (Ctrl+,).",
    textSupBtn: "Superscript for the selection (Ctrl+.).",
    textColorInput: "Text colour for the selection, or the whole box when nothing is selected.",
    textAlignLeftBtn: "Align text left.",
    textAlignCenterBtn: "Centre text.",
    textAlignRightBtn: "Align text right.",
    textBulletBtn: "Bulleted list (Ctrl+Shift+L).",
    textVAlignBtn: "Vertical anchor inside the box: top, middle, bottom.",
    textAutoFitBtn: "Autofit: Grow the box to the text, Shrink the text to the box, or Off.",
    textShadingCheckbox: "Draw a background fill behind the text.",
    textFillColorInput: "Background fill colour.",
    textFillOpacityInput: "Background fill opacity.",
    textClearFormatBtn: "Strip character formatting from the selection, or from the whole box.",
    ftDrawBtn: "Toggle draw overlay mode.",
    ftSeverSourceBtn: "Sever selected overlay from its source without deleting the source asset.",
    ftForwardBtn: "Move selected overlay forward.",
    ftBackwardBtn: "Move selected overlay backward.",
    ftStyleMenuToggleBtn: "Open style submenu: Framed, Pen, Key control, Shaded, Locked, Bullet style.",
    ftZoomRange: "Adjust local zoom for selected overlay.",
    ftAppearAfterClickBtn: "Add animation event: appear after click.",
    slideList: "Click a slide to select and edit it.",
    sourceList: "Overlay source library currently loaded in this deck.",
    remapReport: "Summary of the latest remap run and confidence scores.",
    scaleContextHint: "Displays target stage, reference size, and fit ratio used for scaling.",
    modeHint: "Live status messages and quick guidance for current actions.",
  };

  for (const [id, tip] of Object.entries(tips)) {
    const el = dom[id];
    if (el) {
      el.dataset.tooltip = tip;
      el.setAttribute("aria-label", tip);
    }
  }

  // Ensure every visible control has a popup tooltip, even if it was not explicitly mapped.
  applyAutoControlTooltips();
}

function applyAutoControlTooltips() {
  const controls = document.querySelectorAll("button, input, select, textarea");
  controls.forEach((el) => {
    if (!(el instanceof HTMLElement)) {
      return;
    }

    if (el.dataset.tooltip && el.dataset.tooltip.trim()) {
      return;
    }

    let tip = "";
    const aria = el.getAttribute("aria-label") || "";
    if (aria.trim()) {
      tip = aria.trim();
    }

    if (!tip) {
      const id = el.getAttribute("id") || "";
      if (id) {
        const explicitLabel = document.querySelector(`label[for="${id}"]`);
        if (explicitLabel) {
          tip = explicitLabel.textContent.trim();
        }
      }
    }

    if (!tip) {
      const wrappingLabel = el.closest("label");
      if (wrappingLabel) {
        tip = wrappingLabel.textContent.replace(/\s+/g, " ").trim();
      }
    }

    if (!tip) {
      if (el.tagName === "BUTTON") {
        tip = `Button: ${(el.textContent || "action").trim() || "action"}`;
      } else if ((el instanceof HTMLInputElement) && el.type === "range") {
        tip = "Slider control.";
      } else {
        tip = "Control.";
      }
    }

    el.dataset.tooltip = tip;
    if (!el.getAttribute("aria-label")) {
      el.setAttribute("aria-label", tip);
    }
  });
}

function initPopupTooltips() {
  if (popupTooltipEl) {
    return;
  }

  popupTooltipEl = document.createElement("div");
  popupTooltipEl.className = "app-tooltip-popup hidden";
  popupTooltipEl.setAttribute("role", "tooltip");
  document.body.appendChild(popupTooltipEl);

  document.addEventListener("mouseover", (e) => {
    const target = resolveTooltipTarget(e.target);
    if (!target) {
      hidePopupTooltip();
      return;
    }
    showPopupTooltipForTarget(target, e.clientX, e.clientY);
  });

  document.addEventListener("mousemove", (e) => {
    if (!popupTooltipEl || popupTooltipEl.classList.contains("hidden")) {
      return;
    }
    positionPopupTooltip(e.clientX, e.clientY);
  });

  document.addEventListener("mouseout", (e) => {
    const from = resolveTooltipTarget(e.target);
    if (!from) {
      return;
    }
    const to = resolveTooltipTarget(e.relatedTarget);
    if (from !== to) {
      hidePopupTooltip();
    }
  });

  document.addEventListener("focusin", (e) => {
    const target = resolveTooltipTarget(e.target);
    if (!target) {
      return;
    }
    const rect = target.getBoundingClientRect();
    showPopupTooltipForTarget(target, rect.left + rect.width / 2, rect.bottom + 8);
  });

  document.addEventListener("focusout", () => {
    hidePopupTooltip();
  });

  window.addEventListener("scroll", hidePopupTooltip, true);
}

function resolveTooltipTarget(rawTarget) {
  if (!(rawTarget instanceof Element)) {
    return null;
  }
  return rawTarget.closest("[data-tooltip], [title]");
}

function showPopupTooltipForTarget(target, clientX, clientY) {
  if (!popupTooltipEl || !(target instanceof HTMLElement)) {
    return;
  }
  const text = (target.dataset.tooltip || target.title || "").trim();
  if (!text) {
    hidePopupTooltip();
    return;
  }

  popupTooltipEl.textContent = text;
  popupTooltipEl.classList.remove("hidden");
  positionPopupTooltip(clientX, clientY);
}

function positionPopupTooltip(clientX, clientY) {
  if (!popupTooltipEl) {
    return;
  }
  const pad = 12;
  const x = clientX + 14;
  const y = clientY + 16;

  const rect = popupTooltipEl.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - pad;
  const maxY = window.innerHeight - rect.height - pad;

  popupTooltipEl.style.left = `${clamp(x, pad, Math.max(pad, maxX))}px`;
  popupTooltipEl.style.top = `${clamp(y, pad, Math.max(pad, maxY))}px`;
}

function hidePopupTooltip() {
  if (!popupTooltipEl) {
    return;
  }
  popupTooltipEl.classList.add("hidden");
}

function createEmptyDeck() {
  const deck = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      deckId: uid(),
      title: "Untitled Interactive Deck",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    settings: {
      globalContentScale: 1,
      scaleLockMode: "notes960",
      previewFullscreenInEditor: false,
      referenceWidth: 960,
      referenceHeight: 640,
      presentationRootPath: "",
      showSectionProgress: true,
      includeFrontEndInProgress: true,
      sectionProgressScale: 1,
      unpackedAssets: false,
    },
    assets: {},
    notes: {},
    slides: [],
    orphanedSlides: [],
  };
  ensureDefaultTextBoardSource(deck);
  return deck;
}

function ensureDefaultTextBoardSource(deck = state.deck) {
  if (!deck || typeof deck !== "object") {
    return "";
  }
  if (!deck.assets || typeof deck.assets !== "object") {
    deck.assets = {};
  }

  for (const [key, asset] of Object.entries(deck.assets)) {
    if (asset && asset.kind === "overlay-notes-board") {
      if (!asset.id) {
        asset.id = key;
      }
      // Point pre-X decks at the reworked board. The stored note documents are
      // unchanged, so the same deck still opens in the old build.
      if (!asset.url || NOTES_BOARD_LEGACY_FILE_NAMES.includes(String(asset.url))) {
        asset.url = NOTES_BOARD_FILE_NAME;
      }
      if (!asset.name) {
        asset.name = "Text Board";
      }
      if (!asset.mime) {
        asset.mime = "text/html";
      }
      return key;
    }
  }

  const id = uid();
  deck.assets[id] = {
    id,
    kind: "overlay-notes-board",
    mime: "text/html",
    name: "Text Board",
    url: NOTES_BOARD_FILE_NAME,
  };
  return id;
}

function createSlide(assetId, name, fingerprint, fileSize = 0) {
  return {
    uid: uid(),
    name,
    slideAssetId: assetId,
    fingerprint,
    fileSize: safeClampNumber(fileSize, 0, Number.MAX_SAFE_INTEGER, 0),
    overlays: [],
    animationEvents: [],
    textBoxes: [],
  };
}

/* ─── Sections / section-divider slides ──────────────────────────────────────
 * A section is modelled implicitly: a slide flagged `type: "section-divider"`
 * starts a new section, and the slides that follow it (until the next divider)
 * belong to that section. Nothing else needs a separate array, so old decks
 * (which have no divider slides) simply load as a single ungrouped run.
 * NOTE: the SECTION_* / LOGO_* constants are declared near the top of the file
 * (before the bootstrap() call) to avoid a temporal-dead-zone ReferenceError. */

function normalizeSectionStyle(styleKey) {
  return SECTION_STYLE_KEYS.includes(styleKey) ? styleKey : DEFAULT_SECTION_STYLE;
}

function normalizeSectionRole(roleKey) {
  return SECTION_ROLE_KEYS.includes(roleKey) ? roleKey : DEFAULT_SECTION_ROLE;
}

function isSectionDivider(slide) {
  return !!slide && slide.type === "section-divider";
}

// Ensure a section-divider slide carries all of its section fields with sane
// defaults. Safe to call on any slide (no-op for regular slides).
function normalizeSectionDividerSlide(slide) {
  if (!isSectionDivider(slide)) {
    return;
  }
  // Every slide should have a uid; guard defensively since the thumbnail
  // collapse state is keyed by it.
  if (!slide.uid) slide.uid = uid();
  slide.titleLong = typeof slide.titleLong === "string" ? slide.titleLong : (slide.name || "New section");
  slide.titleShort = typeof slide.titleShort === "string" ? slide.titleShort : "";
  slide.sectionStyle = normalizeSectionStyle(slide.sectionStyle);
  slide.sectionRole = normalizeSectionRole(slide.sectionRole);
  // Eyebrow = the small label above the title (default "Section"). Per-slide
  // toggle + optional custom text overriding the role-derived default.
  slide.eyebrowVisible = slide.eyebrowVisible !== false;
  slide.eyebrowText = typeof slide.eyebrowText === "string" ? slide.eyebrowText : "";
  if (!Array.isArray(slide.overlays)) slide.overlays = [];
  if (!Array.isArray(slide.textBoxes)) slide.textBoxes = [];
}

// The eyebrow text shown on a divider slide: custom text if given, else the
// role-derived default ("Front matter" / "Section" / "End matter").
function sectionEyebrowText(slide) {
  const custom = (slide?.eyebrowText || "").trim();
  return custom || SECTION_ROLE_EYEBROW[normalizeSectionRole(slide?.sectionRole)] || "Section";
}

function createSectionDividerSlide(titleLong = "New section", role = DEFAULT_SECTION_ROLE) {
  const slide = createSlide("", titleLong, "", 0);
  slide.type = "section-divider";
  slide.titleLong = titleLong;
  slide.titleShort = "";
  slide.sectionStyle = DEFAULT_SECTION_STYLE;
  slide.sectionRole = normalizeSectionRole(role);
  slide.eyebrowVisible = true;
  slide.eyebrowText = "";
  return slide;
}

/* ─── Summary slides ─────────────────────────────────────────────────────────
 * A summary slide (`type: "summary"`) holds a movable/resizable block with a
 * title and 1–6 square "cells", each pairing a figure (image or HTML sim) with
 * a rich-text note. Three layouts (stack / alternating / lateral) and five
 * designs that mirror the section-divider styles. Figures reference the shared
 * deck.assets store exactly like overlays/divider media, so save/load, unpacked
 * assets and remap all work for free. */

function normalizeSummaryStyle(key) {
  return SUMMARY_STYLE_KEYS.includes(key) ? key : DEFAULT_SUMMARY_STYLE;
}

function normalizeSummaryLayout(key) {
  return SUMMARY_LAYOUT_KEYS.includes(key) ? key : DEFAULT_SUMMARY_LAYOUT;
}

// How the summary cells appear in presenter mode: "all" (every cell at once,
// the default) or "sequential" (one cell per click, 0.5 s fade-in).
function normalizeSummaryReveal(key) {
  return key === "sequential" ? "sequential" : "all";
}

function isSummarySlide(slide) {
  return !!slide && slide.type === "summary";
}

function createSummaryItem() {
  return { id: uid(), assetId: "", text: "" };
}

function createSummarySlide() {
  const slide = createSlide("", "Summary", "", 0);
  slide.type = "summary";
  slide.summaryTitle = "Summary";
  slide.summaryEyebrow = "";
  slide.summaryStyle = DEFAULT_SUMMARY_STYLE;
  slide.summaryLayout = DEFAULT_SUMMARY_LAYOUT;
  slide.summaryReveal = "all";
  slide.summaryItems = [createSummaryItem(), createSummaryItem(), createSummaryItem()];
  slide.summaryRect = { ...DEFAULT_SUMMARY_RECT };
  slide.summaryImageZoom = 1;
  slide.summaryTextZoom = 1;
  return slide;
}

// Backfill every summary field with sane defaults. Safe on any slide (no-op for
// non-summary slides); called on load and defensively before render.
function normalizeSummarySlide(slide) {
  if (!isSummarySlide(slide)) {
    return;
  }
  if (!slide.uid) slide.uid = uid();
  slide.summaryTitle = typeof slide.summaryTitle === "string" ? slide.summaryTitle : (slide.name || "Summary");
  slide.summaryEyebrow = typeof slide.summaryEyebrow === "string" ? slide.summaryEyebrow : "";
  slide.summaryStyle = normalizeSummaryStyle(slide.summaryStyle);
  slide.summaryLayout = normalizeSummaryLayout(slide.summaryLayout);
  slide.summaryReveal = normalizeSummaryReveal(slide.summaryReveal);
  if (!Array.isArray(slide.summaryItems) || !slide.summaryItems.length) {
    slide.summaryItems = [createSummaryItem()];
  }
  slide.summaryItems = slide.summaryItems.slice(0, SUMMARY_MAX_CELLS).map((it) => ({
    id: (it && it.id) || uid(),
    assetId: (it && typeof it.assetId === "string") ? it.assetId : "",
    text: (it && typeof it.text === "string") ? it.text : "",
  }));
  const r = (slide.summaryRect && typeof slide.summaryRect === "object") ? slide.summaryRect : {};
  slide.summaryRect = {
    x: safeClampNumber(r.x, 0, 0.95, DEFAULT_SUMMARY_RECT.x),
    y: safeClampNumber(r.y, 0, 0.95, DEFAULT_SUMMARY_RECT.y),
    w: safeClampNumber(r.w, 0.15, 1, DEFAULT_SUMMARY_RECT.w),
    h: safeClampNumber(r.h, 0.15, 1, DEFAULT_SUMMARY_RECT.h),
  };
  slide.summaryImageZoom = safeClampNumber(slide.summaryImageZoom, 0.4, 3, 1);
  slide.summaryTextZoom = safeClampNumber(slide.summaryTextZoom, 0.4, 3, 1);
  if (!Array.isArray(slide.overlays)) slide.overlays = [];
  if (!Array.isArray(slide.textBoxes)) slide.textBoxes = [];
}

/* ─── Title-page slides (v14) ────────────────────────────────────────────────
 * Opening slides carrying a big title, optional subtitle, one or more
 * presenters with affiliations, an optional event/venue/date line, an optional
 * prominent DTU logo, and — like the section dividers — an optional image or
 * live HTML sim (stored on slide.slideAssetId, exactly like a divider's media).
 * Five layout styles × two colour variants (light / dark). Not movable /
 * resizable: title-pages compose a full-bleed layout like a section divider. */

function normalizeTitleStyle(key) {
  return TITLE_STYLE_KEYS.includes(key) ? key : DEFAULT_TITLE_STYLE;
}

function normalizeTitleVariant(key) {
  return TITLE_VARIANT_KEYS.includes(key) ? key : DEFAULT_TITLE_VARIANT;
}

function isTitleSlide(slide) {
  return !!slide && slide.type === "title-page";
}

function createTitlePresenter(name = "", affiliation = "") {
  return { id: uid(), name, affiliation };
}

function createTitleSlide() {
  const slide = createSlide("", "Title", "", 0);
  slide.type = "title-page";
  slide.titleMain = "Title of the talk";
  slide.titleSubtitle = "";
  slide.titlePresenters = [createTitlePresenter("Presenter name", "Affiliation")];
  slide.titleEvent = "";
  slide.titleStyle = DEFAULT_TITLE_STYLE;
  slide.titleVariant = DEFAULT_TITLE_VARIANT;
  slide.titleLogoVisible = true;
  return slide;
}

// Backfill every title-page field with sane defaults. Safe on any slide (no-op
// for non-title slides); called on load and defensively before render.
function normalizeTitleSlide(slide) {
  if (!isTitleSlide(slide)) {
    return;
  }
  if (!slide.uid) slide.uid = uid();
  slide.titleMain = typeof slide.titleMain === "string" ? slide.titleMain : (slide.name || "Title of the talk");
  slide.titleSubtitle = typeof slide.titleSubtitle === "string" ? slide.titleSubtitle : "";
  slide.titleEvent = typeof slide.titleEvent === "string" ? slide.titleEvent : "";
  slide.titleStyle = normalizeTitleStyle(slide.titleStyle);
  slide.titleVariant = normalizeTitleVariant(slide.titleVariant);
  slide.titleLogoVisible = slide.titleLogoVisible !== false;
  if (!Array.isArray(slide.titlePresenters) || !slide.titlePresenters.length) {
    slide.titlePresenters = [createTitlePresenter()];
  }
  slide.titlePresenters = slide.titlePresenters.slice(0, TITLE_MAX_PRESENTERS).map((p) => ({
    id: (p && p.id) || uid(),
    name: (p && typeof p.name === "string") ? p.name : "",
    affiliation: (p && typeof p.affiliation === "string") ? p.affiliation : "",
  }));
  if (!Array.isArray(slide.overlays)) slide.overlays = [];
  if (!Array.isArray(slide.textBoxes)) slide.textBoxes = [];
}

function getSummaryRect(slide) {
  normalizeSummarySlide(slide);
  return { ...slide.summaryRect };
}

// True when a divider counts as a real "section" for numbering purposes
// (front/end matter are structural but not numbered sections).
function isNumberedSection(slide) {
  return isSectionDivider(slide) && normalizeSectionRole(slide.sectionRole) === "section";
}

// The dividers that should appear in the progress bar, honouring the
// front/end-matter inclusion toggle.
function getProgressDividerSlides() {
  const includeFrontEnd = state.deck.settings?.includeFrontEndInProgress !== false;
  return getSectionDividerSlides().filter(
    (d) => includeFrontEnd || normalizeSectionRole(d.sectionRole) === "section",
  );
}

// Ordered list of the divider slides in the deck (one per section).
function getSectionDividerSlides() {
  return state.deck.slides.filter(isSectionDivider);
}

/* ─── Optional per-slide title ───────────────────────────────────────────────
 * An ordinary slide can carry a title strip across its top: slide.slideTitle
 * holds the text and slide.slideTitleOn switches it on/off, so a title that is
 * switched off keeps its text. The look follows the five section-divider
 * designs: deck.settings.slideTitleStyle names one, or "section" (the default)
 * borrows the design of the section the slide sits in. Dividers, summaries,
 * title pages and TOC slides have their own titles and never get the strip. */

function slideSupportsTitle(slide) {
  return !!slide
    && !isSectionDivider(slide)
    && !isSummarySlide(slide)
    && !isTitleSlide(slide)
    && slide.type !== "toc";
}

function normalizeSlideTitleStyleSetting(key) {
  return SECTION_STYLE_KEYS.includes(key) ? key : "section";
}

// The divider that opens the section a slide belongs to, or null.
function sectionDividerForSlide(slide) {
  const slides = state.deck.slides;
  for (let i = slides.indexOf(slide); i >= 0; i--) {
    if (isSectionDivider(slides[i])) return slides[i];
  }
  return null;
}

function resolveSlideTitleStyle(slide) {
  const chosen = normalizeSlideTitleStyleSetting(state.deck.settings?.slideTitleStyle);
  if (chosen !== "section") return chosen;
  const divider = sectionDividerForSlide(slide);
  return divider ? normalizeSectionStyle(divider.sectionStyle) : DEFAULT_SECTION_STYLE;
}

// The title strip for a slide, or null when it has none. In edit mode a title
// that is switched on but still empty shows a faint placeholder so you can see
// where it will sit; presenting and thumbnails skip it.
function buildSlideTitleLayer(slide, { placeholder = false } = {}) {
  if (!slideSupportsTitle(slide) || slide.slideTitleOn !== true) return null;
  const text = String(slide.slideTitle || "").trim();
  if (!text && !placeholder) return null;
  const layer = document.createElement("div");
  layer.className = `slide-title-layer stl-${resolveSlideTitleStyle(slide)}${text ? "" : " is-empty"}`;
  const heading = document.createElement("h2");
  heading.className = "slide-title-text";
  heading.textContent = text || "Slide title";
  layer.appendChild(heading);
  return layer;
}

/* ─── DTU logo watermark ──────────────────────────────────────────────────────
 * (LOGO_* constants are declared near the top of the file, before bootstrap().) */

// Ensure a deck carries a fully-formed logo settings block with sane defaults.
function ensureDeckLogoSettings(deck = state.deck) {
  if (!deck || typeof deck !== "object") return;
  deck.settings = deck.settings || {};
  const raw = deck.settings.logo && typeof deck.settings.logo === "object" ? deck.settings.logo : {};
  // Migrate the old two-way scope ("all"/"sections") onto the new three-way set.
  let scope = raw.scope;
  if (!LOGO_SCOPE_KEYS.includes(scope)) scope = "all";
  deck.settings.logo = {
    enabled: raw.enabled === true,
    color: LOGO_COLOR_KEYS.includes(raw.color) ? raw.color : "red",
    scale: safeClampNumber(raw.scale, 0.03, 0.5, 0.1),
    opacity: safeClampNumber(raw.opacity, 0.05, 1, 0.9),
    position: LOGO_POSITION_KEYS.includes(raw.position) ? raw.position : "bottom-right",
    scope,
  };
  return deck.settings.logo;
}

// The "title slide" for logo-scope purposes is the first slide of the deck.
function isTitleSlide(slide) {
  return !!slide && state.deck.slides.length > 0 && slide === state.deck.slides[0];
}

// Whether the logo should appear on the given slide under the chosen scope.
function logoScopeMatchesSlide(scope, slide) {
  if (scope === "all") return true;
  if (scope === "sections") return isSectionDivider(slide);
  if (scope === "sections-title") return isSectionDivider(slide) || isTitleSlide(slide);
  return true;
}

// Build the recoloured logo watermark for the current slide, or null when it
// should not appear (disabled, or outside the chosen scope). Uses a plain <img>
// recoloured by CSS filter — the source PNG is solid DTU red on transparency.
function buildSlideLogo(slide) {
  const logo = ensureDeckLogoSettings(state.deck);
  if (!logo.enabled) return null;
  if (!logoScopeMatchesSlide(logo.scope, slide)) return null;

  const el = document.createElement("img");
  el.className = `slide-logo pos-${logo.position}`;
  el.src = LOGO_ASSET_URL;
  el.alt = "DTU logo";
  el.draggable = false;
  el.style.width = `${logo.scale * 100}%`;
  el.style.height = "auto";
  el.style.opacity = String(logo.opacity);
  el.style.filter = LOGO_COLOR_FILTERS[logo.color] || "none";
  return el;
}

/* ─── People credits, acknowledgements & references ──────────────────────────
 * Format (position, name style, zooms) is deck-global in settings.credits so
 * every slide with credits looks the same; which people appear, the mode
 * (credits strip vs acknowledgements columns) and the invert flags are
 * per-slide, mirroring how the DTU logo splits global format from scope. */

// Ensure a deck carries a fully-formed credits settings block with sane defaults.
function ensureDeckCreditsSettings(deck = state.deck) {
  if (!deck || typeof deck !== "object") return null;
  deck.settings = deck.settings || {};
  const raw = deck.settings.credits && typeof deck.settings.credits === "object" ? deck.settings.credits : {};
  deck.settings.credits = {
    position: CREDITS_POSITION_KEYS.includes(raw.position) ? raw.position : "bottom-left",
    nameStyle: CREDITS_NAME_STYLE_KEYS.includes(raw.nameStyle) ? raw.nameStyle : "full",
    ackStyle: ACK_STYLE_KEYS.includes(raw.ackStyle) ? raw.ackStyle : "columns",
    narrowNames: raw.narrowNames === true,
    shade: raw.shade === true,
    showAffiliation: raw.showAffiliation === true,
    scale: safeClampNumber(raw.scale, 0.4, 2.5, 1),
    ackPortraitScale: safeClampNumber(raw.ackPortraitScale, 0.4, 2.5, 1),
    ackAreaScale: safeClampNumber(raw.ackAreaScale, 0.4, 2, 1),
    referencesScale: safeClampNumber(raw.referencesScale, 0.5, 2.5, 1),
  };
  return deck.settings.credits;
}

// Per-slide credits state: mode ("off"/"credits"/"ack"), the shown people as an
// ordered list of People-folder file names, and the white-text invert flag.
// References are a per-slide free-text line with its own invert flag.
// Safe to call on any slide (fills defaults, never discards data).
function ensureSlideCreditsDefaults(slide) {
  if (!slide || typeof slide !== "object") return;
  const rawCredits = slide.credits && typeof slide.credits === "object" ? slide.credits : {};
  slide.credits = {
    mode: CREDITS_MODE_KEYS.includes(rawCredits.mode) ? rawCredits.mode : "off",
    people: Array.isArray(rawCredits.people) ? rawCredits.people.filter((f) => typeof f === "string" && f) : [],
    invert: rawCredits.invert === true,
    // Per-slide portrait placement; "" = inherit the deck-default position.
    position: CREDITS_POSITION_KEYS.includes(rawCredits.position) ? rawCredits.position : "",
  };
  const rawRefs = slide.references && typeof slide.references === "object" ? slide.references : {};
  slide.references = {
    text: typeof rawRefs.text === "string" ? rawRefs.text : "",
    invert: rawRefs.invert === true,
  };
}

// "Nini Pryds (DTU Energy).jpg" → { file, name, lastName, affiliation }.
function parsePersonFileName(fileName) {
  const m = PEOPLE_IMAGE_FILE_RE.exec(String(fileName || "").trim());
  if (!m) return null;
  const name = (m[1] || "").trim();
  if (!name) return null;
  const parts = name.split(/\s+/);
  return {
    file: String(fileName).trim(),
    name,
    lastName: parts[parts.length - 1] || name,
    affiliation: (m[2] || "").trim(),
  };
}

function personDisplayName(person, nameStyle) {
  if (!person) return "";
  return nameStyle === "last" ? person.lastName : person.name;
}

// Relative URL into the People folder, so a moved presenter keeps working as
// long as the folder travels with it.
function personPortraitUrl(fileName) {
  return `./${PEOPLE_FOLDER_NAME}/${encodeURIComponent(fileName)}`;
}

// Slides store bare file names, which self-describe name and affiliation, so
// rendering works even before the People folder has been scanned on this machine.
function getPersonByFile(fileName) {
  return state.people.find((p) => p.file === fileName) || parsePersonFileName(fileName);
}

function sortPeopleList() {
  state.people.sort((a, b) => naturalCollator.compare(a.name, b.name));
}

function loadPeopleFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(PEOPLE_STORAGE_KEY) || "null");
    if (!raw || !Array.isArray(raw.files)) return;
    state.people = raw.files.map(parsePersonFileName).filter(Boolean);
    state.peopleScannedAt = typeof raw.scannedAt === "string" ? raw.scannedAt : "";
    sortPeopleList();
  } catch {
    state.people = [];
  }
}

function savePeopleToStorage() {
  try {
    localStorage.setItem(PEOPLE_STORAGE_KEY, JSON.stringify({
      scannedAt: state.peopleScannedAt,
      files: state.people.map((p) => p.file),
    }));
  } catch {
    // Ignore private mode/storage quota issues.
  }
}

// Handle the "Scan People folder" directory picker: keep image files sitting
// directly inside the picked folder, parse "Name (Affiliation).ext", and cache
// the list so it restores automatically on the next startup.
function scanPeopleFolderFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const pickedFolder = (files[0].webkitRelativePath || "").split("/")[0] || "";
  const people = [];
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    if (rel.split("/").length !== 2) continue; // skip files nested in sub-folders
    const person = parsePersonFileName(f.name);
    if (person) people.push(person);
  }
  if (!people.length) {
    dom.modeHint.textContent = "No portrait images (png/jpg) found in the picked folder.";
    return;
  }
  state.people = people;
  state.peopleScannedAt = new Date().toISOString();
  sortPeopleList();
  savePeopleToStorage();
  dom.modeHint.textContent = pickedFolder && pickedFolder !== PEOPLE_FOLDER_NAME
    ? `Scanned "${pickedFolder}" (${people.length} portraits) — note portraits always load from the "${PEOPLE_FOLDER_NAME}" folder next to the presenter file.`
    : `People folder scanned: ${people.length} portrait(s) found.`;
  renderCreditsControls();
  renderStage();
}

/* The webkitdirectory input cannot be pointed at a default folder, so on
 * browsers with the File System Access API the "Scan People folder" chooser
 * uses showDirectoryPicker instead: the picked People directory handle is
 * persisted in IndexedDB and passed back as startIn, so after the first pick
 * the dialog opens directly at the People folder next to the presenter. */
const PEOPLE_DIR_DB_NAME = "presenterPeopleDir";
const PEOPLE_DIR_STORE = "handles";
const PEOPLE_DIR_KEY = "peopleFolder";

function openPeopleDirDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PEOPLE_DIR_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PEOPLE_DIR_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePeopleDirHandle(handle) {
  try {
    const db = await openPeopleDirDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PEOPLE_DIR_STORE, "readwrite");
      tx.objectStore(PEOPLE_DIR_STORE).put(handle, PEOPLE_DIR_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Handle persistence is best-effort; scanning still works without it.
  }
}

async function loadPeopleDirHandle() {
  try {
    const db = await openPeopleDirDb();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(PEOPLE_DIR_STORE, "readonly");
      const req = tx.objectStore(PEOPLE_DIR_STORE).get(PEOPLE_DIR_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

async function pickAndScanPeopleFolder() {
  const storedHandle = await loadPeopleDirHandle();
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({
      id: "peopleFolder", // lets the browser remember the last-picked location
      ...(storedHandle ? { startIn: storedHandle } : {}),
    });
  } catch (err) {
    if (err?.name === "AbortError") return; // user cancelled the dialog
    dom.peopleFolderInput?.click(); // picker unavailable: use the classic input
    return;
  }
  const files = [];
  for await (const entry of dirHandle.values()) {
    if (entry?.kind === "file") {
      // Minimal File-like shape consumed by scanPeopleFolderFiles.
      files.push({ name: entry.name, webkitRelativePath: `${dirHandle.name}/${entry.name}` });
    }
  }
  void savePeopleDirHandle(dirHandle);
  scanPeopleFolderFiles(files);
}

// One portrait card (photo + caption), shared by the credits strip and the
// acknowledgements grid. Sizes are passed in as pixels derived from the live
// stage width, so everything scales with the window (renderStage reruns on resize).
function buildCreditFigure(person, opts) {
  const fig = document.createElement("figure");
  fig.className = "credit-person";
  fig.style.width = `${opts.portraitPx}px`;
  const img = document.createElement("img");
  img.src = personPortraitUrl(person.file);
  img.alt = person.name;
  img.draggable = false;
  img.style.height = `${opts.portraitPx * 1.15}px`;
  img.addEventListener("error", () => fig.classList.add("portrait-missing"));
  fig.appendChild(img);
  const cap = document.createElement("figcaption");
  const nameEl = document.createElement("div");
  nameEl.className = "credit-name";
  nameEl.style.fontSize = `${opts.namePx}px`;
  nameEl.textContent = personDisplayName(person, opts.nameStyle);
  cap.appendChild(nameEl);
  if (opts.showAffiliation && person.affiliation) {
    const affEl = document.createElement("div");
    affEl.className = "credit-affil";
    affEl.style.fontSize = `${opts.affilPx}px`;
    affEl.textContent = person.affiliation;
    cap.appendChild(affEl);
  }
  fig.appendChild(cap);
  return fig;
}

// Credits strip: the slide's chosen people, in checked order, pinned to the
// deck-global corner. Returns null when nothing should render.
function buildSlideCreditsLayer(slide) {
  ensureSlideCreditsDefaults(slide);
  const cfg = ensureDeckCreditsSettings(state.deck);
  if (slide.credits.mode === "off" || !slide.credits.people.length) return null;
  const stageW = dom.stage.clientWidth || 1280;
  if (slide.credits.mode === "ack") {
    return buildSlideAckLayer(slide, cfg, stageW);
  }
  const wrap = document.createElement("div");
  // Placement is per-slide when set, otherwise the deck default (cfg.position).
  const effectivePosition = slide.credits.position || cfg.position;
  wrap.className = `slide-credits pos-${effectivePosition}${slide.credits.invert ? " inverted" : ""}`;
  applyCreditsLayerFlags(wrap, slide, cfg);
  wrap.style.gap = `${stageW * 0.008 * cfg.scale}px`;
  const figOpts = {
    portraitPx: stageW * 0.06 * cfg.scale,
    namePx: stageW * 0.0115 * cfg.scale,
    affilPx: stageW * 0.0095 * cfg.scale,
    nameStyle: cfg.nameStyle,
    showAffiliation: cfg.showAffiliation,
  };
  for (const fileName of slide.credits.people) {
    const person = getPersonByFile(fileName);
    if (person) wrap.appendChild(buildCreditFigure(person, figOpts));
  }
  if (!wrap.childElementCount) return null;
  wrap.appendChild(buildCreditsHideDot(slide));
  return wrap;
}

// Shared modifier classes for both credits strip and acknowledgements layer:
// deck-global narrow-font / shade flags plus the runtime "portraits hidden" state.
function applyCreditsLayerFlags(wrap, slide, cfg) {
  if (cfg.narrowNames) wrap.classList.add("narrow-names");
  if (cfg.shade) wrap.classList.add("shaded");
  if (state.creditsHiddenSlides.has(slide)) wrap.classList.add("people-collapsed");
}

// Small discrete circle next to the portraits: one click hides them so the
// slide gets its full space back after the faces have been shown, another
// click brings them back. Works in edit and present mode; never saved.
function buildCreditsHideDot(slide) {
  const dot = document.createElement("button");
  dot.type = "button";
  dot.className = "credits-hide-dot";
  const hidden = state.creditsHiddenSlides.has(slide);
  dot.title = hidden ? "Show people" : "Hide people";
  dot.setAttribute("aria-label", dot.title);
  // Keep stage drag/draw and present-mode click handlers from seeing this press.
  dot.addEventListener("pointerdown", (e) => e.stopPropagation());
  dot.addEventListener("mousedown", (e) => e.stopPropagation());
  dot.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.creditsHiddenSlides.has(slide)) state.creditsHiddenSlides.delete(slide);
    else state.creditsHiddenSlides.add(slide);
    refreshSlideCreditsLayerInPlace(slide);
  });
  return dot;
}

// Acknowledgements: the chosen people grouped into affiliation columns,
// centered on the slide. Groups with many people widen to 2-3 portrait
// columns under the shared affiliation heading.
function buildSlideAckLayer(slide, cfg, stageW) {
  const groups = new Map();
  for (const fileName of slide.credits.people) {
    const person = getPersonByFile(fileName);
    if (!person) continue;
    const key = person.affiliation || "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  if (!groups.size) return null;

  const style = ACK_STYLE_KEYS.includes(cfg.ackStyle) ? cfg.ackStyle : "columns";
  // Mosaic drops the affiliation headings and tags each face instead, so the
  // affiliation still travels with the portrait.
  const isMosaic = style === "mosaic";
  const portraitPx = stageW * 0.055 * cfg.ackPortraitScale;
  const figOpts = {
    portraitPx,
    namePx: stageW * 0.010 * cfg.ackPortraitScale,
    affilPx: stageW * 0.0085 * cfg.ackPortraitScale,
    nameStyle: cfg.nameStyle,
    showAffiliation: isMosaic, // headings name the affiliation in the other styles
  };

  const wrap = document.createElement("div");
  wrap.className = `slide-ack ack-style-${style}${slide.credits.invert ? " inverted" : ""}`;
  applyCreditsLayerFlags(wrap, slide, cfg);

  // One scalable rectangle holding whichever layout is selected.
  const area = document.createElement("div");
  area.className = "ack-area";
  area.style.transform = `scale(${cfg.ackAreaScale})`;
  area.style.gap = `${portraitPx * 0.5}px`;

  // Card and banner styles carry a printed "Acknowledgements" title.
  if (style === "card" || style === "banner") {
    const title = document.createElement("div");
    title.className = "ack-title";
    title.textContent = "Acknowledgements";
    title.style.fontSize = `${stageW * 0.016 * cfg.ackPortraitScale}px`;
    area.appendChild(title);
  }

  // Body wrapper lets the title sit outside the flowing groups (card/banner).
  const body = document.createElement("div");
  body.className = "ack-body";
  body.style.gap = `${portraitPx * 0.5}px`;

  for (const [affiliation, people] of groups) {
    const group = document.createElement("section");
    group.className = "ack-group";
    if (!isMosaic) {
      const heading = document.createElement("h3");
      heading.textContent = affiliation;
      heading.style.fontSize = `${stageW * 0.013 * cfg.ackPortraitScale}px`;
      group.appendChild(heading);
    }
    const grid = document.createElement("div");
    grid.className = "ack-grid";
    const cols = isMosaic
      ? people.length
      : Math.min(3, Math.max(1, Math.ceil(people.length / 3)));
    grid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
    grid.style.gap = `${portraitPx * 0.18}px`;
    for (const person of people) {
      grid.appendChild(buildCreditFigure(person, figOpts));
    }
    group.appendChild(grid);
    body.appendChild(group);
  }
  area.appendChild(body);
  wrap.appendChild(area);
  wrap.appendChild(buildCreditsHideDot(slide));
  return wrap;
}

// References line pinned to the very bottom of the slide.
function buildSlideReferencesBar(slide) {
  ensureSlideCreditsDefaults(slide);
  const cfg = ensureDeckCreditsSettings(state.deck);
  const text = (slide.references.text || "").trim();
  if (!text) return null;
  const stageW = dom.stage.clientWidth || 1280;
  const el = document.createElement("div");
  el.className = `slide-references${slide.references.invert ? " inverted" : ""}`;
  el.style.fontSize = `${stageW * 0.0105 * cfg.referencesScale}px`;
  el.textContent = text;
  return el;
}

// Swap only the credits/ack layer inside the stage, so picker clicks and
// format tweaks do not rebuild iframes/videos the way a full renderStage would.
function refreshSlideCreditsLayerInPlace(slide) {
  const existing = dom.stage.querySelector(":scope > .slide-credits, :scope > .slide-ack");
  const fresh = slide ? buildSlideCreditsLayer(slide) : null;
  if (existing && fresh) existing.replaceWith(fresh);
  else if (existing) existing.remove();
  else if (fresh) dom.stage.appendChild(fresh);
}

// Same in-place swap for the references bar (used while typing the text).
function refreshSlideReferencesBarInPlace(slide) {
  const existing = dom.stage.querySelector(":scope > .slide-references");
  const fresh = slide ? buildSlideReferencesBar(slide) : null;
  if (existing && fresh) existing.replaceWith(fresh);
  else if (existing) existing.remove();
  else if (fresh) dom.stage.appendChild(fresh);
}

// Sync the People & Credits sidebar panel and the floating people picker with
// the current slide / deck settings.
function renderCreditsControls() {
  const cfg = ensureDeckCreditsSettings(state.deck);
  const slide = currentSlide();
  if (slide) ensureSlideCreditsDefaults(slide);

  if (dom.creditsPositionSelect) {
    // Position is per-slide: show this slide's choice ("" = inherit), and label
    // the inherit option with the actual deck default for clarity.
    const defaultOpt = dom.creditsPositionSelect.querySelector('option[value=""]');
    if (defaultOpt) defaultOpt.textContent = `— Deck default (${cfg.position}) —`;
    dom.creditsPositionSelect.value = slide ? (slide.credits.position || "") : "";
    dom.creditsPositionSelect.disabled = !slide;
  }
  if (dom.creditsNameStyleSelect) dom.creditsNameStyleSelect.value = cfg.nameStyle;
  if (dom.creditsAckStyleSelect) dom.creditsAckStyleSelect.value = cfg.ackStyle;
  if (dom.creditsNarrowFontCheckbox) dom.creditsNarrowFontCheckbox.checked = cfg.narrowNames;
  if (dom.creditsShadeCheckbox) dom.creditsShadeCheckbox.checked = cfg.shade;
  if (dom.creditsShowAffiliationCheckbox) dom.creditsShowAffiliationCheckbox.checked = cfg.showAffiliation;
  if (dom.creditsScaleRange) dom.creditsScaleRange.value = String(cfg.scale);
  if (dom.creditsScaleValue) dom.creditsScaleValue.textContent = `${Math.round(cfg.scale * 100)}%`;
  if (dom.ackPortraitScaleRange) dom.ackPortraitScaleRange.value = String(cfg.ackPortraitScale);
  if (dom.ackPortraitScaleValue) dom.ackPortraitScaleValue.textContent = `${Math.round(cfg.ackPortraitScale * 100)}%`;
  if (dom.ackAreaScaleRange) dom.ackAreaScaleRange.value = String(cfg.ackAreaScale);
  if (dom.ackAreaScaleValue) dom.ackAreaScaleValue.textContent = `${Math.round(cfg.ackAreaScale * 100)}%`;
  if (dom.referencesScaleRange) dom.referencesScaleRange.value = String(cfg.referencesScale);
  if (dom.referencesScaleValue) dom.referencesScaleValue.textContent = `${Math.round(cfg.referencesScale * 100)}%`;

  const hasSlide = !!slide;
  const mode = hasSlide ? slide.credits.mode : "off";
  if (dom.creditsEnabledCheckbox) {
    dom.creditsEnabledCheckbox.checked = mode === "credits";
    dom.creditsEnabledCheckbox.disabled = !hasSlide;
  }
  if (dom.ackEnabledCheckbox) {
    dom.ackEnabledCheckbox.checked = mode === "ack";
    dom.ackEnabledCheckbox.disabled = !hasSlide;
  }
  if (dom.creditsInvertCheckbox) {
    dom.creditsInvertCheckbox.checked = hasSlide && slide.credits.invert;
    dom.creditsInvertCheckbox.disabled = !hasSlide;
  }
  if (dom.referencesTextInput) {
    if (document.activeElement !== dom.referencesTextInput) {
      dom.referencesTextInput.value = hasSlide ? slide.references.text : "";
    }
    dom.referencesTextInput.disabled = !hasSlide;
  }
  if (dom.referencesInvertCheckbox) {
    dom.referencesInvertCheckbox.checked = hasSlide && slide.references.invert;
    dom.referencesInvertCheckbox.disabled = !hasSlide;
  }
  if (dom.creditsPickerOpenBtn) {
    dom.creditsPickerOpenBtn.disabled = !hasSlide || mode === "off";
  }
  if (dom.peopleScanHint) {
    dom.peopleScanHint.textContent = state.people.length
      ? `${state.people.length} people cached${state.peopleScannedAt ? ` (scanned ${state.peopleScannedAt.slice(0, 10)})` : ""}. Re-scan after adding photos.`
      : `No people scanned yet. Pick the "${PEOPLE_FOLDER_NAME}" folder next to the presenter file.`;
  }
  renderCreditsPicker();
}

function creditsPickerShouldShow() {
  const slide = currentSlide();
  return state.mode === "edit" && !state.creditsPickerHidden && !!slide && slide.credits?.mode !== "off";
}

// Rebuild the floating people-picker window. It lives outside the stage, so
// stage rebuilds never disturb it.
function renderCreditsPicker() {
  if (!dom.creditsPicker) return;
  const show = creditsPickerShouldShow();
  dom.creditsPicker.classList.toggle("hidden", !show);
  if (!show) return;
  const slide = currentSlide();
  ensureSlideCreditsDefaults(slide);
  const chosen = slide.credits.people;
  if (dom.creditsPickerHint) {
    dom.creditsPickerHint.textContent = state.people.length
      ? "Check people in the order they should appear."
      : "Scan the People folder first (People & Credits panel).";
  }
  dom.creditsPickerList.innerHTML = "";
  for (const person of state.people) {
    const row = document.createElement("label");
    row.className = "credits-picker-row";
    const check = document.createElement("input");
    check.type = "checkbox";
    const orderIndex = chosen.indexOf(person.file);
    check.checked = orderIndex !== -1;
    check.addEventListener("change", () => {
      toggleSlideCreditPerson(person.file, check.checked);
    });
    const thumb = document.createElement("img");
    thumb.className = "credits-picker-thumb";
    thumb.src = personPortraitUrl(person.file);
    thumb.alt = "";
    thumb.draggable = false;
    thumb.addEventListener("error", () => { thumb.style.visibility = "hidden"; });
    const label = document.createElement("span");
    label.className = "credits-picker-name";
    label.textContent = person.affiliation ? `${person.name} (${person.affiliation})` : person.name;
    const order = document.createElement("span");
    order.className = "credits-picker-order";
    order.textContent = orderIndex !== -1 ? String(orderIndex + 1) : "";
    row.append(check, thumb, label, order);
    dom.creditsPickerList.appendChild(row);
  }
}

function toggleSlideCreditPerson(fileName, on) {
  const slide = currentSlide();
  if (!slide) return;
  ensureSlideCreditsDefaults(slide);
  const list = slide.credits.people;
  const at = list.indexOf(fileName);
  if (on && at === -1) list.push(fileName);
  if (!on && at !== -1) list.splice(at, 1);
  touch();
  renderCreditsPicker();
  refreshSlideCreditsLayerInPlace(slide);
}

function initCreditsPicker() {
  if (!dom.creditsPicker) return;
  try {
    const pos = JSON.parse(localStorage.getItem(CREDITS_PICKER_POSITION_STORAGE_KEY) || "null");
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      dom.creditsPicker.style.left = `${clamp(pos.x, 0, Math.max(0, window.innerWidth - 120))}px`;
      dom.creditsPicker.style.top = `${clamp(pos.y, 0, Math.max(0, window.innerHeight - 80))}px`;
      dom.creditsPicker.style.right = "auto";
    }
  } catch {
    // Ignore malformed stored position.
  }
  dom.creditsPickerDragHandle?.addEventListener("pointerdown", startCreditsPickerDrag);
  window.addEventListener("pointermove", onCreditsPickerPointerMove);
  window.addEventListener("pointerup", onCreditsPickerPointerUp);
  dom.creditsPickerCloseBtn?.addEventListener("click", () => {
    state.creditsPickerHidden = true;
    renderCreditsPicker();
  });
  dom.creditsPickerClearBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!slide) return;
    ensureSlideCreditsDefaults(slide);
    slide.credits.people = [];
    touch();
    renderCreditsPicker();
    refreshSlideCreditsLayerInPlace(slide);
  });
}

function startCreditsPickerDrag(e) {
  e.preventDefault();
  const rect = dom.creditsPicker.getBoundingClientRect();
  dom.creditsPicker.style.left = `${rect.left}px`;
  dom.creditsPicker.style.top = `${rect.top}px`;
  dom.creditsPicker.style.right = "auto";
  state.creditsPickerDragCtx = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
}

function onCreditsPickerPointerMove(e) {
  const ctx = state.creditsPickerDragCtx;
  if (!ctx) return;
  const x = clamp(e.clientX - ctx.dx, 0, Math.max(0, window.innerWidth - dom.creditsPicker.offsetWidth));
  const y = clamp(e.clientY - ctx.dy, 0, Math.max(0, window.innerHeight - dom.creditsPicker.offsetHeight));
  dom.creditsPicker.style.left = `${x}px`;
  dom.creditsPicker.style.top = `${y}px`;
}

function onCreditsPickerPointerUp() {
  if (!state.creditsPickerDragCtx) return;
  state.creditsPickerDragCtx = null;
  try {
    localStorage.setItem(CREDITS_PICKER_POSITION_STORAGE_KEY, JSON.stringify({
      x: parseFloat(dom.creditsPicker.style.left) || 0,
      y: parseFloat(dom.creditsPicker.style.top) || 0,
    }));
  } catch {
    // Ignore private mode/storage quota issues.
  }
}

// Short label used inside the progress bar / thumbnail headers.
function sectionShortLabel(slide) {
  if (!slide) return "";
  return (slide.titleShort || slide.titleLong || slide.name || "Section").trim() || "Section";
}

// An asset that is a live HTML simulation rather than a picture.
function isHtmlSimAsset(asset) {
  return !!asset && (asset.kind === "overlay-html-file"
    || asset.kind === "overlay-html-filelink"
    || asset.kind === "overlay-html-external");
}

// Build a live <iframe> for an HTML-sim asset used as divider media. Mirrors the
// overlay iframe logic (srcdoc/src + sandbox). Non-interactive in edit mode.
function buildDividerSimIframe(source) {
  const iframe = document.createElement("iframe");
  iframe.className = "sdv-sim";
  iframe.loading = "eager";
  const htmlText = source.htmlText || "";
  if (source.kind === "overlay-html-external") {
    iframe.src = source.url || "";
    iframe.removeAttribute("sandbox");
    iframe.referrerPolicy = "no-referrer-when-downgrade";
  } else if (source.kind === "overlay-html-filelink") {
    const useSnapshot = !!source.preferSnapshot && !!source.htmlText;
    const url = useSnapshot ? "" : resolveHtmlFileLinkUrl(source);
    if (url) {
      iframe.src = url;
      iframe.removeAttribute("sandbox");
      iframe.referrerPolicy = "no-referrer-when-downgrade";
    } else if (htmlText) {
      iframe.srcdoc = htmlText;
      iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-pointer-lock");
    }
  } else { // overlay-html-file
    const externalUrl = resolveHtmlFileSourceExternalUrl(source, htmlText);
    if (externalUrl) iframe.src = externalUrl; else iframe.srcdoc = htmlText;
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-pointer-lock");
  }
  iframe.style.pointerEvents = (state.mode === "edit") ? "none" : "auto";
  bindEmbedResizeKick(iframe);
  return iframe;
}

// Import an HTML file as a sim asset and set it as the current divider's or
// title-page's media (both use slide.slideAssetId for their media).
async function importSectionDividerSim(file) {
  const slide = currentSlide();
  if ((!isSectionDivider(slide) && !isTitleSlide(slide)) || !file) return;
  const htmlText = await fileToText(file);
  const id = uid();
  state.deck.assets[id] = { id, kind: "overlay-html-file", mime: "text/html", name: file.name, htmlText };
  slide.slideAssetId = id;
  slide.name = file.name;
  touch();
  renderAll();
}

// Build the styled divider composition (1 title + 1 image/sim + optional progress).
// The 5 style variants share this DOM; the `sdv-<style>` class drives layout.
function buildSectionDividerLayer(slide, slideAsset) {
  normalizeSectionDividerSlide(slide);
  const style = normalizeSectionStyle(slide.sectionStyle);
  const layer = document.createElement("div");
  layer.className = `section-divider-layer sdv-${style}`;

  const media = document.createElement("div");
  media.className = "sdv-media";
  if (isHtmlSimAsset(slideAsset)) {
    media.classList.add("sdv-media-sim");
    media.appendChild(buildDividerSimIframe(slideAsset));
  } else {
    const url = slideAsset?.dataUrl ? getImageDisplayUrl(slideAsset) : "";
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = slide.titleLong || slide.name || "Section image";
      img.draggable = false;
      media.appendChild(img);
    } else {
      media.classList.add("sdv-media-empty");
      if (state.mode === "edit") {
        const ph = document.createElement("div");
        ph.className = "sdv-media-placeholder";
        ph.textContent = "Add a divider image or HTML sim in the Section Divider panel";
        media.appendChild(ph);
      }
    }
  }
  layer.appendChild(media);

  const content = document.createElement("div");
  content.className = "sdv-content";
  if (slide.eyebrowVisible !== false) {
    const eyebrow = document.createElement("div");
    eyebrow.className = "sdv-eyebrow";
    eyebrow.textContent = sectionEyebrowText(slide);
    content.appendChild(eyebrow);
  }
  const title = document.createElement("h1");
  title.className = "sdv-title";
  title.textContent = slide.titleLong || slide.name || "Untitled section";
  content.appendChild(title);
  layer.appendChild(content);

  if (state.deck.settings?.showSectionProgress !== false) {
    const strip = buildSectionProgressStrip(slide);
    if (strip) {
      layer.appendChild(strip);
    }
  }
  return layer;
}

// Build one figure+text cell. `interactive` adds edit affordances (figure
// toolbar, contenteditable text); off for thumbnails / present snapshots.
function buildSummaryCell(slide, item, idx, interactive) {
  const cell = document.createElement("div");
  cell.className = "summary-cell";
  cell.dataset.itemId = item.id;
  if (interactive && item.id === state.summarySelectedItemId) cell.classList.add("selected");

  const fig = document.createElement("div");
  fig.className = "summary-figure";
  fig.dataset.itemId = item.id;
  const source = item.assetId ? resolveAssetByAnyId(item.assetId) : null;
  if (source && isHtmlSimAsset(source)) {
    fig.classList.add("has-content", "is-html");
    const frame = buildDividerSimIframe(source);
    frame.classList.add("summary-figure-frame");
    fig.appendChild(frame);
  } else if (source && source.dataUrl) {
    fig.classList.add("has-content", "is-image");
    const img = document.createElement("img");
    img.className = "summary-figure-img";
    img.src = getImageDisplayUrl(source);
    img.alt = source.name || "";
    img.draggable = false;
    fig.appendChild(img);
  } else {
    fig.classList.add("is-empty");
    if (interactive) {
      const ph = document.createElement("div");
      ph.className = "summary-figure-ph";
      ph.textContent = `Figure ${idx + 1}`;
      fig.appendChild(ph);
    }
  }

  // Present mode: figures with content open the shared zoom modal on click.
  if (!interactive && state.mode === "present" && fig.classList.contains("has-content")) {
    fig.classList.add("zoomable");
    const hint = document.createElement("div");
    hint.className = "summary-zoom-hint";
    hint.textContent = "🔍";
    hint.title = "Click to enlarge";
    fig.appendChild(hint);
  }

  // Edit mode: a small figure toolbar (image / html / clear).
  if (interactive) {
    const bar = document.createElement("div");
    bar.className = "summary-cell-toolbar";
    const mkBtn = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "summary-cell-btn";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      return b;
    };
    bar.appendChild(mkBtn("🖼", "Set image figure", () => pickSummaryFigureImage(slide, item)));
    bar.appendChild(mkBtn("◧", "Set HTML figure", () => pickSummaryFigureHtml(slide, item)));
    bar.appendChild(mkBtn("⌫", "Clear figure", () => { item.assetId = ""; touch(); renderAll(); }));
    fig.appendChild(bar);
  }
  cell.appendChild(fig);

  const text = document.createElement("div");
  text.className = "summary-text";
  text.dataset.itemId = item.id;
  if (interactive) {
    text.contentEditable = "true";
    text.spellcheck = false;
    text.dataset.placeholder = `Text for figure ${idx + 1}…`;
    // Editing text must not start a block-drag; keep the event off the stage.
    text.addEventListener("mousedown", (e) => e.stopPropagation());
    text.addEventListener("focus", () => { state.summarySelectedItemId = item.id; });
    // Save on input WITHOUT re-rendering (that would drop the caret); the panel
    // textarea is guarded by activeElement so it won't fight this.
    text.addEventListener("input", () => { item.text = text.innerHTML; touch(); });
    text.addEventListener("blur", () => { item.text = text.innerHTML; touch(); renderSummaryControls(); });
  }
  text.innerHTML = item.text || "";
  cell.appendChild(text);

  return cell;
}

// The styled summary composition on the stage (movable/resizable block).
function buildSummaryLayer(slide) {
  normalizeSummarySlide(slide);
  const style = normalizeSummaryStyle(slide.summaryStyle);
  const layout = normalizeSummaryLayout(slide.summaryLayout);
  const editing = state.mode === "edit";
  // Sequential reveal only applies while presenting; edit mode always shows all
  // cells so they can be authored.
  const sequential = state.mode === "present"
    && normalizeSummaryReveal(slide.summaryReveal) === "sequential";
  const layer = document.createElement("div");
  layer.className = `summary-layer sum-${style} layout-${layout}${sequential ? " sum-sequential" : ""}`;

  const block = document.createElement("div");
  block.className = "summary-block";
  const rect = slide.summaryRect;
  block.style.left = `${rect.x * 100}%`;
  block.style.top = `${rect.y * 100}%`;
  block.style.width = `${rect.w * 100}%`;
  block.style.height = `${rect.h * 100}%`;
  block.style.setProperty("--sum-img-zoom", String(slide.summaryImageZoom));
  block.style.setProperty("--sum-text-zoom", String(slide.summaryTextZoom));

  const head = document.createElement("div");
  head.className = "summary-head";
  if ((slide.summaryEyebrow || "").trim()) {
    const eb = document.createElement("div");
    eb.className = "summary-eyebrow";
    eb.textContent = slide.summaryEyebrow.trim();
    head.appendChild(eb);
  }
  const title = document.createElement("h2");
  title.className = "summary-title";
  title.textContent = slide.summaryTitle || "Summary";
  head.appendChild(title);
  block.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "summary-grid";
  slide.summaryItems.forEach((item, idx) => {
    const cell = buildSummaryCell(slide, item, idx, editing);
    // Cells already advanced past stay revealed across re-renders; the rest fade
    // in on click (see advancePresenterSequence + .sum-sequential CSS).
    if (sequential && idx < state.summaryRevealCount) cell.classList.add("is-revealed");
    grid.appendChild(cell);
  });
  block.appendChild(grid);

  if (editing) {
    const grip = document.createElement("div");
    grip.className = "summary-move-grip";
    grip.title = "Drag to move the summary block";
    grip.textContent = "⠿";
    block.appendChild(grip);
    const handle = document.createElement("div");
    handle.className = "summary-resize-handle resize-handle";
    handle.title = "Drag to resize (hold Shift to keep aspect ratio)";
    block.appendChild(handle);
  }

  layer.appendChild(block);
  return layer;
}

// Static miniature used inside a thumbnail card (no live iframes / edit chrome).
function buildSummaryThumb(slide) {
  normalizeSummarySlide(slide);
  const style = normalizeSummaryStyle(slide.summaryStyle);
  const layout = normalizeSummaryLayout(slide.summaryLayout);
  const layer = document.createElement("div");
  layer.className = `summary-layer sum-${style} layout-${layout} is-thumb`;
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;";

  const block = document.createElement("div");
  block.className = "summary-block";
  const r = slide.summaryRect;
  block.style.left = `${r.x * 100}%`;
  block.style.top = `${r.y * 100}%`;
  block.style.width = `${r.w * 100}%`;
  block.style.height = `${r.h * 100}%`;
  block.style.setProperty("--sum-img-zoom", String(slide.summaryImageZoom));
  block.style.setProperty("--sum-text-zoom", String(slide.summaryTextZoom));

  const head = document.createElement("div");
  head.className = "summary-head";
  if ((slide.summaryEyebrow || "").trim()) {
    const eb = document.createElement("div");
    eb.className = "summary-eyebrow";
    eb.textContent = slide.summaryEyebrow.trim();
    head.appendChild(eb);
  }
  const title = document.createElement("h2");
  title.className = "summary-title";
  title.textContent = slide.summaryTitle || "Summary";
  head.appendChild(title);
  block.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "summary-grid";
  slide.summaryItems.forEach((item) => {
    const cell = document.createElement("div");
    cell.className = "summary-cell";
    const fig = document.createElement("div");
    fig.className = "summary-figure";
    const source = item.assetId ? resolveAssetByAnyId(item.assetId) : null;
    if (source && isHtmlSimAsset(source)) {
      fig.classList.add("has-content", "is-html");
      const tag = document.createElement("div");
      tag.className = "summary-figure-ph";
      tag.textContent = "◧";
      fig.appendChild(tag);
    } else if (source && source.dataUrl) {
      fig.classList.add("has-content", "is-image");
      const img = document.createElement("img");
      img.className = "summary-figure-img";
      img.src = getImageDisplayUrl(source);
      img.draggable = false;
      fig.appendChild(img);
    } else {
      fig.classList.add("is-empty");
    }
    cell.appendChild(fig);
    const text = document.createElement("div");
    text.className = "summary-text";
    text.innerHTML = item.text || "";
    cell.appendChild(text);
    grid.appendChild(cell);
  });
  block.appendChild(grid);
  layer.appendChild(block);
  return layer;
}

/* ─── Title-page rendering (v14) ─────────────────────────────────────────────
 * Full-bleed layer with title, subtitle, presenters, optional event line and
 * optional prominent DTU logo, plus an optional image or sim as media (using
 * slide.slideAssetId, like section dividers). Five layouts × two variants. */

// Common HTML for the title text block; reused by the live layer and the
// thumbnail miniature so both look the same.
function buildTitleTextBlock(slide) {
  const block = document.createElement("div");
  block.className = "tp-content";

  const main = document.createElement("h1");
  main.className = "tp-title";
  main.textContent = slide.titleMain || "Untitled";
  block.appendChild(main);

  if ((slide.titleSubtitle || "").trim()) {
    const sub = document.createElement("div");
    sub.className = "tp-subtitle";
    sub.textContent = slide.titleSubtitle.trim();
    block.appendChild(sub);
  }

  if (slide.titlePresenters && slide.titlePresenters.length) {
    const list = document.createElement("ul");
    list.className = "tp-presenters";
    slide.titlePresenters.forEach((p) => {
      if (!p) return;
      const name = (p.name || "").trim();
      const aff  = (p.affiliation || "").trim();
      if (!name && !aff) return;
      const li = document.createElement("li");
      li.className = "tp-presenter";
      const nameEl = document.createElement("span");
      nameEl.className = "tp-presenter-name";
      nameEl.textContent = name;
      li.appendChild(nameEl);
      if (aff) {
        const affEl = document.createElement("span");
        affEl.className = "tp-presenter-affiliation";
        affEl.textContent = aff;
        li.appendChild(affEl);
      }
      list.appendChild(li);
    });
    if (list.children.length) block.appendChild(list);
  }

  if ((slide.titleEvent || "").trim()) {
    const ev = document.createElement("div");
    ev.className = "tp-event";
    ev.textContent = slide.titleEvent.trim();
    block.appendChild(ev);
  }

  return block;
}

// Build the media pane (image / HTML sim / empty placeholder) for a title
// slide. Shared by both stage and thumb — thumb uses a static sim placeholder.
function buildTitleMedia(slideAsset, thumb) {
  const media = document.createElement("div");
  media.className = "tp-media";
  if (isHtmlSimAsset(slideAsset)) {
    media.classList.add("tp-media-sim");
    if (thumb) {
      media.classList.add("tp-media-sim-thumb");
      const tag = document.createElement("div");
      tag.className = "tp-sim-thumb-tag";
      tag.textContent = "◧ sim";
      media.appendChild(tag);
    } else {
      media.appendChild(buildDividerSimIframe(slideAsset));
    }
  } else if (slideAsset?.dataUrl) {
    const img = document.createElement("img");
    img.src = getImageDisplayUrl(slideAsset);
    img.alt = slideAsset.name || "";
    img.draggable = false;
    media.appendChild(img);
  } else {
    media.classList.add("tp-media-empty");
    if (!thumb && state.mode === "edit") {
      const ph = document.createElement("div");
      ph.className = "tp-media-placeholder";
      ph.textContent = "Add an image or HTML sim in the Title Page panel";
      media.appendChild(ph);
    }
  }
  return media;
}

// Build the full-bleed title-page composition (stage view).
function buildTitleLayer(slide) {
  normalizeTitleSlide(slide);
  const style = normalizeTitleStyle(slide.titleStyle);
  const variant = normalizeTitleVariant(slide.titleVariant);
  const layer = document.createElement("div");
  layer.className = `title-page-layer tp-${style} tp-var-${variant}`;

  layer.appendChild(buildTitleMedia(resolveAssetByAnyId(slide.slideAssetId), false));
  layer.appendChild(buildTitleTextBlock(slide));

  if (slide.titleLogoVisible !== false) {
    const logo = document.createElement("img");
    logo.className = "tp-dtu-logo";
    logo.src = LOGO_ASSET_URL;
    logo.alt = "DTU";
    logo.draggable = false;
    layer.appendChild(logo);
  }
  return layer;
}

// Static miniature used inside a thumbnail card.
function buildTitleThumb(slide) {
  normalizeTitleSlide(slide);
  const style = normalizeTitleStyle(slide.titleStyle);
  const variant = normalizeTitleVariant(slide.titleVariant);
  const layer = document.createElement("div");
  layer.className = `title-page-layer tp-${style} tp-var-${variant} is-thumb`;
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  layer.appendChild(buildTitleMedia(resolveAssetByAnyId(slide.slideAssetId), true));
  layer.appendChild(buildTitleTextBlock(slide));
  if (slide.titleLogoVisible !== false) {
    const logo = document.createElement("img");
    logo.className = "tp-dtu-logo";
    logo.src = LOGO_ASSET_URL;
    logo.alt = "";
    logo.draggable = false;
    layer.appendChild(logo);
  }
  return layer;
}

// Import an image file and set it as the given summary cell's figure.
function pickSummaryFigureImage(slide, item) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/svg+xml,.png,.jpg,.jpeg,.gif,.svg";
  input.addEventListener("change", async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    const id = uid();
    state.deck.assets[id] = { id, kind: "overlay-image", mime: f.type || "image/png", name: f.name, dataUrl };
    item.assetId = id;
    state.summarySelectedItemId = item.id;
    touch();
    renderAll();
  });
  input.click();
}

// Import an HTML file and set it as the given summary cell's figure (live sim).
function pickSummaryFigureHtml(slide, item) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "text/html,.html";
  input.addEventListener("change", async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const htmlText = await fileToText(f);
    const id = uid();
    state.deck.assets[id] = { id, kind: "overlay-html-file", mime: "text/html", name: f.name, htmlText };
    item.assetId = id;
    state.summarySelectedItemId = item.id;
    touch();
    renderAll();
  });
  input.click();
}

// Open the shared zoom modal for a summary figure element (image or HTML sim).
function openZoomForSummaryFigureEl(figEl) {
  const slide = currentSlide();
  if (!isSummarySlide(slide) || !figEl) return;
  const item = slide.summaryItems.find((it) => it.id === figEl.dataset.itemId);
  const source = (item && item.assetId) ? resolveAssetByAnyId(item.assetId) : null;
  if (!source) return;
  dom.zoomViewport.innerHTML = "";
  if (isHtmlSimAsset(source)) {
    const iframe = buildDividerSimIframe(source);
    iframe.style.pointerEvents = "auto";
    dom.zoomViewport.appendChild(iframe);
  } else if (source.dataUrl) {
    const img = document.createElement("img");
    img.src = getImageDisplayUrl(source);
    img.style.objectFit = "contain";
    img.style.width = "100%";
    img.style.height = "100%";
    dom.zoomViewport.appendChild(img);
  } else {
    return;
  }
  dom.zoomModal.classList.remove("hidden");
}

// Bottom progress strip listing every section, highlighting the current one.
// Each label is clickable and jumps straight to that section's divider slide.
function buildSectionProgressStrip(currentDividerSlide) {
  const dividers = getProgressDividerSlides();
  if (!dividers.length) {
    return null;
  }
  const strip = document.createElement("div");
  strip.className = "section-progress";
  // Deck-global zoom for the whole strip (font + gaps scale together via --sp-scale).
  const spScale = safeClampNumber(state.deck.settings?.sectionProgressScale, 0.5, 2.5, 1);
  strip.style.setProperty("--sp-scale", String(spScale));
  const track = document.createElement("div");
  track.className = "section-progress-track";
  dividers.forEach((divider) => {
    const role = normalizeSectionRole(divider.sectionRole);
    const item = document.createElement("div");
    item.className = "section-progress-item role-" + role
      + (divider === currentDividerSlide ? " is-current" : "");
    const dot = document.createElement("span");
    dot.className = "section-progress-dot";
    const label = document.createElement("span");
    label.className = "section-progress-label";
    label.textContent = sectionShortLabel(divider);
    item.appendChild(dot);
    item.appendChild(label);
    item.title = `Go to ${sectionShortLabel(divider)}`;
    // stopPropagation keeps the stage's own mousedown (overlay drawing) and
    // presenter click handling from also reacting to the jump.
    item.addEventListener("mousedown", (e) => e.stopPropagation());
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const idx = state.deck.slides.indexOf(divider);
      if (idx >= 0) gotoSlide(idx);
    });
    track.appendChild(item);
  });
  strip.appendChild(track);
  return strip;
}

// Reference-sized divider composition used inside a thumbnail (scaled by the
// grid transform). Mirrors the stage layout minus the progress strip.
function buildSectionDividerThumb(slide, slideAsset, refW, refH, scale) {
  const style = normalizeSectionStyle(slide.sectionStyle);
  const layer = document.createElement("div");
  layer.className = `section-divider-layer sdv-${style} is-thumb`;
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;";

  const media = document.createElement("div");
  media.className = "sdv-media";
  if (isHtmlSimAsset(slideAsset)) {
    // Thumbnails show a static placeholder rather than a live iframe per card.
    media.classList.add("sdv-media-sim-thumb");
    const tag = document.createElement("div");
    tag.className = "sdv-sim-thumb-tag";
    tag.textContent = "◧ sim";
    media.appendChild(tag);
  } else {
    const url = slideAsset?.dataUrl ? getImageDisplayUrl(slideAsset) : "";
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.draggable = false;
      media.appendChild(img);
    } else {
      media.classList.add("sdv-media-empty");
    }
  }
  layer.appendChild(media);

  const content = document.createElement("div");
  content.className = "sdv-content";
  const title = document.createElement("h1");
  title.className = "sdv-title";
  title.textContent = slide.titleLong || slide.name || "Section";
  content.appendChild(title);
  layer.appendChild(content);

  return layer;
}

function normalizeAnimationAction(action) {
  const txt = String(action || "").trim().toLowerCase();
  if (
    txt === "appear-after-click"
    || txt === "appear-with-previous"
    || txt === "remove-after-click"
    || txt === "remove-with-previous"
  ) {
    return txt;
  }

  // Migrate older action names.
  if (txt === "appear-instant" || txt === "appear-fade") {
    return "appear-after-click";
  }
  if (txt === "disappear-instant" || txt === "disappear-fade") {
    return "remove-after-click";
  }

  return "appear-after-click";
}

function createAnimationEvent(overlayId, action = "appear-after-click") {
  return {
    id: uid(),
    overlayId: String(overlayId || ""),
    action: normalizeAnimationAction(action),
    durationMs: 0,
  };
}

function ensureSlideAnimationDefaults(slide) {
  if (!slide || typeof slide !== "object") {
    return;
  }

  if (!Array.isArray(slide.animationEvents)) {
    slide.animationEvents = [];
  }

  slide.animationEvents = slide.animationEvents
    .filter((ev) => ev && typeof ev === "object")
    .map((ev) => {
      const rawAction = String(ev.action || "").trim().toLowerCase();
      const defaultDuration = rawAction.includes("fade") ? 350 : 0;
      const out = {
        id: String(ev.id || uid()),
        overlayId: String(ev.overlayId || ""),
        action: normalizeAnimationAction(ev.action),
        durationMs: safeClampNumber(ev.durationMs, 0, 5000, defaultDuration),
      };
      const delayMs = safeClampNumber(ev.delayMs, 0, 60000, 0);
      const paragraph = Math.max(0, Math.round(Number(ev.paragraph) || 0));
      if (delayMs > 0) out.delayMs = delayMs;
      if (paragraph > 0) out.paragraph = paragraph;
      return out;
    });
}

function pruneMissingAnimationOverlayRefs(slide) {
  if (!slide) {
    return;
  }
  ensureSlideAnimationDefaults(slide);
  const ids = new Set((slide.overlays || []).map((o) => o.id));
  slide.animationEvents = (slide.animationEvents || []).filter((ev) => ev && ids.has(ev.overlayId));
}

function getCurrentSlideAnimationEvents() {
  const slide = currentSlide();
  if (!slide) {
    return [];
  }
  ensureSlideAnimationDefaults(slide);
  return slide.animationEvents;
}

function isAnimationActionAfterClick(action) {
  const normalized = normalizeAnimationAction(action);
  return normalized === "appear-after-click" || normalized === "remove-after-click";
}

function isAnimationActionAppear(action) {
  const normalized = normalizeAnimationAction(action);
  return normalized === "appear-after-click" || normalized === "appear-with-previous";
}

function startsHiddenBeforeAnimation(slide, overlayId) {
  if (!slide || !overlayId) {
    return false;
  }
  ensureSlideAnimationDefaults(slide);
  const events = slide.animationEvents || [];
  return events.some((ev) => ev && ev.overlayId === overlayId && !(ev.paragraph > 0) && isAnimationActionAppear(ev.action));
}

// ─── Paragraph steps and delays ───────────────────────────────────────────────
// The paragraphs of a text overlay's content element, in order: list items and top-level blocks. Loose text at
// the top (what typing gives before the first line break) is wrapped into a block first, so it counts as one.
function textOverlayParagraphs(textEl) {
  if (!textEl) return [];
  let run = [];
  const flush = () => {
    if (run.length && run.some((n) => n.nodeType === Node.ELEMENT_NODE || String(n.textContent || "").trim())) {
      const wrap = document.createElement("div");
      run[0].before(wrap);
      run.forEach((n) => wrap.appendChild(n));
    }
    run = [];
  };
  for (const n of Array.from(textEl.childNodes)) {
    if (n.nodeType === Node.ELEMENT_NODE && /^(DIV|P|UL|OL)$/.test(n.tagName)) flush();
    else run.push(n);
  }
  flush();
  return Array.from(textEl.querySelectorAll(":scope > div, :scope > p, li"));
}

// The paragraphs of a text source (for the panel): their first words
function textSourceParagraphLabels(source) {
  const holder = document.createElement("div");
  holder.innerHTML = String(source?.html || "");
  return textOverlayParagraphs(holder).map((p) => String(p.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28));
}

// overlay id -> set of paragraph numbers hidden at this step (only overlays that have paragraph steps)
function getParagraphHiddenMapForStep(slide, stepIndex) {
  const map = new Map();
  const events = slide?.animationEvents || [];
  const setOf = (id) => { if (!map.has(id)) map.set(id, new Set()); return map.get(id); };
  for (const ev of events) {
    if (ev && ev.paragraph > 0 && isAnimationActionAppear(ev.action)) setOf(ev.overlayId).add(ev.paragraph);
  }
  const end = Math.min(stepIndex, events.length - 1);
  for (let i = 0; i <= end; i++) {
    const ev = events[i];
    if (!ev || !(ev.paragraph > 0)) continue;
    if (isAnimationActionAppear(ev.action)) setOf(ev.overlayId).delete(ev.paragraph);
    else setOf(ev.overlayId).add(ev.paragraph);
  }
  return map;
}

function setParagraphShown(textEl, paragraph, show, fadeMs = 0) {
  const p = textOverlayParagraphs(textEl)[paragraph - 1];
  if (!p) return;
  p.style.transition = fadeMs > 0 ? `opacity ${fadeMs}ms ease` : "none";
  p.style.opacity = show ? "" : "0";
}

// a text overlay just built for the stage: hide the paragraphs that are not shown yet at this step
function applyParagraphStateToTextEl(textEl, overlayId, slide, stepIndex) {
  const hidden = getParagraphHiddenMapForStep(slide, stepIndex).get(overlayId);
  if (!hidden) return;
  textOverlayParagraphs(textEl).forEach((p, i) => {
    p.style.transition = "none";
    p.style.opacity = hidden.has(i + 1) ? "0" : "";
  });
}

function clearAnimationStepTimers() {
  (state.animationStepTimers || []).forEach((t) => clearTimeout(t));
  state.animationStepTimers = [];
}

// one step on the stage: the overlay (or one of its paragraphs) appears or goes, with the step's fade
function playAnimationEventOnStage(slide, ev, animate) {
  const el = dom.stage?.querySelector(`.overlay[data-overlay-id="${CSS.escape(String(ev.overlayId || ""))}"]`);
  if (!el) return;
  const show = isAnimationActionAppear(ev.action);
  const fade = animate ? safeClampNumber(ev.durationMs, 0, 5000, 0) : 0;
  if (ev.paragraph > 0) {
    setParagraphShown(el.querySelector(".overlay-text-editable"), ev.paragraph, show, fade);
    return;
  }
  const overlay = (slide.overlays || []).find((o) => o.id === ev.overlayId);
  const baseOpacity = safeClampNumber(el.dataset.baseOpacity, 0.1, 1, safeClampNumber(overlay?.opacity, 0.1, 1, 1));
  el.style.transition = fade > 0 ? `opacity ${fade}ms ease` : "none";
  el.style.opacity = show ? String(baseOpacity) : "0";
  el.style.pointerEvents = show ? "" : "none";
  if (show && overlay && resolveAssetByAnyId(overlay.sourceId)?.kind === "overlay-notes-board") {
    const frame = el.querySelector("iframe.overlay-notes-board-frame");
    if (frame?.contentWindow) postNotesInitToOverlay(overlay.id, frame.contentWindow);
  }
}

function getNextAnimationClickStepIndex(events, currentIndex) {
  if (!Array.isArray(events) || !events.length) {
    return currentIndex;
  }

  const start = currentIndex + 1;
  if (start >= events.length) {
    return currentIndex;
  }

  let end = start;
  while (end + 1 < events.length && !isAnimationActionAfterClick(events[end + 1]?.action)) {
    end += 1;
  }
  return end;
}

function getPreviousAnimationClickStepIndex(events, currentIndex) {
  if (!Array.isArray(events) || !events.length || currentIndex < 0) {
    return -1;
  }

  let groupStart = clamp(currentIndex, 0, events.length - 1);
  while (groupStart > 0 && !isAnimationActionAfterClick(events[groupStart]?.action)) {
    groupStart -= 1;
  }
  return groupStart - 1;
}

function getAnimationClickStepCount(events) {
  if (!Array.isArray(events) || !events.length) {
    return 0;
  }

  let count = 0;
  events.forEach((ev, idx) => {
    if (idx === 0 || isAnimationActionAfterClick(ev?.action)) {
      count += 1;
    }
  });
  return count;
}

function getAnimationClickStepAtIndex(events, currentIndex) {
  if (!Array.isArray(events) || !events.length || currentIndex < 0) {
    return 0;
  }

  const end = clamp(currentIndex, 0, events.length - 1);
  let count = 0;
  for (let i = 0; i <= end; i++) {
    if (i === 0 || isAnimationActionAfterClick(events[i]?.action)) {
      count += 1;
    }
  }
  return count;
}

function hasPendingAnimationAdvance(slide = currentSlide()) {
  if (!slide) {
    return false;
  }
  ensureSlideAnimationDefaults(slide);
  const events = slide.animationEvents || [];
  return events.length > 0 && state.animationStepIndex < events.length - 1;
}

function getOverlayVisibilityMapForStep(slide, stepIndex) {
  const map = new Map();
  if (!slide) {
    return map;
  }

  for (const overlay of slide.overlays || []) {
    map.set(overlay.id, !startsHiddenBeforeAnimation(slide, overlay.id));
  }

  ensureSlideAnimationDefaults(slide);
  const events = slide.animationEvents || [];
  const end = clamp(stepIndex, -1, events.length - 1);
  if (end < 0) {
    return map;
  }

  for (let i = 0; i <= end; i++) {
    const ev = events[i];
    if (!ev || !ev.overlayId || ev.paragraph > 0) {
      continue;
    }
    const show = isAnimationActionAppear(ev.action);
    map.set(ev.overlayId, show);
  }

  return map;
}

function getAnimationTransitionForStepChange(slide, fromStep, toStep) {
  if (!slide || fromStep === toStep) {
    return null;
  }

  ensureSlideAnimationDefaults(slide);
  const events = slide.animationEvents || [];
  if (!events.length || Math.abs(toStep - fromStep) !== 1) {
    return null;
  }

  const movingForward = toStep > fromStep;
  const index = movingForward ? toStep : fromStep;
  const ev = events[index];
  if (!ev || !ev.overlayId) {
    return null;
  }

  const isAppear = isAnimationActionAppear(ev.action);
  const durationMs = safeClampNumber(ev.durationMs, 0, 5000, 0);
  const isFade = durationMs > 0;
  const show = movingForward ? isAppear : !isAppear;

  return {
    overlayId: ev.overlayId,
    show,
    fade: isFade,
    durationMs,
  };
}

function clearAutoplayTimer() {
  if (state.autoplayTimer) {
    clearTimeout(state.autoplayTimer);
    state.autoplayTimer = null;
  }
}

function scheduleAnimationAutoplay() {
  clearAutoplayTimer();
  if (!state.autoplayEnabled || state.mode !== "present") {
    return;
  }

  const events = getCurrentSlideAnimationEvents();
  const nextStepIndex = getNextAnimationClickStepIndex(events, state.animationStepIndex);
  if (!events.length || nextStepIndex === state.animationStepIndex) {
    return;
  }

  state.autoplayTimer = setTimeout(() => {
    state.autoplayTimer = null;
    setAnimationStep(getNextAnimationClickStepIndex(events, state.animationStepIndex), { animate: true });
  }, safeClampNumber(state.autoplayDelayMs, 100, 5000, DEFAULT_ANIMATION_AUTOPLAY_DELAY_MS));
}

function resetAnimationPlaybackForCurrentSlide() {
  clearAutoplayTimer();
  clearAnimationStepTimers();
  state.animationStepIndex = -1;
  state.summaryRevealCount = 0;
}

function setAnimationStep(nextStep, { animate = true } = {}) {
  const slide = currentSlide();
  if (!slide) {
    state.animationStepIndex = -1;
    clearAutoplayTimer();
    renderAnimationPanel();
    return;
  }

  ensureSlideAnimationDefaults(slide);
  const events = slide.animationEvents || [];
  const clamped = clamp(nextStep, -1, events.length - 1);
  const previous = state.animationStepIndex;
  state.animationStepIndex = clamped;

  if (previous !== clamped) {
    applyAnimationStepToStage(slide, previous, clamped, animate);
  }

  renderAnimationPanel();
  scheduleAnimationAutoplay();
}

function getNotebookNavigationCandidates(slide, visibilityMap, { visibleOnly = true } = {}) {
  if (!slide || !Array.isArray(slide.overlays)) {
    return [];
  }

  const sorted = [...slide.overlays].sort((a, b) => (b.zIndex || 1) - (a.zIndex || 1));
  return sorted.filter((overlay) => {
    if (!overlay || !isNotebookPanelSource(overlay.sourceId)) {
      return false;
    }
    ensureOverlayNotebookDefaults(overlay);
    if (visibleOnly && visibilityMap && visibilityMap.get(overlay.id) === false) {
      return false;
    }
    return overlay.notebookPages.length > 0;
  });
}

function tryAdvanceNotebookBeforeSlideChange(delta) {
  const slide = currentSlide();
  if (!slide) {
    return false;
  }

  const visibilityMap = getOverlayVisibilityMapForStep(slide, state.animationStepIndex);
  const visibleCandidates = getNotebookNavigationCandidates(slide, visibilityMap, { visibleOnly: true });
  const fallbackCandidates = visibleCandidates.length
    ? visibleCandidates
    : getNotebookNavigationCandidates(slide, visibilityMap, { visibleOnly: false });
  const target = fallbackCandidates[0] || null;
  if (!target) {
    return false;
  }

  ensureOverlayNotebookDefaults(target);
  const count = target.notebookPages.length;
  if (count <= 1) {
    return false;
  }

  const dir = delta > 0 ? 1 : -1;
  const next = target.notebookPageIndex + dir;
  if (next < 0 || next > (count - 1)) {
    return false;
  }

  target.notebookPageIndex = next;
  touch();
  renderStage();
  dom.modeHint.textContent = `Notebook page ${next + 1} / ${count}`;
  return true;
}

// First slide index strictly beyond `fromIndex` in direction `dir` (+1/-1) that
// is not marked hidden. Returns -1 when there is no visible slide that way.
// Used only for presenter navigation; edit-mode Next/Prev still reach every slide.
function nextVisibleSlideIndex(fromIndex, dir) {
  const slides = state.deck.slides || [];
  for (let i = fromIndex + dir; i >= 0 && i < slides.length; i += dir) {
    if (!slides[i]?.hidden) return i;
  }
  return -1;
}

// Toggle the CSS class that drives the 0.5 s opacity fade on a summary cell, by
// its index in the on-stage grid. Used for sequential summary reveal.
function revealSummaryCellAt(index, show) {
  if (!dom.stage) return;
  const cells = dom.stage.querySelectorAll(".summary-layer.sum-sequential .summary-cell");
  const cell = cells[index];
  if (cell) cell.classList.toggle("is-revealed", show);
}

function advancePresenterSequence(delta) {
  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }

  if (state.mode !== "present") {
    gotoSlide(state.currentSlideIndex + (delta > 0 ? 1 : -1));
    return;
  }

  const slide = currentSlide();
  if (!slide) {
    gotoSlide(state.currentSlideIndex + (delta > 0 ? 1 : -1));
    return;
  }

  ensureSlideAnimationDefaults(slide);
  const events = slide.animationEvents || [];

  if (delta > 0) {
    const nextIdx = getNextAnimationClickStepIndex(events, state.animationStepIndex);
    if (nextIdx !== state.animationStepIndex) {
      setAnimationStep(nextIdx, { animate: true });
      return;
    }
    // Sequential summary reveal: fade in the next cell instead of changing slides.
    if (isSummarySlide(slide)
        && normalizeSummaryReveal(slide.summaryReveal) === "sequential"
        && state.summaryRevealCount < slide.summaryItems.length) {
      revealSummaryCellAt(state.summaryRevealCount, true);
      state.summaryRevealCount += 1;
      return;
    }
    const nextVisible = nextVisibleSlideIndex(state.currentSlideIndex, 1);
    if (nextVisible === -1) {
      if (tryAdvanceNotebookBeforeSlideChange(delta)) {
        return;
      }
      state.showPresenterEndScreen = true;
      clearAutoplayTimer();
      renderStage();
      return;
    }
    if (tryAdvanceNotebookBeforeSlideChange(delta)) {
      return;
    }
    gotoSlide(nextVisible);
    return;
  }

  if (state.showPresenterEndScreen) {
    state.showPresenterEndScreen = false;
    renderStage();
    return;
  }

  const prevIdx = getPreviousAnimationClickStepIndex(events, state.animationStepIndex);
  if (state.animationStepIndex >= 0) {
    setAnimationStep(prevIdx, { animate: true });
    return;
  }

  // Sequential summary reveal: step back by hiding the last-revealed cell.
  if (isSummarySlide(slide)
      && normalizeSummaryReveal(slide.summaryReveal) === "sequential"
      && state.summaryRevealCount > 0) {
    state.summaryRevealCount -= 1;
    revealSummaryCellAt(state.summaryRevealCount, false);
    return;
  }

  if (tryAdvanceNotebookBeforeSlideChange(delta)) {
    return;
  }

  const prevVisible = nextVisibleSlideIndex(state.currentSlideIndex, -1);
  if (prevVisible === -1) {
    return; // already at the first visible slide
  }
  gotoSlide(prevVisible);
}

function applyAnimationStepToStage(slide, fromStep, toStep, animate = true) {
  clearAnimationStepTimers();
  if (!slide || !dom.stage || state.mode !== "present") {
    return;
  }

  // forward (a click, or autoplay): this click's steps one after another, each after its delay, with its fade
  if (animate && toStep > fromStep) {
    ensureSlideAnimationDefaults(slide);
    const events = slide.animationEvents || [];
    let t = 0;
    for (let i = Math.max(0, fromStep + 1); i <= toStep; i++) {
      const ev = events[i];
      if (!ev) continue;
      t += safeClampNumber(ev.delayMs, 0, 60000, 0);
      if (t <= 0) playAnimationEventOnStage(slide, ev, true);
      else state.animationStepTimers.push(setTimeout(() => playAnimationEventOnStage(slide, ev, true), t));
    }
    return;
  }

  // back or a jump: the target step at once (paragraphs too; whole overlays below)
  const hiddenParagraphs = getParagraphHiddenMapForStep(slide, toStep);
  dom.stage.querySelectorAll(".overlay[data-overlay-id]").forEach((el) => {
    const hidden = hiddenParagraphs.get(String(el.dataset.overlayId || ""));
    const textEl = hidden && el.querySelector(".overlay-text-editable");
    if (textEl) textOverlayParagraphs(textEl).forEach((p, i) => { p.style.transition = "none"; p.style.opacity = hidden.has(i + 1) ? "0" : ""; });
  });

  const previousVisibility = getOverlayVisibilityMapForStep(slide, fromStep);
  const visibility = getOverlayVisibilityMapForStep(slide, toStep);
  const transition = animate ? getAnimationTransitionForStepChange(slide, fromStep, toStep) : null;
  const overlayById = new Map((slide.overlays || []).map((o) => [o.id, o]));
  const rows = dom.stage.querySelectorAll(".overlay[data-overlay-id]");

  rows.forEach((el) => {
    const overlayId = String(el.dataset.overlayId || "");
    const overlay = overlayById.get(overlayId);
    if (!overlay) {
      return;
    }

    const wasVisible = previousVisibility.get(overlayId) !== false;
    const baseOpacity = safeClampNumber(el.dataset.baseOpacity, 0.1, 1, safeClampNumber(overlay.opacity, 0.1, 1, 1));
    const visible = visibility.get(overlayId) !== false;
    const targetOpacity = visible ? baseOpacity : 0;
    const useFade = !!transition && transition.overlayId === overlayId && transition.fade;

    el.style.transition = useFade ? `opacity ${transition.durationMs}ms ease` : "none";
    el.style.opacity = String(targetOpacity);
    el.style.pointerEvents = visible ? "" : "none";

    // Notes board may need a fresh init message when it appears after being hidden.
    if (!wasVisible && visible) {
      const source = resolveAssetByAnyId(overlay.sourceId);
      if (source?.kind === "overlay-notes-board") {
        const frame = el.querySelector("iframe.overlay-notes-board-frame");
        if (frame?.contentWindow) {
          postNotesInitToOverlay(overlayId, frame.contentWindow);
        }
      }
    }
  });
}

function addAnimationEventForSelectedOverlay(action) {
  const slide = currentSlide();
  if (!slide) {
    return;
  }

  ensureSlideAnimationDefaults(slide);
  const targetOverlayId = state.selectedOverlayId || (slide.overlays[0] ? slide.overlays[0].id : "");
  if (!targetOverlayId) {
    dom.modeHint.textContent = "Create/select an overlay before adding animation events.";
    return;
  }

  slide.animationEvents.push(createAnimationEvent(targetOverlayId, action));
  touch();
  renderAnimationPanel();
}

function removeAnimationEventById(eventId) {
  const slide = currentSlide();
  if (!slide) {
    return;
  }

  ensureSlideAnimationDefaults(slide);
  const events = slide.animationEvents || [];
  const idx = events.findIndex((ev) => String(ev?.id || "") === String(eventId || ""));
  if (idx < 0) {
    return;
  }

  const previousStep = state.animationStepIndex;
  events.splice(idx, 1);

  if (state.animationStepIndex >= events.length) {
    state.animationStepIndex = events.length - 1;
  }
  if (state.animationStepIndex > idx) {
    state.animationStepIndex -= 1;
  }

  touch();
  renderAnimationPanel();
  applyAnimationStepToStage(slide, previousStep, state.animationStepIndex, false);
}

function renderAnimationPanel() {
  if (!dom.animationEventList) {
    return;
  }

  const slide = currentSlide();
  const events = getCurrentSlideAnimationEvents();
  const overlays = slide?.overlays || [];

  const hasSlide = !!slide;
  const hasOverlays = overlays.length > 0;
  const hasEvents = events.length > 0;

  if (dom.animPrevStepBtn) {
    dom.animPrevStepBtn.disabled = !hasSlide || state.animationStepIndex < 0;
  }
  if (dom.animNextStepBtn) {
    dom.animNextStepBtn.disabled = !hasSlide || getNextAnimationClickStepIndex(events, state.animationStepIndex) === state.animationStepIndex;
  }
  if (dom.animResetStepBtn) {
    dom.animResetStepBtn.disabled = !hasSlide || state.animationStepIndex < 0;
  }
  if (dom.animAutoplayCheckbox) {
    dom.animAutoplayCheckbox.checked = !!state.autoplayEnabled;
    dom.animAutoplayCheckbox.disabled = !hasSlide;
  }
  if (dom.animAutoplayDelayInput) {
    dom.animAutoplayDelayInput.value = String(safeClampNumber(state.autoplayDelayMs, 100, 5000, DEFAULT_ANIMATION_AUTOPLAY_DELAY_MS));
    dom.animAutoplayDelayInput.disabled = !hasSlide;
  }
  for (const btn of [
    dom.animAddAppearInstantBtn,
    dom.animAddAppearFadeBtn,
    dom.animAddDisappearInstantBtn,
    dom.animAddDisappearFadeBtn,
  ]) {
    if (btn) {
      btn.disabled = !hasSlide || !hasOverlays;
    }
  }

  if (dom.animStepStatus) {
    if (!hasSlide) {
      dom.animStepStatus.textContent = "No slide selected.";
    } else if (!hasEvents) {
      dom.animStepStatus.textContent = "No animation events on this slide.";
    } else {
      const current = getAnimationClickStepAtIndex(events, state.animationStepIndex);
      const total = getAnimationClickStepCount(events);
      dom.animStepStatus.textContent = `Click step ${Math.max(0, current)} / ${total}`;
    }
  }

  dom.animationEventList.innerHTML = "";
  if (!hasSlide || !hasEvents) {
    const empty = document.createElement("div");
    empty.className = "animation-event-empty";
    empty.textContent = hasSlide
      ? "Use the add buttons to create appear/remove events for overlays."
      : "Load or create a deck to edit animation events.";
    dom.animationEventList.appendChild(empty);
    return;
  }

  const actionOptions = [
    { value: "appear-after-click", label: "Appear after click" },
    { value: "appear-with-previous", label: "Appear with previous" },
    { value: "remove-after-click", label: "Remove after click" },
    { value: "remove-with-previous", label: "Remove with previous" },
  ];

  events.forEach((ev, index) => {
    const eventId = ev.id;
    const row = document.createElement("div");
    row.className = `animation-event-item${index === state.animationStepIndex ? " active" : ""}`;

    const head = document.createElement("div");
    head.className = "animation-event-head";

    const idx = document.createElement("span");
    idx.className = "animation-event-index";
    idx.textContent = `Step ${index + 1}`;

    const actions = document.createElement("span");
    actions.className = "animation-event-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => {
      if (index <= 0) {
        return;
      }
      const tmp = events[index - 1];
      events[index - 1] = events[index];
      events[index] = tmp;
      if (state.animationStepIndex === index) {
        state.animationStepIndex = index - 1;
      } else if (state.animationStepIndex === index - 1) {
        state.animationStepIndex = index;
      }
      touch();
      renderAnimationPanel();
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "↓";
    downBtn.disabled = index >= events.length - 1;
    downBtn.addEventListener("click", () => {
      if (index >= events.length - 1) {
        return;
      }
      const tmp = events[index + 1];
      events[index + 1] = events[index];
      events[index] = tmp;
      if (state.animationStepIndex === index) {
        state.animationStepIndex = index + 1;
      } else if (state.animationStepIndex === index + 1) {
        state.animationStepIndex = index;
      }
      touch();
      renderAnimationPanel();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      removeAnimationEventById(eventId);
    });

    actions.append(upBtn, downBtn, delBtn);
    head.append(idx, actions);

    const overlayField = document.createElement("label");
    overlayField.className = "field animation-event-overlay-row";
    const overlayTitle = document.createElement("span");
    overlayTitle.textContent = "Overlay";
    const overlaySelect = document.createElement("select");
    overlaySelect.innerHTML = "";
    overlays.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.id;
      const source = resolveAssetByAnyId(o.sourceId);
      const sourceName = source ? source.name : "(no source)";
      opt.textContent = sourceName;
      overlaySelect.appendChild(opt);
    });
    if (!overlays.some((o) => o.id === ev.overlayId) && overlays[0]) {
      ev.overlayId = overlays[0].id;
      touch();
    }
    overlaySelect.value = ev.overlayId;
    overlaySelect.addEventListener("change", () => {
      ev.overlayId = overlaySelect.value;
      delete ev.paragraph;
      touch();
      renderAnimationPanel();
      applyAnimationStepToStage(slide, state.animationStepIndex, state.animationStepIndex, false);
    });
    overlayField.append(overlayTitle, overlaySelect);

    const grid = document.createElement("div");
    grid.className = "animation-event-grid";

    const actionField = document.createElement("label");
    actionField.className = "field";
    const actionTitle = document.createElement("span");
    actionTitle.textContent = "Action";
    const actionSelect = document.createElement("select");
    actionOptions.forEach((optData) => {
      const opt = document.createElement("option");
      opt.value = optData.value;
      opt.textContent = optData.label;
      actionSelect.appendChild(opt);
    });
    actionSelect.value = ev.action;
    actionSelect.addEventListener("change", () => {
      ev.action = normalizeAnimationAction(actionSelect.value);
      touch();
      renderAnimationPanel();
    });
    actionField.append(actionTitle, actionSelect);

    const durationField = document.createElement("label");
    durationField.className = "field";
    const durationTitle = document.createElement("span");
    durationTitle.textContent = "Fade duration (ms)";
    const durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.min = "0";
    durationInput.max = "5000";
    durationInput.step = "50";
    durationInput.value = String(safeClampNumber(ev.durationMs, 0, 5000, 0));
    durationInput.addEventListener("input", () => {
      ev.durationMs = safeClampNumber(durationInput.value, 0, 5000, 0);
      touch();
    });
    durationField.append(durationTitle, durationInput);

    const delayField = document.createElement("label");
    delayField.className = "field";
    const delayTitle = document.createElement("span");
    delayTitle.textContent = "Delay (s)";
    delayTitle.title = "Wait this long after the previous step of the same click (or after the click) before this step plays";
    const delayInput = document.createElement("input");
    delayInput.type = "number";
    delayInput.min = "0";
    delayInput.max = "60";
    delayInput.step = "0.1";
    delayInput.value = String(Math.round(safeClampNumber(ev.delayMs, 0, 60000, 0) / 100) / 10);
    delayInput.addEventListener("input", () => {
      const ms = Math.round(safeClampNumber(delayInput.value, 0, 60, 0) * 1000);
      if (ms > 0) ev.delayMs = ms; else delete ev.delayMs;
      touch();
    });
    delayField.append(delayTitle, delayInput);
    grid.append(actionField, durationField, delayField);

    // a text overlay: the whole box or one paragraph (bullet / line) of it
    const evSource = resolveAssetByAnyId(overlays.find((o) => o.id === ev.overlayId)?.sourceId);
    let partField = null;
    if (evSource?.kind === "overlay-text") {
      const labels = textSourceParagraphLabels(evSource);
      if (ev.paragraph > labels.length) { delete ev.paragraph; touch(); }
      partField = document.createElement("div");
      partField.className = "field animation-event-overlay-row";
      const partTitle = document.createElement("span");
      partTitle.textContent = "Part";
      const partSelect = document.createElement("select");
      partSelect.innerHTML = `<option value="0">Whole box</option>` + labels.map((l, i) => `<option value="${i + 1}">Paragraph ${i + 1}${l ? ": " + escapeHtmlAttr(l) : ""}</option>`).join("");
      partSelect.value = String(ev.paragraph || 0);
      partSelect.addEventListener("change", () => {
        const k = Number(partSelect.value) || 0;
        if (k > 0) ev.paragraph = k; else delete ev.paragraph;
        touch();
        renderAnimationPanel();
        applyAnimationStepToStage(slide, state.animationStepIndex, state.animationStepIndex, false);
      });
      partField.append(partTitle, partSelect);
      if (!(ev.paragraph > 0) && isAnimationActionAppear(ev.action) && labels.length > 1) {
        const splitBtn = document.createElement("button");
        splitBtn.type = "button";
        splitBtn.textContent = "¶ one per paragraph";
        splitBtn.title = "Replace this step by one step per paragraph: the first as this step, each further one on a click (bullets one by one)";
        splitBtn.addEventListener("click", () => {
          const at = events.indexOf(ev);
          const steps = labels.map((_, i) => ({ ...createAnimationEvent(ev.overlayId, i === 0 ? ev.action : "appear-after-click"), durationMs: ev.durationMs, paragraph: i + 1 }));
          if (ev.delayMs > 0) steps[0].delayMs = ev.delayMs;
          events.splice(at, 1, ...steps);
          touch();
          renderAnimationPanel();
          applyAnimationStepToStage(slide, state.animationStepIndex, state.animationStepIndex, false);
        });
        partField.append(splitBtn);
      }
    }
    row.append(head, overlayField, ...(partField ? [partField] : []), grid);
    dom.animationEventList.appendChild(row);
  });
}

function createDefaultWhiteHdSlideDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DEFAULT_NEW_SLIDE_WIDTH}" height="${DEFAULT_NEW_SLIDE_HEIGHT}" viewBox="0 0 ${DEFAULT_NEW_SLIDE_WIDTH} ${DEFAULT_NEW_SLIDE_HEIGHT}"><rect width="100%" height="100%" fill="#ffffff"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function seedDeckWithDefaultWhiteHdSlide(deck = state.deck) {
  if (!deck || typeof deck !== "object") {
    return;
  }
  if (!deck.assets || typeof deck.assets !== "object") {
    deck.assets = {};
  }
  if (!Array.isArray(deck.slides)) {
    deck.slides = [];
  }
  if (deck.slides.length > 0) {
    return;
  }

  const assetId = uid();
  const dataUrl = createDefaultWhiteHdSlideDataUrl();
  deck.assets[assetId] = {
    id: assetId,
    kind: "slide-image",
    mime: "image/svg+xml",
    name: "Blank HD slide",
    dataUrl,
  };
  deck.slides.push(createSlide(assetId, "Slide 1", "", 0));
}

function createOverlay(rect = null) {
  return {
    id: uid(),
    x: rect ? rect.x : 0.1,
    y: rect ? rect.y : 0.1,
    w: rect ? rect.w : 0.2,
    h: rect ? rect.h : 0.2,
    sourceId: "",
    notesKey: "",
    framed: false,
    shaded: false,
    locked: true,
    allowKeyControl: false,
    annotationsEnabled: false,
    annotationLayer: "",
    annotationColor: "#000000",
    notebookPages: [],
    notebookPageIndex: 0,
    // Notebook panels are primarily for typed, page-based notes. Pen drawing
    // remains available as an explicit secondary tool.
    notebookMode: "type",
    notebookModeExplicit: false,
    notebookInputVersion: 2,
    notebookShadowEnabled: false,
    notebookFontSize: 18,
    opacity: 1,
    localScale: 1,
    zIndex: 1,
  };
}

function createNotebookPage(drawingLayer = "") {
  const now = new Date().toISOString();
  return {
    // Legacy raster layer. New ink is stored in `strokes` instead; this field
    // stays so pages written by earlier builds still show their drawing.
    drawingLayer: typeof drawingLayer === "string" ? drawingLayer : "",
    // Vector ink in normalised panel coordinates. Resizing the panel or moving
    // to a bigger screen now re-renders the strokes crisply instead of
    // resampling a PNG, and a page of notes costs a few hundred bytes rather
    // than a few hundred kilobytes.
    strokes: [],
    text: "",
    html: "",
    backgroundMode: "transparent",
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeNotebookStroke(stroke) {
  if (!stroke || typeof stroke !== "object" || !Array.isArray(stroke.pts) || stroke.pts.length < 2) {
    return null;
  }
  const pts = [];
  for (let i = 0; i + 1 < stroke.pts.length; i += 2) {
    const x = Number(stroke.pts[i]);
    const y = Number(stroke.pts[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    pts.push(Math.round(clamp(x, -0.2, 1.2) * 10000) / 10000, Math.round(clamp(y, -0.2, 1.2) * 10000) / 10000);
  }
  if (pts.length < 2) {
    return null;
  }
  return {
    color: sanitizeHexColor(stroke.color, "#000000"),
    // Width as a fraction of the panel width, so ink keeps its proportion.
    width: safeClampNumber(stroke.width, 0.0005, 0.2, 0.004),
    erase: !!stroke.erase,
    pts,
  };
}

function ensureNotebookPageDefaults(page) {
  if (!page || typeof page !== "object") {
    return createNotebookPage("");
  }
  page.drawingLayer = typeof page.drawingLayer === "string" ? page.drawingLayer : "";
  page.strokes = Array.isArray(page.strokes)
    ? page.strokes.map(normalizeNotebookStroke).filter(Boolean)
    : [];
  page.text = typeof page.text === "string" ? page.text : "";
  // Pre-X pages only hold plain text. Promote it once; from then on `html` is
  // the source of truth and `text` is the mirror older builds can still read.
  if (typeof page.html !== "string") {
    page.html = page.text ? escapeTextToHtml(page.text) : "";
  } else {
    page.html = sanitizeTextHtml(page.html);
  }
  page.text = textHtmlToPlain(page.html);
  const backgroundMode = String(page.backgroundMode || "").trim().toLowerCase();
  page.backgroundMode = (backgroundMode === "black" || backgroundMode === "white") ? backgroundMode : "transparent";
  if (typeof page.createdAt !== "string" || !page.createdAt) {
    page.createdAt = new Date().toISOString();
  }
  if (typeof page.updatedAt !== "string" || !page.updatedAt) {
    page.updatedAt = page.createdAt || new Date().toISOString();
  }
  return page;
}

function ensureOverlayNotebookDefaults(overlay) {
  if (!overlay || typeof overlay !== "object") {
    return;
  }
  if (!Array.isArray(overlay.notebookPages)) {
    overlay.notebookPages = [];
  }
  overlay.notebookPages = overlay.notebookPages.map((page) => ensureNotebookPageDefaults(page));
  if (!overlay.notebookPages.length) {
    if (typeof overlay.annotationLayer === "string" && overlay.annotationLayer) {
      overlay.notebookPages = [createNotebookPage(overlay.annotationLayer)];
    } else {
      overlay.notebookPages = [createNotebookPage("")];
    }
  }
  overlay.notebookPageIndex = clamp(Math.round(safeClampNumber(overlay.notebookPageIndex, 0, Number.MAX_SAFE_INTEGER, 0)), 0, overlay.notebookPages.length - 1);
  const mode = String(overlay.notebookMode || "").trim().toLowerCase();
  const hasDrawing = overlay.notebookPages.some((page) => !!String(page?.drawingLayer || ""));
  const hasText = overlay.notebookPages.some((page) => !!String(page?.text || "").trim());
  // Older/newly-created empty notebooks were silently initialised in
  // navigation mode, which disabled the canvas pointer events and looked
  // broken. Migrate only untouched notebooks; preserve navigation on notebooks
  // that contain work or whose mode was deliberately chosen.
  if (overlay.notebookInputVersion !== 2 && !hasDrawing && !hasText) {
    overlay.notebookMode = "type";
  } else if (mode === "navigate" && overlay.notebookModeExplicit !== true && !hasDrawing && !hasText) {
    overlay.notebookMode = "type";
  } else {
    overlay.notebookMode = (mode === "type" || mode === "pen" || mode === "eraser" || mode === "navigate") ? mode : "type";
  }
  overlay.notebookInputVersion = 2;
  overlay.notebookModeExplicit = overlay.notebookModeExplicit === true;
  overlay.notebookShadowEnabled = !!overlay.notebookShadowEnabled;
  // Notebook type size, in the same slide points as free text boxes. The old
  // build hard-coded clamp(14px, 1.7cqw, 24px) with no container context, so
  // every notebook rendered at a flat 24px whatever its size.
  overlay.notebookFontSize = normalizeTextFontSize(overlay.notebookFontSize, 18);
}

function getOverlayNotebookCurrentPage(overlay) {
  ensureOverlayNotebookDefaults(overlay);
  return overlay.notebookPages[overlay.notebookPageIndex] || overlay.notebookPages[0] || null;
}

function getNotebookPageBackgroundMode(page) {
  const normalized = ensureNotebookPageDefaults(page);
  return String(normalized?.backgroundMode || "transparent");
}

function getNotebookBackgroundFill(mode) {
  const normalized = String(mode || "transparent").trim().toLowerCase();
  if (normalized === "black") {
    return "#101215";
  }
  if (normalized === "white") {
    return "#ffffff";
  }
  return "transparent";
}

function getNotebookRecommendedInkColor(mode) {
  return String(mode || "transparent").trim().toLowerCase() === "black"
    ? "#ffffff"
    : "#000000";
}

function cycleNotebookPageBackgroundMode(overlay) {
  const page = getOverlayNotebookCurrentPage(overlay);
  if (!page) {
    return "transparent";
  }
  const current = getNotebookPageBackgroundMode(page);
  const next = current === "transparent"
    ? "black"
    : (current === "black" ? "white" : "transparent");
  page.backgroundMode = next;
  page.updatedAt = new Date().toISOString();
  overlay.annotationColor = getNotebookRecommendedInkColor(next);
  return next;
}

function setOverlayNotebookCurrentDrawing(overlay, dataUrl) {
  const page = getOverlayNotebookCurrentPage(overlay);
  if (!page) {
    return;
  }
  page.drawingLayer = typeof dataUrl === "string" ? dataUrl : "";
  page.updatedAt = new Date().toISOString();
}

function appendOverlayNotebookStroke(overlay, stroke) {
  const page = getOverlayNotebookCurrentPage(overlay);
  const normalized = normalizeNotebookStroke(stroke);
  if (!page || !normalized) {
    return;
  }
  page.strokes.push(normalized);
  page.updatedAt = new Date().toISOString();
}

// Undo the last pen or eraser stroke on the page. Vector ink makes this
// possible at all; with the old PNG layer there was nothing to step back to.
function undoOverlayNotebookStroke(overlay) {
  const page = getOverlayNotebookCurrentPage(overlay);
  if (!page || !page.strokes.length) {
    return false;
  }
  page.strokes.pop();
  page.updatedAt = new Date().toISOString();
  return true;
}

function clearOverlayNotebookCurrentDrawing(overlay) {
  const page = getOverlayNotebookCurrentPage(overlay);
  if (!page) {
    return;
  }
  page.strokes = [];
  page.drawingLayer = "";
  page.updatedAt = new Date().toISOString();
}

function stepOverlayNotebookPage(overlay, delta, { wrap = true } = {}) {
  ensureOverlayNotebookDefaults(overlay);
  const count = overlay.notebookPages.length;
  if (!count) {
    overlay.notebookPageIndex = 0;
    return 0;
  }
  const dir = delta >= 0 ? 1 : -1;
  let next = overlay.notebookPageIndex + dir;
  if (wrap) {
    next = (next + count) % count;
  } else {
    next = clamp(next, 0, count - 1);
  }
  overlay.notebookPageIndex = next;
  return next;
}

function insertOverlayNotebookPage(overlay, insertBefore = false) {
  ensureOverlayNotebookDefaults(overlay);
  const idx = overlay.notebookPageIndex;
  const insertAt = insertBefore ? idx : idx + 1;
  overlay.notebookPages.splice(insertAt, 0, createNotebookPage(""));
  overlay.notebookPageIndex = insertAt;
}

function duplicateOverlayNotebookPage(overlay) {
  ensureOverlayNotebookDefaults(overlay);
  const current = getOverlayNotebookCurrentPage(overlay);
  const drawingLayer = current?.drawingLayer || "";
  const insertAt = overlay.notebookPageIndex + 1;
  const clone = createNotebookPage(drawingLayer);
  clone.strokes = (current?.strokes || []).map((stroke) => ({ ...stroke, pts: stroke.pts.slice() }));
  clone.html = String(current?.html || "");
  clone.text = String(current?.text || "");
  clone.backgroundMode = getNotebookPageBackgroundMode(current);
  overlay.notebookPages.splice(insertAt, 0, clone);
  overlay.notebookPageIndex = insertAt;
}

function deleteOverlayNotebookPage(overlay) {
  ensureOverlayNotebookDefaults(overlay);
  if (overlay.notebookPages.length <= 1) {
    clearOverlayNotebookCurrentDrawing(overlay);
    return;
  }
  overlay.notebookPages.splice(overlay.notebookPageIndex, 1);
  overlay.notebookPageIndex = clamp(overlay.notebookPageIndex, 0, overlay.notebookPages.length - 1);
}

function getOverlayNotebookPageDrawing(overlay, pageIndex) {
  ensureOverlayNotebookDefaults(overlay);
  const idx = clamp(Math.round(safeClampNumber(pageIndex, 0, Number.MAX_SAFE_INTEGER, 0)), 0, overlay.notebookPages.length - 1);
  return String(overlay.notebookPages[idx]?.drawingLayer || "");
}

function isNotebookPanelSource(sourceId) {
  const source = resolveAssetByAnyId(sourceId);
  return !!source && source.kind === "overlay-notebook-panel";
}

function applyOverlaySourceBehaviorDefaults(overlay) {
  if (!overlay || typeof overlay !== "object") {
    return;
  }
  ensureOverlayNotesDefaults(overlay);
  if (isNotesBoardSource(overlay.sourceId) && !overlay.notesKey) {
    overlay.notesKey = uid();
  }
  if (isNotebookPanelSource(overlay.sourceId)) {
    ensureOverlayAnnotationDefaults(overlay);
    ensureOverlayNotebookDefaults(overlay);
    overlay.annotationsEnabled = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Free text boxes (overlay-text sources)
//
// A text overlay is a rich-text box in the PowerPoint sense: you click into it
// and type, the caret survives re-renders, character formatting applies to the
// selection, box formatting applies to the whole box, and the box can grow with
// its content. Sizes are authored in slide points against a 960pt-wide
// reference slide, so a box looks the same while editing and while presenting.
// ─────────────────────────────────────────────────────────────────────────────

function getStageTextScale() {
  const width = dom.stage?.getBoundingClientRect?.().width || 0;
  if (!Number.isFinite(width) || width <= 0) {
    return 1;
  }
  return width / TEXT_REFERENCE_SLIDE_WIDTH;
}

function slidePointsToPx(points) {
  return Math.max(1, normalizeTextFontSize(points) * getStageTextScale());
}

function normalizeTextFontSize(value, fallback = TEXT_SIZE_DEFAULT) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return clamp(Math.round(numeric * 10) / 10, TEXT_SIZE_MIN, TEXT_SIZE_MAX);
  }
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? clamp(fb, TEXT_SIZE_MIN, TEXT_SIZE_MAX) : TEXT_SIZE_DEFAULT;
}

// Next/previous entry on the size ladder, so A+/A- feel like PowerPoint's
// grow/shrink buttons rather than a raw +1.
function stepTextFontSize(current, direction) {
  const value = normalizeTextFontSize(current);
  if (direction > 0) {
    const next = TEXT_SIZE_LADDER.find((s) => s > value + 0.01);
    return normalizeTextFontSize(next === undefined ? value * 1.2 : next);
  }
  const lower = TEXT_SIZE_LADDER.filter((s) => s < value - 0.01);
  const prev = lower.length ? lower[lower.length - 1] : null;
  return normalizeTextFontSize(prev === null ? value / 1.2 : prev);
}

function normalizeTextAlign(value, fallback = "left") {
  const v = String(value || "").trim().toLowerCase();
  return TEXT_ALIGNMENTS.includes(v) ? v : fallback;
}

function normalizeTextVAlign(value, fallback = "top") {
  const v = String(value || "").trim().toLowerCase();
  return TEXT_VERTICAL_ALIGNMENTS.includes(v) ? v : fallback;
}

function normalizeTextAutoFit(value, fallback = "grow") {
  const v = String(value || "").trim().toLowerCase();
  return TEXT_AUTOFIT_MODES.includes(v) ? v : fallback;
}

function normalizeTextBulletStyle(value, fallback = "disc") {
  const v = String(value || "").trim().toLowerCase();
  return TEXT_BULLET_STYLES.includes(v) ? v : fallback;
}

// ── Markup handling ──────────────────────────────────────────────────────────

function escapeTextToHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br>");
}

function textHtmlToPlain(html) {
  const holder = document.createElement("div");
  holder.innerHTML = String(html || "");
  // <br> and block boundaries become newlines so the plain mirror stays useful
  // for print, search and any older build that only reads asset.text.
  holder.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  holder.querySelectorAll("p, div, li").forEach((block) => block.append("\n"));
  return String(holder.textContent || "").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}

// Strips everything we do not explicitly allow. Runs on load, on paste and
// before anything is written back into the deck, so a deck can never carry a
// script, an image, or markup that would break the slide layout.
function sanitizeTextHtml(html) {
  const holder = document.createElement("div");
  holder.innerHTML = String(html || "");

  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      const tag = child.tagName.toUpperCase();
      if (!TEXT_ALLOWED_INLINE_TAGS.has(tag)) {
        // Keep the words, drop the wrapper.
        const fragment = document.createDocumentFragment();
        while (child.firstChild) {
          fragment.appendChild(child.firstChild);
        }
        child.replaceWith(fragment);
        continue;
      }

      // <font size=N> is what execCommand("fontSize") emits; convert it to a
      // relative span so the size travels with the box instead of being a
      // fixed browser bucket.
      if (tag === "FONT") {
        const span = document.createElement("span");
        const color = child.getAttribute("color");
        if (color) {
          span.style.color = color;
        }
        const face = child.getAttribute("face");
        if (face) {
          span.style.fontFamily = face;
        }
        while (child.firstChild) {
          span.appendChild(child.firstChild);
        }
        child.replaceWith(span);
        walk(span);
        continue;
      }

      for (const attr of Array.from(child.attributes)) {
        if (attr.name.toLowerCase() !== "style") {
          child.removeAttribute(attr.name);
        }
      }
      const style = child.getAttribute("style");
      if (style) {
        const kept = [];
        for (const decl of style.split(";")) {
          const idx = decl.indexOf(":");
          if (idx < 0) {
            continue;
          }
          const prop = decl.slice(0, idx).trim().toLowerCase();
          const val = decl.slice(idx + 1).trim();
          if (!val || /url\s*\(|expression\s*\(/i.test(val)) {
            continue;
          }
          if (TEXT_ALLOWED_INLINE_STYLES.has(prop)) {
            kept.push(`${prop}: ${val}`);
          }
        }
        if (kept.length) {
          child.setAttribute("style", kept.join("; "));
        } else {
          child.removeAttribute("style");
        }
      }
      walk(child);
    }
  };

  walk(holder);
  return holder.innerHTML;
}

// Rewrites absolute font sizes produced by the browser into em values relative
// to the box size, so scaling the box or the stage scales the run with it.
function relativizeEditorFontSizes(root, boxPx) {
  if (!root || !(boxPx > 0)) {
    return;
  }
  root.querySelectorAll("font[size]").forEach((node) => {
    const span = document.createElement("span");
    span.style.fontSize = node.dataset.txEm ? `${node.dataset.txEm}em` : "1em";
    while (node.firstChild) {
      span.appendChild(node.firstChild);
    }
    node.replaceWith(span);
  });
  root.querySelectorAll('[style*="font-size"]').forEach((node) => {
    const raw = node.style.fontSize;
    if (!raw || raw.endsWith("em") || raw.endsWith("%")) {
      return;
    }
    const px = parseFloat(raw);
    if (!Number.isFinite(px) || px <= 0) {
      node.style.removeProperty("font-size");
      return;
    }
    node.style.fontSize = `${Math.round((px / boxPx) * 1000) / 1000}em`;
  });
}

// ── Source model ─────────────────────────────────────────────────────────────

function ensureOverlayTextSourceDefaults(asset) {
  if (!asset || typeof asset !== "object") {
    return;
  }
  asset.kind = "overlay-text";
  asset.mime = "text/plain";
  asset.text = typeof asset.text === "string" ? asset.text : "";

  // Pre-X decks only carry plain text. Promote it once; from then on `html` is
  // the source of truth and `text` is a mirror kept for legacy readers.
  if (typeof asset.html !== "string") {
    asset.html = asset.text ? escapeTextToHtml(asset.text) : "";
  } else {
    asset.html = sanitizeTextHtml(asset.html);
  }
  asset.text = textHtmlToPlain(asset.html);
  asset.name = asset.text.trim() ? `Text: ${asset.text.trim().slice(0, 18)}` : "Text";

  asset.font = String(asset.font || "Arial, sans-serif");
  asset.fontSize = normalizeTextFontSize(asset.fontSize, TEXT_SIZE_DEFAULT);
  asset.bold = !!asset.bold;
  asset.italic = !!asset.italic;
  asset.underline = !!asset.underline;
  asset.color = sanitizeHexColor(asset.color, "#000000");
  asset.shaded = !!asset.shaded;
  asset.fillColor = sanitizeHexColor(asset.fillColor, "#c8dcf0");
  asset.fillOpacity = safeClampNumber(asset.fillOpacity, 0, 1, 0.3);
  asset.align = normalizeTextAlign(asset.align, "left");
  asset.valign = normalizeTextVAlign(asset.valign, "top");
  asset.autoFit = normalizeTextAutoFit(asset.autoFit, "grow");
  asset.bulletStyle = normalizeTextBulletStyle(asset.bulletStyle, "disc");
  asset.lineHeight = safeClampNumber(asset.lineHeight, 0.8, 3, 1.25);
}

function getSelectedOverlayTextSource() {
  const overlay = findOverlay(state.selectedOverlayId);
  if (!overlay) {
    return null;
  }
  const source = resolveAssetByAnyId(overlay.sourceId);
  if (!source || source.kind !== "overlay-text") {
    return null;
  }
  ensureOverlayTextSourceDefaults(source);
  return source;
}

function getOverlayTextSourceByOverlayId(overlayId) {
  const overlay = findOverlay(overlayId);
  if (!overlay) {
    return null;
  }
  const source = resolveAssetByAnyId(overlay.sourceId);
  if (!source || source.kind !== "overlay-text") {
    return null;
  }
  ensureOverlayTextSourceDefaults(source);
  return source;
}

// ── Toolbar <-> selection sync ───────────────────────────────────────────────

function syncTextToolFromSelectedOverlaySource() {
  const source = getSelectedOverlayTextSource();
  if (!source) {
    updateTextToolboxVisibility();
    return;
  }
  state.currentTextFont = source.font;
  state.currentTextSize = normalizeTextFontSize(source.fontSize);
  state.currentTextBold = !!source.bold;
  state.currentTextItalic = !!source.italic;
  state.currentTextUnderline = !!source.underline;
  state.currentTextColor = sanitizeHexColor(source.color, "#000000");
  state.currentTextShaded = !!source.shaded;
  state.currentTextFillColor = sanitizeHexColor(source.fillColor, "#c8dcf0");
  state.currentTextFillOpacity = safeClampNumber(source.fillOpacity, 0, 1, 0.3);
  state.currentTextAlign = normalizeTextAlign(source.align);
  state.currentTextVAlign = normalizeTextVAlign(source.valign);
  state.currentTextAutoFit = normalizeTextAutoFit(source.autoFit);
  state.currentTextBulletStyle = normalizeTextBulletStyle(source.bulletStyle);
  renderTextToolbox();
}

// Reflects the run under the caret (bold/italic/underline/alignment) rather
// than only the box defaults, the way a word processor's toolbar does.
function syncTextToolFromCaret() {
  if (!state.activeTextEditOverlayId) {
    return;
  }
  try {
    dom.textBoldBtn?.classList.toggle("active", document.queryCommandState("bold") || state.currentTextBold);
    dom.textItalicBtn?.classList.toggle("active", document.queryCommandState("italic") || state.currentTextItalic);
    dom.textUnderlineBtn?.classList.toggle("active", document.queryCommandState("underline") || state.currentTextUnderline);
    dom.textBulletBtn?.classList.toggle("active", document.queryCommandState("insertUnorderedList"));
  } catch {
    // queryCommandState throws in some embedded contexts; the box defaults
    // already shown in the toolbar remain correct.
  }
}

function renderTextToolbox() {
  if (dom.textFontSelect && dom.textFontSelect.value !== state.currentTextFont) {
    dom.textFontSelect.value = state.currentTextFont;
  }
  if (dom.textSizeInput && document.activeElement !== dom.textSizeInput) {
    dom.textSizeInput.value = String(normalizeTextFontSize(state.currentTextSize));
  }
  if (dom.textColorInput) {
    dom.textColorInput.value = sanitizeHexColor(state.currentTextColor, "#000000");
  }
  if (dom.textShadingCheckbox) {
    dom.textShadingCheckbox.checked = !!state.currentTextShaded;
  }
  if (dom.textFillColorInput) {
    dom.textFillColorInput.value = sanitizeHexColor(state.currentTextFillColor, "#c8dcf0");
  }
  if (dom.textFillOpacityInput) {
    dom.textFillOpacityInput.value = String(Math.round(safeClampNumber(state.currentTextFillOpacity, 0, 1, 0.3) * 100));
  }
  dom.textBoldBtn?.classList.toggle("active", state.currentTextBold);
  dom.textItalicBtn?.classList.toggle("active", state.currentTextItalic);
  dom.textUnderlineBtn?.classList.toggle("active", state.currentTextUnderline);
  dom.textAlignLeftBtn?.classList.toggle("active", state.currentTextAlign === "left");
  dom.textAlignCenterBtn?.classList.toggle("active", state.currentTextAlign === "center");
  dom.textAlignRightBtn?.classList.toggle("active", state.currentTextAlign === "right");
  if (dom.textVAlignBtn) {
    dom.textVAlignBtn.textContent = TEXT_VALIGN_GLYPHS[state.currentTextVAlign] || "⊤";
    dom.textVAlignBtn.dataset.value = state.currentTextVAlign;
  }
  if (dom.textAutoFitBtn) {
    dom.textAutoFitBtn.textContent = TEXT_AUTOFIT_LABELS[state.currentTextAutoFit] || "Grow";
    dom.textAutoFitBtn.dataset.value = state.currentTextAutoFit;
  }
  if (dom.textBulletStyleSelect && document.activeElement !== dom.textBulletStyleSelect) {
    dom.textBulletStyleSelect.value = state.currentTextBulletStyle;
  }
  if (dom.ftBulletStyleSelect) {
    dom.ftBulletStyleSelect.value = state.currentTextBulletStyle;
  }
  updateTextToolboxVisibility();
}

// The toolbox is shown whenever it can do something: while the text tool is
// armed, while a text box is selected, or while one is being edited on stage.
// Previously it only appeared with the tool armed, which meant re-arming the
// tool (and risking stray boxes) just to restyle existing text.
function updateTextToolboxVisibility() {
  if (!dom.textToolbox) {
    return;
  }
  const hasTextSelection = !!getSelectedOverlayTextSource();
  const show = state.textToolActive
    || (state.mode === "edit" && hasTextSelection)
    || (state.mode === "present" && !!state.presenterTextEditOverlayId);
  dom.textToolbox.classList.toggle("hidden", !show);
  dom.textToolbox.classList.toggle("present-floating", state.mode === "present" && show);
}

// ── Caret preservation across re-renders ─────────────────────────────────────

function textEditorOffsetOf(root, node, offset) {
  try {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return 0;
  }
}

function textEditorNodeAtOffset(root, target) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last = null;
  let node = walker.nextNode();
  while (node) {
    const len = node.nodeValue.length;
    if (seen + len >= target) {
      return { node, offset: Math.max(0, target - seen) };
    }
    seen += len;
    last = node;
    node = walker.nextNode();
  }
  if (last) {
    return { node: last, offset: last.nodeValue.length };
  }
  return { node: root, offset: 0 };
}

function captureActiveTextSelection() {
  const overlayId = state.activeTextEditOverlayId;
  if (!overlayId) {
    return null;
  }
  const root = dom.stage?.querySelector(`.overlay[data-overlay-id="${overlayId}"] .overlay-text-editable`);
  if (!(root instanceof HTMLElement)) {
    return null;
  }
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return null;
  }
  return {
    overlayId,
    start: textEditorOffsetOf(root, range.startContainer, range.startOffset),
    end: textEditorOffsetOf(root, range.endContainer, range.endOffset),
  };
}

function restoreTextSelection(snapshot) {
  if (!snapshot?.overlayId) {
    return false;
  }
  const root = dom.stage?.querySelector(`.overlay[data-overlay-id="${snapshot.overlayId}"] .overlay-text-editable`);
  if (!(root instanceof HTMLElement)) {
    return false;
  }
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }
  const from = textEditorNodeAtOffset(root, snapshot.start);
  const to = textEditorNodeAtOffset(root, snapshot.end);
  try {
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    if (document.activeElement !== root) {
      root.focus({ preventScroll: true });
    }
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

// Called by renderStage() around a rebuild so typing is never interrupted.
function beginTextRenderSelectionGuard() {
  state.pendingTextSelection = captureActiveTextSelection();
  state.stageRenderInProgress = true;
}

function endTextRenderSelectionGuard() {
  const snapshot = state.pendingTextSelection;
  state.pendingTextSelection = null;
  state.stageRenderInProgress = false;
  if (snapshot) {
    restoreTextSelection(snapshot);
  }
}

// ── Applying style ───────────────────────────────────────────────────────────

function getActiveTextEditorNode() {
  if (!state.activeTextEditOverlayId) {
    return null;
  }
  const node = dom.stage?.querySelector(`.overlay[data-overlay-id="${state.activeTextEditOverlayId}"] .overlay-text-editable`);
  return node instanceof HTMLElement ? node : null;
}

function hasLiveTextSelection() {
  const root = getActiveTextEditorNode();
  if (!root) {
    return false;
  }
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    return false;
  }
  return root.contains(selection.getRangeAt(0).commonAncestorContainer);
}

// Toolbar buttons steal focus from the editor, which collapses the selection.
// Remember it on the way out and put it back before running a command.
function rememberTextSelection() {
  const root = getActiveTextEditorNode();
  if (!root) {
    state.savedTextRange = null;
    return;
  }
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    state.savedTextRange = null;
    return;
  }
  const range = selection.getRangeAt(0);
  state.savedTextRange = root.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

function restoreRememberedTextSelection() {
  const root = getActiveTextEditorNode();
  if (!root) {
    return false;
  }
  root.focus({ preventScroll: true });
  const range = state.savedTextRange;
  if (!range) {
    return true;
  }
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }
  try {
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function commitActiveTextEditor({ rerender = false } = {}) {
  // Emptying the stage blurs the focused editor synchronously, before the node
  // is actually detached, so isConnected is still true at that moment. The
  // rebuild flag is the only reliable way to tell that apart from a real blur.
  if (state.stageRenderInProgress) {
    return;
  }
  const root = getActiveTextEditorNode();
  if (!root) {
    return;
  }
  const source = getOverlayTextSourceByOverlayId(state.activeTextEditOverlayId);
  if (!source) {
    return;
  }
  const overlay = findOverlay(state.activeTextEditOverlayId);
  relativizeEditorFontSizes(root, slidePointsToPx(source.fontSize));
  source.html = sanitizeTextHtml(root.innerHTML);
  source.text = textHtmlToPlain(source.html);
  source.name = source.text.trim() ? `Text: ${source.text.trim().slice(0, 18)}` : "Text";
  touch();
  scheduleSourceListRefresh();
  if (overlay) {
    applyTextOverlayAutoFit(overlay, source);
  }
  if (rerender) {
    renderStage();
  }
}

// Runs a document.execCommand against the live selection and writes the result
// back to the deck. Character-level formatting only.
function runTextEditorCommand(command, value = null, { css = false } = {}) {
  if (!restoreRememberedTextSelection()) {
    return false;
  }
  try {
    document.execCommand("styleWithCSS", false, css);
    document.execCommand(command, false, value);
  } catch {
    return false;
  }
  rememberTextSelection();
  commitActiveTextEditor();
  syncTextToolFromCaret();
  return true;
}

// Character-level size: wrap the selection in a span sized relative to the box,
// so it keeps its proportion when the box or the stage is scaled.
function applySelectionFontSize(points) {
  const source = getOverlayTextSourceByOverlayId(state.activeTextEditOverlayId);
  if (!source || !restoreRememberedTextSelection()) {
    return false;
  }
  const ratio = normalizeTextFontSize(points) / normalizeTextFontSize(source.fontSize);
  try {
    document.execCommand("styleWithCSS", false, false);
    // Size 7 is just a marker bucket; it is rewritten to an em span below.
    document.execCommand("fontSize", false, "7");
  } catch {
    return false;
  }
  const root = getActiveTextEditorNode();
  if (root) {
    root.querySelectorAll('font[size="7"]').forEach((node) => {
      const span = document.createElement("span");
      span.style.fontSize = `${Math.round(ratio * 1000) / 1000}em`;
      while (node.firstChild) {
        span.appendChild(node.firstChild);
      }
      node.replaceWith(span);
    });
  }
  rememberTextSelection();
  commitActiveTextEditor();
  return true;
}

// Box-level change. Inline runs that set the same property would win over the
// box default, so they are cleared first — this is what PowerPoint does when
// you select the box outline and change a property.
function applyBoxTextStyle(mutator, { clearInlineProps = [], clearInlineTags = [] } = {}) {
  const overlay = findOverlay(state.selectedOverlayId) || findOverlay(state.activeTextEditOverlayId);
  const source = overlay ? getOverlayTextSourceByOverlayId(overlay.id) : null;
  if (!source) {
    return false;
  }

  mutator(source);

  if (clearInlineProps.length || clearInlineTags.length) {
    const holder = document.createElement("div");
    holder.innerHTML = source.html || "";
    for (const prop of clearInlineProps) {
      holder.querySelectorAll(`[style*="${prop}"]`).forEach((node) => {
        node.style.removeProperty(prop);
        if (!node.getAttribute("style")) {
          node.removeAttribute("style");
        }
      });
    }
    for (const tag of clearInlineTags) {
      holder.querySelectorAll(tag).forEach((node) => {
        const fragment = document.createDocumentFragment();
        while (node.firstChild) {
          fragment.appendChild(node.firstChild);
        }
        node.replaceWith(fragment);
      });
    }
    source.html = sanitizeTextHtml(holder.innerHTML);
    source.text = textHtmlToPlain(source.html);
  }

  touch();
  if (overlay) {
    applyTextOverlayAutoFit(overlay, source);
  }
  renderStage();
  scheduleSourceListRefresh();
  renderOverlayInspector(false);
  return true;
}

// The toolbar's single entry point: format the selection when there is one,
// otherwise format the whole box, and always remember the choice as the
// default for the next box created.
function applyTextStyle(kind, value) {
  const applied = applyTextStyleInner(kind, value);
  // Keep the toolbar honest even when nothing was selected: the choice still
  // becomes the default for the next box, and the button should show it.
  renderTextToolbox();
  // ...then let the run under the caret have the last word, so B/I/U reflect
  // the selection rather than the box default when the two differ.
  syncTextToolFromCaret();
  return applied;
}

function applyTextStyleInner(kind, value) {
  const selectionActive = hasLiveTextSelection();

  switch (kind) {
    case "font":
      state.currentTextFont = value;
      if (selectionActive) {
        return runTextEditorCommand("fontName", value, { css: true });
      }
      return applyBoxTextStyle((s) => { s.font = value; }, { clearInlineProps: ["font-family"] });

    case "size": {
      state.currentTextSize = normalizeTextFontSize(value);
      if (selectionActive) {
        return applySelectionFontSize(state.currentTextSize);
      }
      return applyBoxTextStyle((s) => { s.fontSize = state.currentTextSize; }, { clearInlineProps: ["font-size"] });
    }

    case "bold":
      if (selectionActive) {
        return runTextEditorCommand("bold");
      }
      state.currentTextBold = !state.currentTextBold;
      return applyBoxTextStyle((s) => { s.bold = state.currentTextBold; }, {
        clearInlineProps: ["font-weight"],
        clearInlineTags: ["b", "strong"],
      });

    case "italic":
      if (selectionActive) {
        return runTextEditorCommand("italic");
      }
      state.currentTextItalic = !state.currentTextItalic;
      return applyBoxTextStyle((s) => { s.italic = state.currentTextItalic; }, {
        clearInlineProps: ["font-style"],
        clearInlineTags: ["i", "em"],
      });

    case "underline":
      if (selectionActive) {
        return runTextEditorCommand("underline");
      }
      state.currentTextUnderline = !state.currentTextUnderline;
      return applyBoxTextStyle((s) => { s.underline = state.currentTextUnderline; }, {
        clearInlineProps: ["text-decoration", "text-decoration-line"],
        clearInlineTags: ["u"],
      });

    case "color":
      state.currentTextColor = sanitizeHexColor(value, "#000000");
      if (selectionActive) {
        return runTextEditorCommand("foreColor", state.currentTextColor, { css: true });
      }
      return applyBoxTextStyle((s) => { s.color = state.currentTextColor; }, { clearInlineProps: ["color"] });

    case "subscript":
      return runTextEditorCommand("subscript");

    case "superscript":
      return runTextEditorCommand("superscript");

    case "bullets":
      return runTextEditorCommand("insertUnorderedList");

    case "bulletStyle":
      // Box-level, like valign: the marker style belongs to the whole box and
      // also becomes the default for the next box.
      state.currentTextBulletStyle = normalizeTextBulletStyle(value);
      return applyBoxTextStyle((s) => { s.bulletStyle = state.currentTextBulletStyle; });

    case "align":
      state.currentTextAlign = normalizeTextAlign(value);
      // Alignment is per paragraph in a multi-paragraph box, per box otherwise.
      if (selectionActive) {
        const command = {
          left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull",
        }[state.currentTextAlign];
        if (command && runTextEditorCommand(command, null, { css: true })) {
          return true;
        }
      }
      return applyBoxTextStyle((s) => { s.align = state.currentTextAlign; }, { clearInlineProps: ["text-align"] });

    case "valign":
      state.currentTextVAlign = normalizeTextVAlign(value);
      return applyBoxTextStyle((s) => { s.valign = state.currentTextVAlign; });

    case "autofit":
      state.currentTextAutoFit = normalizeTextAutoFit(value);
      return applyBoxTextStyle((s) => { s.autoFit = state.currentTextAutoFit; });

    case "fill":
      state.currentTextShaded = !!value;
      return applyBoxTextStyle((s) => { s.shaded = state.currentTextShaded; });

    case "fillColor":
      state.currentTextFillColor = sanitizeHexColor(value, "#c8dcf0");
      return applyBoxTextStyle((s) => {
        s.fillColor = state.currentTextFillColor;
        s.shaded = true;
      });

    case "fillOpacity":
      state.currentTextFillOpacity = safeClampNumber(value, 0, 1, 0.3);
      return applyBoxTextStyle((s) => { s.fillOpacity = state.currentTextFillOpacity; });

    case "clearFormat":
      if (selectionActive) {
        runTextEditorCommand("removeFormat");
        return applySelectionFontSize(getOverlayTextSourceByOverlayId(state.activeTextEditOverlayId)?.fontSize);
      }
      return applyBoxTextStyle((s) => {
        s.html = escapeTextToHtml(textHtmlToPlain(s.html));
        s.text = textHtmlToPlain(s.html);
      });

    default:
      return false;
  }
}

// Kept for callers outside the text module that only need a source mutation.
function applyTextStyleToSelectedOverlaySource(mutator) {
  const source = getSelectedOverlayTextSource();
  if (!source) {
    return false;
  }
  mutator(source);
  touch();
  renderStage();
  scheduleSourceListRefresh();
  renderOverlayInspector(false);
  return true;
}

let sourceListRefreshTimer = 0;

// renderSources() rebuilds the whole source list. Doing that on every keystroke
// made typing visibly laggy, so the label refresh is coalesced instead.
function scheduleSourceListRefresh() {
  window.clearTimeout(sourceListRefreshTimer);
  sourceListRefreshTimer = window.setTimeout(() => {
    sourceListRefreshTimer = 0;
    renderSources();
  }, 400);
}

// ── Autofit ──────────────────────────────────────────────────────────────────

// "grow" resizes the box to its content (PowerPoint's "Resize shape to fit
// text"); "shrink" scales the type down until it fits; "none" leaves it alone
// and lets the box scroll.
function applyTextOverlayAutoFit(overlay, source) {
  if (!overlay || !source) {
    return;
  }
  const el = dom.stage?.querySelector(`.overlay[data-overlay-id="${overlay.id}"]`);
  const textEl = el?.querySelector(".overlay-text-editable");
  if (!(el instanceof HTMLElement) || !(textEl instanceof HTMLElement)) {
    return;
  }
  const stageRect = dom.stage.getBoundingClientRect();
  if (!(stageRect.height > 0)) {
    return;
  }
  // The editor is laid out untransformed and then scaled by the global content
  // scale, so measured pixels have to be converted back before they become a
  // fraction of the stage.
  const contentScale = safeClampNumber(
    getEffectiveContentScale() * safeClampNumber(overlay.localScale, 0.25, 3, 1),
    0.25, 6, 1,
  );
  const mode = normalizeTextAutoFit(source.autoFit);

  if (mode !== "shrink") {
    textEl.style.removeProperty("--tx-fit");
  }

  if (mode === "grow") {
    const needed = textEl.scrollHeight;
    const available = textEl.clientHeight;
    if (needed > available + 1) {
      const extra = ((needed - available) * contentScale) / stageRect.height;
      const next = clamp(overlay.h + extra, 0.02, 1 - overlay.y);
      if (Math.abs(next - overlay.h) > 0.0005) {
        overlay.h = next;
        el.style.height = `${next * 100}%`;
        touch();
      }
    }
    return;
  }

  if (mode === "shrink") {
    // Binary-search-free: one proportional guess, then a correction pass. Two
    // measurements are enough for text and keep typing responsive.
    textEl.style.setProperty("--tx-fit", "1");
    for (let pass = 0; pass < 2; pass += 1) {
      const needed = textEl.scrollHeight;
      const available = textEl.clientHeight;
      if (needed <= available + 1) {
        break;
      }
      const current = parseFloat(textEl.style.getPropertyValue("--tx-fit")) || 1;
      const next = clamp(current * Math.sqrt(available / Math.max(1, needed)), 0.25, 1);
      textEl.style.setProperty("--tx-fit", String(Math.round(next * 1000) / 1000));
    }
  }
}

// ── Creating and editing ─────────────────────────────────────────────────────

function createTextOverlayAt(relX, relY, options = {}) {
  const slide = currentSlide();
  if (!slide) {
    return;
  }

  const sourceId = uid();
  const source = {
    id: sourceId,
    kind: "overlay-text",
    mime: "text/plain",
    name: "Text",
    text: "",
    html: "",
    font: state.currentTextFont || "Arial, sans-serif",
    fontSize: normalizeTextFontSize(state.currentTextSize, TEXT_SIZE_DEFAULT),
    bold: !!state.currentTextBold,
    italic: !!state.currentTextItalic,
    underline: !!state.currentTextUnderline,
    color: sanitizeHexColor(state.currentTextColor, "#000000"),
    shaded: !!state.currentTextShaded,
    fillColor: sanitizeHexColor(state.currentTextFillColor, "#c8dcf0"),
    fillOpacity: safeClampNumber(state.currentTextFillOpacity, 0, 1, 0.3),
    align: normalizeTextAlign(state.currentTextAlign),
    valign: normalizeTextVAlign(state.currentTextVAlign),
    autoFit: normalizeTextAutoFit(state.currentTextAutoFit),
    bulletStyle: normalizeTextBulletStyle(state.currentTextBulletStyle),
    lineHeight: 1.25,
  };
  ensureOverlayTextSourceDefaults(source);
  state.deck.assets[sourceId] = source;

  const zMax = slide.overlays.reduce((m, o) => Math.max(m, o.zIndex), 1);
  // Start one line tall for the chosen size and let autofit grow it, instead of
  // a fixed 11%-of-slide box that is wrong for anything but the old default.
  const stageRect = options.stageRect || dom.stage.getBoundingClientRect();
  const lineH = slidePointsToPx(source.fontSize) * source.lineHeight + 10;
  const width = options.width || 0.34;
  const height = clamp(stageRect.height ? (lineH / stageRect.height) : 0.09, 0.04, 0.5);

  let x = clamp(relX - width / 2, 0, 1 - width);
  let y = clamp(relY - height / 2, 0, 1 - height);
  if (options?.anchorAtClick) {
    const padX = stageRect?.width ? (6 / stageRect.width) : 0;
    const padY = stageRect?.height ? (4 / stageRect.height) : 0;
    x = clamp(relX - padX, 0, 1 - width);
    y = clamp(relY - padY, 0, 1 - height);
  }

  const overlay = createOverlay({ x, y, w: width, h: height });
  overlay.sourceId = sourceId;
  overlay.framed = false;
  overlay.shaded = false;
  overlay.locked = false;
  overlay.zIndex = zMax + 1;
  slide.overlays.push(overlay);
  state.selectedOverlayId = overlay.id;
  state.activeTextEditOverlayId = overlay.id;

  touch();
  renderAll();
  queueMicrotask(() => {
    focusTextOverlayEditor(overlay.id, true);
  });
}

function focusTextOverlayEditor(overlayId, placeAtEnd = true) {
  const node = dom.stage?.querySelector(`.overlay[data-overlay-id="${overlayId}"] .overlay-text-editable`);
  if (!(node instanceof HTMLElement)) {
    return false;
  }
  state.activeTextEditOverlayId = overlayId;
  node.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(!placeAtEnd);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  rememberTextSelection();
  updateTextToolboxVisibility();
  return true;
}

// A text box left completely empty is invisible clutter that still catches
// clicks, so it is discarded when it loses focus — as PowerPoint does.
function discardEmptyTextOverlay(overlayId) {
  const slide = currentSlide();
  if (!slide || !overlayId) {
    return false;
  }
  const overlay = slide.overlays.find((o) => o.id === overlayId);
  const source = overlay ? resolveAssetByAnyId(overlay.sourceId) : null;
  if (!overlay || !source || source.kind !== "overlay-text") {
    return false;
  }
  if (String(source.text || "").trim() || String(source.html || "").replace(/<br\s*\/?>|\s|&nbsp;/gi, "")) {
    return false;
  }
  slide.overlays = slide.overlays.filter((o) => o.id !== overlay.id);
  pruneMissingAnimationOverlayRefs(slide);
  delete state.deck.assets[resolveAssetKey(overlay.sourceId) || overlay.sourceId];
  if (state.selectedOverlayId === overlay.id) {
    state.selectedOverlayId = null;
  }
  if (state.activeTextEditOverlayId === overlay.id) {
    state.activeTextEditOverlayId = null;
  }
  touch();
  return true;
}

function endTextOverlayEdit({ discardIfEmpty = true } = {}) {
  const overlayId = state.activeTextEditOverlayId;
  if (!overlayId) {
    return;
  }
  commitActiveTextEditor();
  const node = getActiveTextEditorNode();
  state.activeTextEditOverlayId = null;
  state.savedTextRange = null;
  if (node) {
    node.blur();
  }
  let removed = false;
  if (discardIfEmpty) {
    removed = discardEmptyTextOverlay(overlayId);
  }
  if (removed) {
    renderAll();
  } else {
    renderStage();
  }
  updateTextToolboxVisibility();
}

function hexToRgba(hex, alpha) {
  const clean = sanitizeHexColor(hex, "#c8dcf0");
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${safeClampNumber(alpha, 0, 1, 0.3)})`;
}

// Keyboard behaviour inside a text box, matching what a slide editor is
// expected to do: the usual formatting shortcuts work, Escape steps out to the
// box (and then off it), and the deck's own navigation keys are held back so
// arrows and Delete edit text instead of moving slides.
function handleTextEditorKeydown(ev, overlay, source) {
  const key = ev.key;
  const mod = ev.ctrlKey || ev.metaKey;

  if (key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    // First Escape leaves the text and keeps the box selected, so the arrow
    // keys and Delete act on the box; a second Escape deselects.
    endTextOverlayEdit();
    state.selectedOverlayId = overlay.id;
    renderOverlayInspector(false);
    return;
  }

  if (mod && !ev.altKey) {
    const lower = String(key || "").toLowerCase();
    if (lower === "b") {
      ev.preventDefault();
      rememberTextSelection();
      applyTextStyle("bold");
      return;
    }
    if (lower === "i") {
      ev.preventDefault();
      rememberTextSelection();
      applyTextStyle("italic");
      return;
    }
    if (lower === "u") {
      ev.preventDefault();
      rememberTextSelection();
      applyTextStyle("underline");
      return;
    }
    // Ctrl+Shift+> / < — grow and shrink, as in PowerPoint and Word.
    if (ev.shiftKey && (key === ">" || key === "." || key === "<" || key === ",")) {
      ev.preventDefault();
      rememberTextSelection();
      const direction = (key === ">" || key === ".") ? 1 : -1;
      const base = hasLiveTextSelection() ? state.currentTextSize : source.fontSize;
      applyTextStyle("size", stepTextFontSize(base, direction));
      return;
    }
    if (!ev.shiftKey && key === ",") {
      ev.preventDefault();
      rememberTextSelection();
      applyTextStyle("subscript");
      return;
    }
    if (!ev.shiftKey && key === ".") {
      ev.preventDefault();
      rememberTextSelection();
      applyTextStyle("superscript");
      return;
    }
    if (lower === "l" && ev.shiftKey) {
      ev.preventDefault();
      rememberTextSelection();
      applyTextStyle("bullets");
      return;
    }
    if (lower === "a") {
      // Select all inside the box, never the whole document.
      ev.preventDefault();
      const node = ev.currentTarget;
      const selection = window.getSelection();
      if (node instanceof HTMLElement && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
        rememberTextSelection();
      }
      return;
    }
  }

  if (key === "Tab") {
    // Tab indents rather than moving focus out of the slide.
    ev.preventDefault();
    document.execCommand("insertHTML", false, "&nbsp;&nbsp;&nbsp;&nbsp;");
    commitActiveTextEditor();
    return;
  }

  // Everything else (arrows, Backspace, Delete, Enter, Space, PageUp/Down) is
  // ordinary text editing. Stop it reaching the deck-level shortcuts, which
  // would otherwise change slide or delete the overlay mid-sentence.
  ev.stopPropagation();
}

function ensurePresenterTextDefaults() {
  if (state.presenterTextDefaultsApplied) {
    return;
  }

  // Live annotation during a talk wants something readable from the back of
  // the room, so presenter-placed text starts large and bold.
  state.currentTextFont = "Arial, sans-serif";
  state.currentTextSize = 32;
  state.currentTextBold = true;
  state.currentTextItalic = false;
  state.currentTextUnderline = false;
  state.currentTextColor = "#c1121f";
  state.currentTextShaded = false;
  state.currentTextAlign = "left";
  state.currentTextVAlign = "top";
  state.currentTextAutoFit = "grow";
  state.currentTextBulletStyle = "disc";
  state.presenterTextDefaultsApplied = true;

  renderTextToolbox();
}

function focusPresenterTextOverlay(overlayId, placeAtEnd = true) {
  queueMicrotask(() => {
    if (state.mode !== "present" || state.presenterTextEditOverlayId !== overlayId) {
      return;
    }

    const node = dom.stage.querySelector(`.overlay[data-overlay-id="${overlayId}"] .overlay-text-editable`);
    if (!(node instanceof HTMLElement)) {
      return;
    }

    node.focus();
    if (!placeAtEnd) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

function beginPresenterTextEdit(overlayId, placeAtEnd = true) {
  const source = getOverlayTextSourceByOverlayId(overlayId);
  if (!source) {
    return false;
  }

  state.selectedOverlayId = overlayId;
  state.presenterTextEditOverlayId = overlayId;
  // Presenting shares the edit-mode editor, so selection-aware formatting,
  // caret preservation and the toolbar all behave identically live.
  state.activeTextEditOverlayId = overlayId;
  syncTextToolFromSelectedOverlaySource();
  renderOverlayInspector(false);
  renderStage();
  focusPresenterTextOverlay(overlayId, placeAtEnd);
  return true;
}

function endPresenterTextEdit() {
  if (!state.presenterTextEditOverlayId) {
    return;
  }
  const overlayId = state.presenterTextEditOverlayId;
  commitActiveTextEditor();
  state.presenterTextEditOverlayId = null;
  state.activeTextEditOverlayId = null;
  state.savedTextRange = null;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.classList.contains("overlay-text-editable")) {
    active.blur();
  }
  // A note typed and then cleared during a talk should not leave an invisible
  // click target on the slide.
  const removed = discardEmptyTextOverlay(overlayId);
  updateTextToolboxVisibility();
  if (removed) {
    renderAll();
  } else {
    renderStage();
  }
}

function refreshPresenterTextOverlayHighlights() {
  if (!dom.stage) {
    return;
  }

  const shouldHighlight = state.mode === "present" && state.presenterTextInsertArmed;
  dom.stage.style.cursor = shouldHighlight || !!state.presenterTextEditOverlayId ? "text" : "";

  const overlayNodes = dom.stage.querySelectorAll(".overlay");
  for (const overlayNode of overlayNodes) {
    if (!(overlayNode instanceof HTMLElement)) {
      continue;
    }
    overlayNode.style.cursor = shouldHighlight ? "text" : "";
  }

  const textNodes = dom.stage.querySelectorAll(".overlay .overlay-text-editable");
  for (const node of textNodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (shouldHighlight) {
      node.style.outline = "2px dashed rgba(37, 99, 235, 0.9)";
      node.style.outlineOffset = "2px";
      node.style.backgroundColor = "rgba(219, 234, 254, 0.35)";
    } else {
      node.style.outline = "";
      node.style.outlineOffset = "";
      node.style.backgroundColor = "";
    }
  }
}

function setPresenterTextInsertArmed(isArmed) {
  const next = !!isArmed;
  if (state.presenterTextInsertArmed === next) {
    return;
  }

  state.presenterTextInsertArmed = next;
  const shouldShowTextCursor = state.mode === "present" && (state.presenterTextInsertArmed || !!state.presenterTextEditOverlayId);
  if (dom.stage) {
    dom.stage.style.cursor = shouldShowTextCursor ? "text" : "";
  }
  refreshPresenterTextOverlayHighlights();
}

function shouldIgnorePresenterArmShortcutInDocument(doc) {
  const activeEl = doc?.activeElement;
  const tagName = String(activeEl?.tagName || "").toUpperCase();
  const inputType = tagName === "INPUT" ? String(activeEl.type || "").toLowerCase() : "";
  const nonTypingInputTypes = new Set(["checkbox", "radio", "button", "color", "range", "file"]);
  return tagName === "TEXTAREA"
    || tagName === "SELECT"
    || (tagName === "INPUT" && !nonTypingInputTypes.has(inputType))
    || !!activeEl?.isContentEditable;
}

function bindPresenterTextShortcutBridge(iframe, overlayId) {
  if (!iframe || !overlayId) {
    return;
  }

  iframe.addEventListener("load", () => {
    const win = iframe.contentWindow;
    if (!win) {
      return;
    }

    state.presenterTextBridgeWindows.set(win, overlayId);

    try {
      const doc = win.document;
      if (!doc) {
        return;
      }

      doc.addEventListener("keydown", (event) => {
        const key = String(event.key || "").toLowerCase();
        if (key !== "t" || event.repeat) {
          return;
        }
        if (shouldIgnorePresenterArmShortcutInDocument(doc)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        state.presenterTypeKeyDown = false;
        setPresenterTextInsertArmed(true);
        dom.modeHint.textContent = "Text mode armed from embedded HTML. Click the slide to place or edit text.";
      }, true);
    } catch {
      // Cross-origin or sandboxed frames cannot be bridged here.
    }
  });
}

function isPresenterTextInsertGesture(event) {
  return state.mode === "present" && state.presenterTextInsertArmed;
}

function isOverlayLockedInCurrentMode(overlay) {
  return state.mode === "present" && !!overlay?.locked;
}

function bindEvents() {
  dom.editModeBtn.addEventListener("click", () => setMode("edit"));
  dom.presentModeBtn.addEventListener("click", () => setMode("present"));
  dom.floatingToolbarToggleBtn?.addEventListener("click", toggleFloatingToolbar);
  dom.manualHelpBtn?.addEventListener("click", openManual);
  dom.aboutBtn?.addEventListener("click", openAbout);
  dom.fullscreenBtn.addEventListener("click", enterFullscreen);
  dom.themeSelect?.addEventListener("change", () => {
    const theme = normalizeThemeName(dom.themeSelect.value);
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures.
    }
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && state.mode === "present") {
      setMode("edit");
    }
  });

  dom.deckTitleInput.addEventListener("input", () => {
    state.deck.meta.title = dom.deckTitleInput.value || "Untitled Interactive Deck";
    touch();
    renderDeckMeta();
  });

  dom.globalContentScaleInput.addEventListener("input", () => {
    const v = safeClampNumber(dom.globalContentScaleInput.value, 0.5, 2, 1);
    ensureDeckSettings();
    state.deck.settings.globalContentScale = v;
    touch();
    renderDeckMeta();
    renderStage();
  });

  dom.globalContentScaleResetBtn?.addEventListener("click", () => {
    ensureDeckSettings();
    state.deck.settings.globalContentScale = 1;
    dom.globalContentScaleInput.value = "1";
    touch();
    renderDeckMeta();
    renderStage();
  });

  dom.scaleLockModeSelect.addEventListener("change", () => {
    ensureDeckSettings();
    state.deck.settings.scaleLockMode = dom.scaleLockModeSelect.value;
    touch();
    renderDeckMeta();
    renderStage();
  });

  dom.customRefWidthInput.addEventListener("input", () => {
    ensureDeckSettings();
    state.deck.settings.referenceWidth = safeClampNumber(dom.customRefWidthInput.value, 320, 7680, 960);
    touch();
    renderDeckMeta();
    renderStage();
  });

  dom.customRefHeightInput.addEventListener("input", () => {
    ensureDeckSettings();
    state.deck.settings.referenceHeight = safeClampNumber(dom.customRefHeightInput.value, 180, 4320, 540);
    touch();
    renderDeckMeta();
    renderStage();
  });

  dom.unpackedAssetsCheckbox?.addEventListener("change", () => {
    ensureDeckSettings();
    state.deck.settings.unpackedAssets = dom.unpackedAssetsCheckbox.checked;
    touch();
  });

  dom.autosaveEnabledCheckbox?.addEventListener("change", async () => {
    if (dom.autosaveEnabledCheckbox.checked) {
      state.autosaveEnabled = true;
      setAutosaveHint(`Autosave ON. Select backup file (${getAutosaveSuggestedName()})...`);
      await enableAutosave({ forcePick: true });
    } else {
      stopAutosaveTimer();
    }
  });

  document.getElementById("deckRootBtn")?.addEventListener("click", () => {
    if (!state.deckFileUrl) {
      alert("This only works when the deck was opened by double-clicking its .ipe file (the presenter then knows where the file is).");
      return;
    }
    dom.presentationRootInput.value = "deck:";
    dom.applyPresentationRootBtn.click();
  });

  dom.applyPresentationRootBtn?.addEventListener("click", () => {
    ensureDeckSettings();
    const raw = String(dom.presentationRootInput?.value || "").trim();
    state.deck.settings.presentationRootPath = raw;
    state.presentationRootFileUrl = resolvePresentationRootFromSetting(raw);
    savePresentationRootToLocalStorage(state.deck.meta.title, raw, state.currentZipFileHandle?.name || "");
    touch();
    renderDeckMeta();
    renderStage();
  });

  dom.printDeckBtn.addEventListener("click", printDeck);

  bindSlideTitleBar();

  dom.newDeckBtn.addEventListener("click", () => {
    if (!confirm("Create new deck? Unsaved changes will be lost.")) {
      return;
    }
    revokeRuntimePdfUrlsFromDeck(state.deck);
    revokeRuntimeImageUrls();
    state.deck = createEmptyDeck();
    seedDeckWithDefaultWhiteHdSlide(state.deck);
    state.currentSlideIndex = 0;
    state.selectedOverlayId = null;
    state.remapHistory = [];
    state.currentZipFileHandle = null;
    state.deckFileUrl = "";
    state.presentationRootFileUrl = "";
    state.deck.settings.presentationRootPath = "";
    resetAutosaveTargetKeepSelection();
    resetAnimationPlaybackForCurrentSlide();
    setDeckSessionReady(true);
    renderAll();
    persistLastDeckToStorage();
  });

  dom.importSlidesInput.addEventListener("change", async (e) => {
    await importSlides(e.target.files);
    e.target.value = "";
  });

  dom.remapSlidesInput.addEventListener("change", async (e) => {
    await remapSlides(e.target.files);
    e.target.value = "";
  });

  // ── Sections: section-divider slides, progress toggles, divider editor ──────
  dom.addSectionDividerBtn?.addEventListener("click", () => {
    addSectionDividerAfterIndex(state.currentSlideIndex);
  });

  dom.sectionProgressToggle?.addEventListener("change", () => {
    ensureDeckSettings();
    state.deck.settings.showSectionProgress = dom.sectionProgressToggle.checked;
    touch();
    renderStage();
  });

  dom.includeFrontEndToggle?.addEventListener("change", () => {
    ensureDeckSettings();
    state.deck.settings.includeFrontEndInProgress = dom.includeFrontEndToggle.checked;
    touch();
    renderStage();
  });

  dom.sectionProgressScaleRange?.addEventListener("input", () => {
    ensureDeckSettings();
    const v = safeClampNumber(dom.sectionProgressScaleRange.value, 0.5, 2.5, 1);
    state.deck.settings.sectionProgressScale = v;
    if (dom.sectionProgressScaleValue) dom.sectionProgressScaleValue.textContent = `${Math.round(v * 100)}%`;
    touch();
    renderStage();
  });

  dom.sectionRoleSelect?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!isSectionDivider(slide)) return;
    slide.sectionRole = normalizeSectionRole(dom.sectionRoleSelect.value);
    touch();
    renderAll();
  });

  dom.sectionTitleLongInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isSectionDivider(slide)) return;
    slide.titleLong = dom.sectionTitleLongInput.value;
    slide.name = dom.sectionTitleLongInput.value || "Section";
    touch();
    renderStage();
    renderThumbnailGrid();
    renderSlideList();
  });

  dom.sectionTitleShortInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isSectionDivider(slide)) return;
    slide.titleShort = dom.sectionTitleShortInput.value;
    touch();
    renderStage();
    renderThumbnailGrid();
  });

  dom.sectionEyebrowVisibleToggle?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!isSectionDivider(slide)) return;
    slide.eyebrowVisible = dom.sectionEyebrowVisibleToggle.checked;
    touch();
    renderStage();
  });

  dom.sectionEyebrowTextInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isSectionDivider(slide)) return;
    slide.eyebrowText = dom.sectionEyebrowTextInput.value;
    touch();
    renderStage();
  });

  dom.sectionStyleSelect?.addEventListener("change", () => {
    // One visual style for the whole deck: apply the choice to every section.
    const style = normalizeSectionStyle(dom.sectionStyleSelect.value);
    getSectionDividerSlides().forEach((d) => { d.sectionStyle = style; });
    touch();
    renderAll();
  });

  dom.sectionImageInput?.addEventListener("change", async (e) => {
    const slide = currentSlide();
    const f = e.target.files?.[0];
    if (!isSectionDivider(slide) || !f) { e.target.value = ""; return; }
    const dataUrl = await fileToDataUrl(f);
    const assetId = uid();
    const fp = await fingerprintFromDataUrl(dataUrl);
    state.deck.assets[assetId] = {
      id: assetId,
      kind: "slide-image",
      mime: f.type || "image/jpeg",
      name: f.name,
      dataUrl,
    };
    slide.slideAssetId = assetId;
    slide.fingerprint = fp;
    slide.fileSize = safeClampNumber(f.size, 0, Number.MAX_SAFE_INTEGER, 0);
    e.target.value = "";
    touch();
    renderAll();
  });

  dom.sectionMediaSelect?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!isSectionDivider(slide)) return;
    slide.slideAssetId = dom.sectionMediaSelect.value || "";
    touch();
    renderAll();
  });

  dom.sectionSimInput?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) await importSectionDividerSim(f);
  });

  dom.convertToRegularSlideBtn?.addEventListener("click", () => {
    convertCurrentSlideToRegular();
  });

  // ── Summary slides: title / design / layout / cells / zoom ──────────────────
  dom.addSummarySlideBtn?.addEventListener("click", () => {
    addSummarySlideAfterIndex(state.currentSlideIndex);
  });

  dom.summaryTitleInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    slide.summaryTitle = dom.summaryTitleInput.value;
    slide.name = dom.summaryTitleInput.value || "Summary";
    touch();
    renderStage();
    renderThumbnailGrid();
    renderSlideList();
  });

  dom.summaryEyebrowInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    slide.summaryEyebrow = dom.summaryEyebrowInput.value;
    touch();
    renderStage();
    renderThumbnailGrid();
  });

  dom.summaryStyleSelect?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    slide.summaryStyle = normalizeSummaryStyle(dom.summaryStyleSelect.value);
    touch();
    renderStage();
    renderThumbnailGrid();
  });

  dom.summaryLayoutSelect?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    slide.summaryLayout = normalizeSummaryLayout(dom.summaryLayoutSelect.value);
    touch();
    renderStage();
    renderThumbnailGrid();
  });

  dom.summaryRevealSelect?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    slide.summaryReveal = normalizeSummaryReveal(dom.summaryRevealSelect.value);
    state.summaryRevealCount = 0;
    touch();
    renderStage();
  });

  dom.summaryAddCellBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    if (slide.summaryItems.length >= SUMMARY_MAX_CELLS) return;
    const it = createSummaryItem();
    slide.summaryItems.push(it);
    state.summarySelectedItemId = it.id;
    touch();
    renderAll();
  });

  dom.summaryRemoveCellBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    if (slide.summaryItems.length <= SUMMARY_MIN_CELLS) return;
    let idx = slide.summaryItems.findIndex((it) => it.id === state.summarySelectedItemId);
    if (idx < 0) idx = slide.summaryItems.length - 1;
    slide.summaryItems.splice(idx, 1);
    state.summarySelectedItemId = slide.summaryItems[Math.min(idx, slide.summaryItems.length - 1)]?.id || null;
    touch();
    renderAll();
  });

  dom.summaryImageZoomRange?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    slide.summaryImageZoom = safeClampNumber(dom.summaryImageZoomRange.value, 0.4, 3, 1);
    if (dom.summaryImageZoomValue) dom.summaryImageZoomValue.textContent = `${Math.round(slide.summaryImageZoom * 100)}%`;
    touch();
    renderStage();
  });

  dom.summaryTextZoomRange?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    slide.summaryTextZoom = safeClampNumber(dom.summaryTextZoomRange.value, 0.4, 3, 1);
    if (dom.summaryTextZoomValue) dom.summaryTextZoomValue.textContent = `${Math.round(slide.summaryTextZoom * 100)}%`;
    touch();
    renderStage();
  });

  dom.summaryCellImageBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    const item = slide.summaryItems.find((it) => it.id === state.summarySelectedItemId);
    if (item) pickSummaryFigureImage(slide, item);
  });

  dom.summaryCellHtmlBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    const item = slide.summaryItems.find((it) => it.id === state.summarySelectedItemId);
    if (item) pickSummaryFigureHtml(slide, item);
  });

  dom.summaryCellClearBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    const item = slide.summaryItems.find((it) => it.id === state.summarySelectedItemId);
    if (!item) return;
    item.assetId = "";
    touch();
    renderAll();
  });

  dom.summaryCellTextInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    const item = slide.summaryItems.find((it) => it.id === state.summarySelectedItemId);
    if (!item) return;
    item.text = dom.summaryCellTextInput.value;
    touch();
    renderStage();
  });

  dom.summaryResetLayoutBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!isSummarySlide(slide)) return;
    slide.summaryRect = { ...DEFAULT_SUMMARY_RECT };
    touch();
    renderStage();
  });

  dom.convertSummaryToRegularBtn?.addEventListener("click", () => {
    convertSummaryToRegular();
  });

  // ── Title-page slides (v14): title / presenters / affiliation / logo / media
  dom.addTitleSlideBtn?.addEventListener("click", () => {
    addTitleSlideAfterIndex(state.currentSlideIndex);
  });

  dom.titleMainInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isTitleSlide(slide)) return;
    slide.titleMain = dom.titleMainInput.value;
    slide.name = dom.titleMainInput.value || "Title";
    touch();
    renderStage();
    renderThumbnailGrid();
    renderSlideList();
  });

  dom.titleSubtitleInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isTitleSlide(slide)) return;
    slide.titleSubtitle = dom.titleSubtitleInput.value;
    touch();
    renderStage();
    renderThumbnailGrid();
  });

  dom.titleEventInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!isTitleSlide(slide)) return;
    slide.titleEvent = dom.titleEventInput.value;
    touch();
    renderStage();
    renderThumbnailGrid();
  });

  dom.titleStyleSelect?.addEventListener("change", () => {
    // One design for the whole deck: apply the choice to every title-page.
    const style = normalizeTitleStyle(dom.titleStyleSelect.value);
    state.deck.slides.filter(isTitleSlide).forEach((t) => { t.titleStyle = style; });
    touch();
    renderAll();
  });

  dom.titleVariantSelect?.addEventListener("change", () => {
    const variant = normalizeTitleVariant(dom.titleVariantSelect.value);
    state.deck.slides.filter(isTitleSlide).forEach((t) => { t.titleVariant = variant; });
    touch();
    renderAll();
  });

  dom.titleLogoToggle?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!isTitleSlide(slide)) return;
    slide.titleLogoVisible = dom.titleLogoToggle.checked;
    touch();
    renderStage();
    renderThumbnailGrid();
  });

  dom.titleAddPresenterBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!isTitleSlide(slide)) return;
    if (slide.titlePresenters.length >= TITLE_MAX_PRESENTERS) return;
    slide.titlePresenters.push(createTitlePresenter());
    touch();
    renderAll();
  });

  dom.titleRemovePresenterBtn?.addEventListener("click", () => {
    const slide = currentSlide();
    if (!isTitleSlide(slide)) return;
    if (slide.titlePresenters.length <= TITLE_MIN_PRESENTERS) return;
    slide.titlePresenters.pop();
    touch();
    renderAll();
  });

  // Presenter name / affiliation edits — delegated to the presenters list.
  dom.titlePresentersList?.addEventListener("input", (e) => {
    const inp = e.target;
    if (!inp?.dataset?.presenterId || !inp.dataset.field) return;
    const slide = currentSlide();
    if (!isTitleSlide(slide)) return;
    const p = slide.titlePresenters.find((x) => x.id === inp.dataset.presenterId);
    if (!p) return;
    if (inp.dataset.field === "name") p.name = inp.value;
    else if (inp.dataset.field === "affiliation") p.affiliation = inp.value;
    touch();
    renderStage();
    renderThumbnailGrid();
  });

  dom.titleMediaSelect?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!isTitleSlide(slide)) return;
    slide.slideAssetId = dom.titleMediaSelect.value || "";
    touch();
    renderAll();
  });

  dom.titleImageInput?.addEventListener("change", async (e) => {
    const slide = currentSlide();
    const f = e.target.files?.[0];
    if (!isTitleSlide(slide) || !f) { e.target.value = ""; return; }
    const dataUrl = await fileToDataUrl(f);
    const assetId = uid();
    const fp = await fingerprintFromDataUrl(dataUrl);
    state.deck.assets[assetId] = {
      id: assetId,
      kind: "slide-image",
      mime: f.type || "image/jpeg",
      name: f.name,
      dataUrl,
    };
    slide.slideAssetId = assetId;
    slide.fingerprint = fp;
    slide.fileSize = safeClampNumber(f.size, 0, Number.MAX_SAFE_INTEGER, 0);
    e.target.value = "";
    touch();
    renderAll();
  });

  dom.titleSimInput?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    // Reuse the section-divider sim importer — it inspects the current slide
    // and sets slide.slideAssetId, which is exactly what a title-page needs.
    if (f) await importSectionDividerSim(f);
  });

  dom.convertTitleToRegularBtn?.addEventListener("click", () => {
    convertTitleToRegular();
  });

  // ── DTU logo watermark controls ─────────────────────────────────────────────
  const updateLogo = (mutate) => {
    const logo = ensureDeckLogoSettings(state.deck);
    mutate(logo);
    ensureDeckLogoSettings(state.deck); // re-clamp/normalise
    touch();
    renderSectionControls();
    renderStage();
  };
  dom.logoEnabledCheckbox?.addEventListener("change", () => {
    updateLogo((logo) => { logo.enabled = dom.logoEnabledCheckbox.checked; });
  });
  dom.logoColorSelect?.addEventListener("change", () => {
    updateLogo((logo) => { logo.color = dom.logoColorSelect.value; });
  });
  dom.logoScopeSelect?.addEventListener("change", () => {
    updateLogo((logo) => { logo.scope = dom.logoScopeSelect.value; });
  });
  dom.logoPositionSelect?.addEventListener("change", () => {
    updateLogo((logo) => { logo.position = dom.logoPositionSelect.value; });
  });
  dom.logoScaleRange?.addEventListener("input", () => {
    updateLogo((logo) => { logo.scale = parseFloat(dom.logoScaleRange.value); });
  });
  dom.logoOpacityRange?.addEventListener("input", () => {
    updateLogo((logo) => { logo.opacity = parseFloat(dom.logoOpacityRange.value); });
  });

  // ── People credits / acknowledgements / references controls ───────────────
  // Deck-global format changes: mutate settings.credits, then refresh the
  // stage layers in place (no full renderStage, so live embeds are untouched).
  const updateCredits = (mutate) => {
    const cfg = ensureDeckCreditsSettings(state.deck);
    mutate(cfg);
    ensureDeckCreditsSettings(state.deck); // re-clamp/normalise
    touch();
    renderCreditsControls();
    const slide = currentSlide();
    refreshSlideCreditsLayerInPlace(slide);
    refreshSlideReferencesBarInPlace(slide);
  };
  dom.creditsPositionSelect?.addEventListener("change", () => {
    // Position is now per-slide: write it to the current slide, not the deck config.
    const slide = currentSlide();
    if (!slide) return;
    ensureSlideCreditsDefaults(slide);
    const v = dom.creditsPositionSelect.value;
    slide.credits.position = CREDITS_POSITION_KEYS.includes(v) ? v : "";
    touch();
    renderCreditsControls();
    refreshSlideCreditsLayerInPlace(slide);
  });
  dom.creditsNameStyleSelect?.addEventListener("change", () => {
    updateCredits((c) => { c.nameStyle = dom.creditsNameStyleSelect.value; });
  });
  dom.creditsAckStyleSelect?.addEventListener("change", () => {
    updateCredits((c) => { c.ackStyle = dom.creditsAckStyleSelect.value; });
  });
  dom.creditsNarrowFontCheckbox?.addEventListener("change", () => {
    updateCredits((c) => { c.narrowNames = dom.creditsNarrowFontCheckbox.checked; });
  });
  dom.creditsShadeCheckbox?.addEventListener("change", () => {
    updateCredits((c) => { c.shade = dom.creditsShadeCheckbox.checked; });
  });
  dom.creditsShowAffiliationCheckbox?.addEventListener("change", () => {
    updateCredits((c) => { c.showAffiliation = dom.creditsShowAffiliationCheckbox.checked; });
  });
  dom.creditsScaleRange?.addEventListener("input", () => {
    updateCredits((c) => { c.scale = parseFloat(dom.creditsScaleRange.value); });
  });
  dom.ackPortraitScaleRange?.addEventListener("input", () => {
    updateCredits((c) => { c.ackPortraitScale = parseFloat(dom.ackPortraitScaleRange.value); });
  });
  dom.ackAreaScaleRange?.addEventListener("input", () => {
    updateCredits((c) => { c.ackAreaScale = parseFloat(dom.ackAreaScaleRange.value); });
  });
  dom.referencesScaleRange?.addEventListener("input", () => {
    updateCredits((c) => { c.referencesScale = parseFloat(dom.referencesScaleRange.value); });
  });

  // Per-slide mode: the two checkboxes act as a radio pair ("credits"/"ack"),
  // unchecking the active one turns the feature off for the slide.
  const setSlideCreditsMode = (mode) => {
    const slide = currentSlide();
    if (!slide) return;
    ensureSlideCreditsDefaults(slide);
    slide.credits.mode = mode;
    if (mode !== "off") state.creditsPickerHidden = false;
    touch();
    renderCreditsControls();
    refreshSlideCreditsLayerInPlace(slide);
  };
  dom.creditsEnabledCheckbox?.addEventListener("change", () => {
    setSlideCreditsMode(dom.creditsEnabledCheckbox.checked ? "credits" : "off");
  });
  dom.ackEnabledCheckbox?.addEventListener("change", () => {
    setSlideCreditsMode(dom.ackEnabledCheckbox.checked ? "ack" : "off");
  });
  dom.creditsInvertCheckbox?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!slide) return;
    ensureSlideCreditsDefaults(slide);
    slide.credits.invert = dom.creditsInvertCheckbox.checked;
    touch();
    refreshSlideCreditsLayerInPlace(slide);
  });
  dom.creditsPickerOpenBtn?.addEventListener("click", () => {
    state.creditsPickerHidden = false;
    renderCreditsPicker();
  });
  dom.referencesTextInput?.addEventListener("input", () => {
    const slide = currentSlide();
    if (!slide) return;
    ensureSlideCreditsDefaults(slide);
    slide.references.text = dom.referencesTextInput.value;
    touch();
    refreshSlideReferencesBarInPlace(slide);
  });
  dom.referencesInvertCheckbox?.addEventListener("change", () => {
    const slide = currentSlide();
    if (!slide) return;
    ensureSlideCreditsDefaults(slide);
    slide.references.invert = dom.referencesInvertCheckbox.checked;
    touch();
    refreshSlideReferencesBarInPlace(slide);
  });
  dom.peopleFolderInput?.addEventListener("change", (e) => {
    scanPeopleFolderFiles(e.target.files);
    e.target.value = "";
  });
  // Prefer the directory picker that reopens at the remembered People folder;
  // browsers without it fall through to the webkitdirectory input.
  dom.peopleFolderInput?.closest("label")?.addEventListener("click", (e) => {
    if (typeof window.showDirectoryPicker !== "function") return;
    e.preventDefault();
    void pickAndScanPeopleFolder();
  });

  dom.importOverlayImageInput.addEventListener("change", async (e) => {
    await importOverlayImages(e.target.files);
    e.target.value = "";
  });

  dom.importOverlaySequenceInput.addEventListener("change", async (e) => {
    await importOverlaySequence(e.target.files);
    e.target.value = "";
  });

  dom.importOverlayVideoInput.addEventListener("change", async (e) => {
    await importOverlayVideos(e.target.files);
    e.target.value = "";
  });

  dom.importOverlayPdfInput.addEventListener("change", async (e) => {
    await importOverlayPdfs(e.target.files);
    e.target.value = "";
  });

  dom.importOverlayHtmlInput.addEventListener("change", async (e) => {
    await importOverlayHtmlFiles(e.target.files);
    e.target.value = "";
  });

  dom.addHtmlFileLinkInput.addEventListener("change", async (e) => {
    await addHtmlFileLinkFiles(e.target.files);
    e.target.value = "";
  });

  dom.addExternalHtmlBtn?.addEventListener("click", addExternalHtmlSource);
  dom.addNotesBoardBtn?.addEventListener("click", addNotesBoardSource);
  dom.addNotebookPanelBtn?.addEventListener("click", addNotebookPanelSource);
  dom.pruneUnusedDataBtn?.addEventListener("click", pruneUnusedDeckDataInteractive);
  dom.clearSourcesBtn?.addEventListener("click", clearAllOverlaySources);

  dom.drawRectBtn.addEventListener("click", () => {
    state.drawingEnabled = !state.drawingEnabled;
    dom.drawRectBtn.classList.toggle("active", state.drawingEnabled);
    dom.modeHint.textContent = state.drawingEnabled
      ? "Draw mode active: drag on slide to create an overlay rectangle."
      : "Edit mode: draw rectangle then set source.";
  });

  dom.severOverlaySourceBtn?.addEventListener("click", severSelectedOverlaySource);

  dom.overlaySourceSelect.addEventListener("change", () => updateSelectedOverlay((o) => {
    const v = dom.overlaySourceSelect.value;
    o.sourceId = v === "__canvas__" ? "__canvas__" : v;
    applyOverlaySourceBehaviorDefaults(o);
  }));

  dom.overlayFramedCheckbox.addEventListener("change", () => updateSelectedOverlay((o) => {
    o.framed = dom.overlayFramedCheckbox.checked;
  }));

  dom.overlayShadedCheckbox.addEventListener("change", () => updateSelectedOverlay((o) => {
    o.shaded = dom.overlayShadedCheckbox.checked;
  }));

  dom.overlayLockedCheckbox.addEventListener("change", () => updateSelectedOverlay((o) => {
    o.locked = dom.overlayLockedCheckbox.checked;
  }));

  dom.overlayAllowKeyControlCheckbox.addEventListener("change", () => updateSelectedOverlay((o) => {
    o.allowKeyControl = dom.overlayAllowKeyControlCheckbox.checked;
  }));

  dom.overlayAllowWritingCheckbox.addEventListener("change", () => updateSelectedOverlay((o) => {
    ensureOverlayAnnotationDefaults(o);
    if (isNotebookPanelSource(o.sourceId)) {
      ensureOverlayNotebookDefaults(o);
      o.annotationsEnabled = true;
      o.notebookMode = dom.overlayAllowWritingCheckbox.checked ? "pen" : "type";
      o.notebookModeExplicit = true;
    } else {
      o.annotationsEnabled = dom.overlayAllowWritingCheckbox.checked;
    }
  }));

  dom.overlayOpacityRange.addEventListener("input", () => updateSelectedOverlay((o) => {
    o.opacity = parseFloat(dom.overlayOpacityRange.value);
  }));

  dom.overlayLocalScaleRange.addEventListener("input", () => updateSelectedOverlay((o) => {
    o.localScale = safeClampNumber(dom.overlayLocalScaleRange.value, 0.25, 3, 1);
    dom.overlayLocalScaleValue.textContent = `${Math.round((o.localScale || 1) * 100)}%`;
  }));

  dom.overlayLocalScaleResetBtn.addEventListener("click", () => updateSelectedOverlay((o) => {
    o.localScale = 1;
    dom.overlayLocalScaleRange.value = "1";
    dom.overlayLocalScaleValue.textContent = "100%";
  }));

  for (const [input, key] of [
    [dom.overlayXInput, "x"],
    [dom.overlayYInput, "y"],
    [dom.overlayWInput, "w"],
    [dom.overlayHInput, "h"],
  ]) {
    input.addEventListener("input", () => {
      updateSelectedOverlay((o) => {
        const v = clamp(parseFloat(input.value) / 100, key === "w" || key === "h" ? 0.01 : 0, 1);
        o[key] = v;
      });
    });
  }

  dom.bringFrontBtn.addEventListener("click", () => updateSelectedOverlay((o, slide) => {
    const max = slide.overlays.reduce((m, x) => Math.max(m, x.zIndex), 1);
    o.zIndex = max + 1;
  }));

  dom.sendBackBtn.addEventListener("click", () => updateSelectedOverlay((o) => {
    o.zIndex = 1;
  }));

  dom.prevSlideBtn.addEventListener("click", () => advancePresenterSequence(-1));
  dom.nextSlideBtn.addEventListener("click", () => advancePresenterSequence(1));

  dom.textToolBtn?.addEventListener("click", () => {
    state.textToolActive = !state.textToolActive;
    dom.textToolBtn.classList.toggle("active", state.textToolActive);
    dom.ftTextBtn?.classList.toggle("active", state.textToolActive);
    document.body.classList.toggle("text-tool-active", state.textToolActive);
    if (state.textToolActive) {
      dom.modeHint.textContent = "Text tool: click or drag on the slide to place a text box. Set the style first, or restyle afterwards.";
    } else {
      dom.modeHint.textContent = "Edit mode: click into any text box to type. Drag its grip or border to move it.";
    }
    updateTextToolboxVisibility();
    renderStage();
  });

  // Toolbar buttons must not take the caret away from the box being edited,
  // otherwise the selection collapses before the command runs.
  dom.textToolbox?.addEventListener("mousedown", (e) => {
    const control = e.target instanceof Element ? e.target.closest("button, input, select, label") : null;
    if (!control) {
      return;
    }
    rememberTextSelection();
    if (control.tagName === "BUTTON") {
      e.preventDefault();
    }
  });

  dom.textFontSelect?.addEventListener("change", (e) => {
    applyTextStyle("font", e.target.value);
  });

  const commitTextSize = (raw) => {
    const next = normalizeTextFontSize(raw, state.currentTextSize);
    if (dom.textSizeInput) {
      dom.textSizeInput.value = String(next);
    }
    applyTextStyle("size", next);
  };

  dom.textSizeInput?.addEventListener("change", (e) => commitTextSize(e.target.value));
  dom.textSizeInput?.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commitTextSize(e.target.value);
      focusTextOverlayEditor(state.activeTextEditOverlayId || state.selectedOverlayId);
    }
  });
  // Wheel over the size field steps the ladder, which is how people reach for
  // a size once they know roughly what they want.
  dom.textSizeInput?.addEventListener("wheel", (e) => {
    e.preventDefault();
    commitTextSize(stepTextFontSize(dom.textSizeInput.value, e.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  dom.textSizeUpBtn?.addEventListener("click", () => {
    commitTextSize(stepTextFontSize(state.currentTextSize, 1));
  });
  dom.textSizeDownBtn?.addEventListener("click", () => {
    commitTextSize(stepTextFontSize(state.currentTextSize, -1));
  });

  dom.textBoldBtn?.addEventListener("click", () => applyTextStyle("bold"));
  dom.textItalicBtn?.addEventListener("click", () => applyTextStyle("italic"));
  dom.textUnderlineBtn?.addEventListener("click", () => applyTextStyle("underline"));
  dom.textSubBtn?.addEventListener("click", () => applyTextStyle("subscript"));
  dom.textSupBtn?.addEventListener("click", () => applyTextStyle("superscript"));
  dom.textBulletBtn?.addEventListener("click", () => applyTextStyle("bullets"));
  dom.textBulletStyleSelect?.addEventListener("change", (e) => applyTextStyle("bulletStyle", e.target.value));
  dom.ftBulletStyleSelect?.addEventListener("change", (e) => applyTextStyle("bulletStyle", e.target.value));
  dom.textClearFormatBtn?.addEventListener("click", () => applyTextStyle("clearFormat"));

  dom.textColorInput?.addEventListener("input", (e) => applyTextStyle("color", e.target.value));

  dom.textAlignLeftBtn?.addEventListener("click", () => applyTextStyle("align", "left"));
  dom.textAlignCenterBtn?.addEventListener("click", () => applyTextStyle("align", "center"));
  dom.textAlignRightBtn?.addEventListener("click", () => applyTextStyle("align", "right"));

  dom.textVAlignBtn?.addEventListener("click", () => {
    const order = TEXT_VERTICAL_ALIGNMENTS;
    const next = order[(order.indexOf(state.currentTextVAlign) + 1) % order.length];
    applyTextStyle("valign", next);
    renderTextToolbox();
  });

  dom.textAutoFitBtn?.addEventListener("click", () => {
    const order = TEXT_AUTOFIT_MODES;
    const next = order[(order.indexOf(state.currentTextAutoFit) + 1) % order.length];
    applyTextStyle("autofit", next);
    renderTextToolbox();
  });

  dom.textShadingCheckbox?.addEventListener("change", (e) => applyTextStyle("fill", e.target.checked));
  dom.textFillColorInput?.addEventListener("input", (e) => {
    applyTextStyle("fillColor", e.target.value);
    renderTextToolbox();
  });
  dom.textFillOpacityInput?.addEventListener("input", (e) => {
    applyTextStyle("fillOpacity", Number(e.target.value) / 100);
  });

  dom.animAddAppearInstantBtn?.addEventListener("click", () => addAnimationEventForSelectedOverlay("appear-after-click"));
  dom.animAddAppearFadeBtn?.addEventListener("click", () => addAnimationEventForSelectedOverlay("appear-with-previous"));
  dom.animAddDisappearInstantBtn?.addEventListener("click", () => addAnimationEventForSelectedOverlay("remove-after-click"));
  dom.animAddDisappearFadeBtn?.addEventListener("click", () => addAnimationEventForSelectedOverlay("remove-with-previous"));
  dom.animPrevStepBtn?.addEventListener("click", () => {
    const events = getCurrentSlideAnimationEvents();
    setAnimationStep(getPreviousAnimationClickStepIndex(events, state.animationStepIndex), { animate: true });
  });
  dom.animNextStepBtn?.addEventListener("click", () => {
    const events = getCurrentSlideAnimationEvents();
    setAnimationStep(getNextAnimationClickStepIndex(events, state.animationStepIndex), { animate: true });
  });
  dom.animResetStepBtn?.addEventListener("click", () => setAnimationStep(-1, { animate: false }));
  dom.animAutoplayCheckbox?.addEventListener("change", () => {
    state.autoplayEnabled = !!dom.animAutoplayCheckbox.checked;
    scheduleAnimationAutoplay();
  });
  dom.animAutoplayDelayInput?.addEventListener("input", () => {
    state.autoplayDelayMs = safeClampNumber(dom.animAutoplayDelayInput.value, 100, 5000, DEFAULT_ANIMATION_AUTOPLAY_DELAY_MS);
    scheduleAnimationAutoplay();
  });

  dom.saveZipBtn.addEventListener("click", () => void saveDeckZip(false));
  dom.saveAsZipBtn?.addEventListener("click", () => void saveDeckZip(true));
  dom.loadZipBtn?.addEventListener("click", () => void openLoadZipDialog());
  dom.loadZipInput.addEventListener("change", async (e) => {
    if (e.target.files[0]) {
      await loadDeckZip(e.target.files[0], { fileHandle: null });
      e.target.value = "";
    }
  });

  dom.stage.addEventListener("mousedown", onStageMouseDown);
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mousemove", onPresenterHighlighterMouseMove, { passive: true });
  window.addEventListener("mouseup", onWindowMouseUp);
  window.addEventListener("wheel", onWindowWheelTextSize, { passive: false });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("pointerdown", (e) => {
    maybeCloseNotebookPenSubBarByTarget(e.target);
  }, true);
  document.addEventListener("pointermove", onThumbnailDragMove);
  document.addEventListener("pointerup", onThumbnailDragEnd);
  window.addEventListener("message", onWindowMessage);
  window.addEventListener("resize", () => {
    if (dom.floatingToolbar && (dom.floatingToolbar.style.left || dom.floatingToolbar.style.top)) {
      const rect = dom.floatingToolbar.getBoundingClientRect();
      applyFloatingToolbarPosition(rect.left, rect.top, { persist: true });
    }
    syncPresenterHighlighterCanvasSize();
    drawPresenterHighlighterFrame(performance.now());
    updateFloatingStyleMenuLayout();
    renderDeckMeta();
    renderStage();
    // Boards that survived the rebuild need the new slide-point scale.
    broadcastNotesScale();
  });

  dom.zoomBackdrop.addEventListener("click", closeZoom);
  dom.zoomCloseBtn.addEventListener("click", closeZoom);
  dom.manualBackdrop?.addEventListener("click", closeManual);
  dom.manualCloseBtn?.addEventListener("click", closeManual);
  dom.aboutBackdrop?.addEventListener("click", closeAbout);
  dom.aboutCloseBtn?.addEventListener("click", closeAbout);
  dom.manualHeader?.addEventListener("pointerdown", startManualDrag);
  dom.manualResizeHandle?.addEventListener("pointerdown", startManualResize);
  window.addEventListener("pointermove", onManualPointerMove);
  window.addEventListener("pointerup", onManualPointerUp);

  dom.floatingToolbarCloseBtn?.addEventListener("click", () => {
    state.floatingToolbarHidden = true;
    updateFloatingToolbarVisibility();
  });
  dom.ftDragHandle?.addEventListener("pointerdown", startFloatingToolbarDrag);
  window.addEventListener("pointermove", onFloatingToolbarPointerMove);
  window.addEventListener("pointerup", onFloatingToolbarPointerUp);

  dom.floatingToolbar?.querySelectorAll(".floating-toolbar-btn[data-proxy]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetId = e.currentTarget.getAttribute("data-proxy");
      if (!targetId || !dom[targetId]) {
        return;
      }
      dom[targetId].click();
    });
  });

  dom.ftStyleMenuToggleBtn?.addEventListener("click", () => {
    const shouldShow = dom.ftStyleMenu.classList.contains("hidden");
    dom.ftStyleMenu.classList.toggle("hidden", !shouldShow);
    if (shouldShow) {
      updateFloatingStyleMenuLayout();
    }
  });

  dom.floatingToolbar?.querySelectorAll(".floating-toolbar-submenu-btn[data-check-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const checkId = e.currentTarget.getAttribute("data-check-id");
      const checkbox = checkId ? dom[checkId] : null;
      if (!checkbox || checkbox.disabled) {
        return;
      }
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  dom.ftZoomRange?.addEventListener("input", () => {
    if (!dom.overlayLocalScaleRange || dom.overlayLocalScaleRange.disabled) {
      return;
    }
    dom.overlayLocalScaleRange.value = dom.ftZoomRange.value;
    dom.overlayLocalScaleRange.dispatchEvent(new Event("input", { bubbles: true }));
  });

  document.addEventListener("click", (e) => {
    if (!dom.ftStyleMenu || dom.ftStyleMenu.classList.contains("hidden")) {
      return;
    }
    const target = e.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest("#ftStyleMenu") && !target.closest("#ftStyleMenuToggleBtn")) {
      dom.ftStyleMenu.classList.add("hidden");
    }
  });
}

function setMode(mode) {
  if (mode !== "present") {
    clearAutoplayTimer();
    state.showPresenterEndScreen = false;
    resetPresenterHighlighterRuntime({ dropPoints: true });
  }
  state.mode = mode;
  if (mode !== "present") {
    state.keyControlOverlayId = null;
    state.presenterTextEditOverlayId = null;
    setPresenterTextInsertArmed(false);
  }
  document.body.classList.toggle("present-mode", mode === "present");
  dom.editModeBtn.classList.toggle("active", mode === "edit");
  dom.presentModeBtn.classList.toggle("active", mode === "present");
  dom.modeHint.textContent = mode === "edit"
    ? "Edit mode: draw rectangle then set source."
    : "Presenter mode: arrows navigate, embedded content stays interactive.";
  if (mode === "present") {
    // Never open the presentation on a hidden slide: jump to the nearest visible
    // one (forward first, then backward).
    if (currentSlide()?.hidden) {
      const fwd = nextVisibleSlideIndex(state.currentSlideIndex, 1);
      const target = fwd !== -1 ? fwd : nextVisibleSlideIndex(state.currentSlideIndex, -1);
      if (target !== -1) state.currentSlideIndex = target;
    }
    // Always start slide animations from initial state when entering presenter mode.
    state.animationStepIndex = -1;
    state.summaryRevealCount = 0;
    state.showPresenterEndScreen = false;
    resetPresenterHighlighterRuntime({ dropPoints: true });
    setAnimationStep(-1, { animate: false });
  }
  updateFloatingToolbarVisibility();
  renderCreditsPicker();
  renderStage();
  setPresenterTextInsertArmed(false);
  queueEmbeddedResizeKick();
}

function getEffectiveToolWithShiftEraser(baseTool, ev = null) {
  const shiftDown = !!state.shiftTempEraser || !!ev?.shiftKey;
  if (state.mode === "edit" && shiftDown) {
    return "eraser";
  }
  return baseTool;
}

function closeNotebookPenSubBar() {
  if (!state.notebookPenSubBarOpen && !state.notebookPenSubBarOverlayId) {
    return;
  }
  state.notebookPenSubBarOpen = false;
  state.notebookPenSubBarOverlayId = "";
  renderStage();
}

function rerenderAfterAnnotationToolStateChange() {
  if (state.selectedOverlayId && refreshStatefulHtmlOverlayAnnotationUi(state.selectedOverlayId)) {
    renderOverlayInspector(false);
    return;
  }
  renderStage();
}

function maybeCloseNotebookPenSubBarByTarget(target) {
  if (!state.notebookPenSubBarOpen) {
    return;
  }
  if (target instanceof Element && target.closest(".notebook-pen-wrap")) {
    return;
  }
  if (target instanceof Element && target.closest(".overlay-notebook-canvas")) {
    // Do not rebuild the overlay during the capture phase of a stroke-starting
    // pointer event. Removing/recreating the canvas here prevents its own
    // pointerdown listener from ever seeing the press.
    state.notebookPenSubBarOpen = false;
    state.notebookPenSubBarOverlayId = "";
    return;
  }
  closeNotebookPenSubBar();
}

function onKeyDown(e) {
  const key = String(e.key || "").toLowerCase();

  if (e.key === "Shift" && state.mode === "edit" && !state.shiftTempEraser) {
    state.shiftTempEraser = true;
    rerenderAfterAnnotationToolStateChange();
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "?" || e.key === "/")) {
    if (dom.manualModal.classList.contains("hidden")) {
      openManual();
    } else {
      closeManual();
    }
    e.preventDefault();
    return;
  }

  if (dom.manualModal.classList.contains("hidden") === false && e.key === "Escape") {
    closeManual();
    e.preventDefault();
    return;
  }

  if (dom.aboutModal?.classList.contains("hidden") === false && e.key === "Escape") {
    closeAbout();
    e.preventDefault();
    return;
  }

  if (dom.zoomModal.classList.contains("hidden") === false && e.key === "Escape") {
    closeZoom();
    e.preventDefault();
    return;
  }

  const activeEl = document.activeElement;
  const activeTag = activeEl?.tagName || "";
  const activeInputType = activeTag === "INPUT" ? String(activeEl.type || "").toLowerCase() : "";
  const nonTypingInputTypes = new Set(["checkbox", "radio", "button", "color", "range", "file"]);
  const editingContentEditable = !!activeEl?.isContentEditable;
  const typing = activeTag === "TEXTAREA"
    || activeTag === "SELECT"
    || (activeTag === "INPUT" && !nonTypingInputTypes.has(activeInputType))
    || editingContentEditable;
  // Any focused text field owns the keyboard. This used to be limited to edit
  // mode and presenter-placed text, so typing into a notebook panel while
  // presenting sent Space and the arrow keys to the deck and changed slide
  // mid-sentence. Escape and F5 still get through, so there is always a way out.
  if (typing && e.key !== "Escape" && e.key !== "F5") {
    return;
  }

  if (state.mode === "present" && key === "t") {
    setPresenterTextInsertArmed(true);
    e.preventDefault();
    return;
  }

  if (e.key === "Alt") {
    setPresenterHighlighterCtrlState(true);
  }

  if (state.mode === "edit" && isClipboardShortcut(e, "c")) {
    e.preventDefault();
    void copySelectedOverlayToClipboard();
    return;
  }

  if (state.mode === "edit" && isClipboardShortcut(e, "x")) {
    e.preventDefault();
    void cutSelectedOverlayToClipboard();
    return;
  }

  if (state.mode === "edit" && e.shiftKey && isClipboardShortcut(e, "v")) {
    e.preventDefault();
    void pasteImageOverlayFromClipboard();
    return;
  }

  if (state.mode === "edit" && isClipboardShortcut(e, "v")) {
    e.preventDefault();
    void pasteOverlayFromClipboard();
    return;
  }

  if (e.key === "F5") {
    enterFullscreen();
    e.preventDefault();
    return;
  }

  if (state.mode === "present" && state.keyControlOverlayId && e.key !== "Escape") {
    e.preventDefault();
    return;
  }

  if (state.mode === "present" && (e.code === "Space" || e.key === " ")) {
    const delta = e.shiftKey ? -1 : 1;
    setAnimationStep(state.animationStepIndex + delta, { animate: true });
    e.preventDefault();
    return;
  }

  if (isPresenterNextKey(e)) {
    if (isRapidNavRepeatForDelta(1)) {
      e.preventDefault();
      return;
    }
    advancePresenterSequence(1);
    e.preventDefault();
    return;
  }

  if (isPresenterPrevKey(e)) {
    if (isRapidNavRepeatForDelta(-1)) {
      e.preventDefault();
      return;
    }
    advancePresenterSequence(-1);
    e.preventDefault();
    return;
  }

  if (e.key === "Escape" && state.mode === "present") {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
    setMode("edit");
    e.preventDefault();
  }
  // ── Thumbnail-panel-scoped shortcuts (only when a thumbnail was last clicked) ──
  if (state.thumbnailPanelActive && !typing && state.mode === "edit") {
    // Ctrl+N — new blank slide after current
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      addBlankSlideAfterIndex(state.currentSlideIndex);
      return;
    }
    // Ctrl+D — duplicate current slide
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      duplicateSlideAtIndex(state.currentSlideIndex);
      return;
    }
    // Ctrl+C — copy slide to clipboard (silent)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C")) {
      const slide = currentSlide();
      if (slide) {
        state.slideClipboard = JSON.parse(JSON.stringify(slide));
        dom.modeHint.textContent = `Slide "${slide.name}" copied to clipboard.`;
      }
      e.preventDefault();
      return;
    }
    // Ctrl+X — cut slide (copy + delete with confirm)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "x" || e.key === "X")) {
      const slide = currentSlide();
      if (slide) {
        state.slideClipboard = JSON.parse(JSON.stringify(slide));
        deleteSlideAtIndex(state.currentSlideIndex);
      }
      e.preventDefault();
      return;
    }
    // Ctrl+V — paste slide after current
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "v" || e.key === "V")) {
      if (state.slideClipboard) {
        const clone = JSON.parse(JSON.stringify(state.slideClipboard));
        clone.uid = uid();
        clone.overlays = clone.overlays.map((o) => {
          const c = { ...o, id: uid() };
          applyOverlaySourceBehaviorDefaults(c);
          ensureOverlayNotebookDefaults(c);
          if (isNotesBoardSource(c.sourceId)) {
            ensureDeckNotesStore();
            const newKey = uid();
            const oldRecord = state.deck.notes?.[o.notesKey];
            state.deck.notes[newKey] = {
              doc: String(oldRecord?.doc || DEFAULT_NOTES_DOC),
              settings: normalizeNotesSettings(oldRecord?.settings),
              updatedAt: new Date().toISOString(),
            };
            c.notesKey = newKey;
          }
          return c;
        });
        clone.name = clone.name + " (paste)";
        const insertAt = state.currentSlideIndex + 1;
        state.deck.slides.splice(insertAt, 0, clone);
        state.currentSlideIndex = insertAt;
        state.selectedOverlayId = null;
        state.animationStepIndex = -1;
        touch();
        renderAll();
        dom.modeHint.textContent = `Slide "${state.slideClipboard.name}" pasted.`;
      }
      e.preventDefault();
      return;
    }
    // Backspace / Delete — delete current slide (no overlay selected)
    if ((e.key === "Delete" || e.key === "Backspace") && !state.selectedOverlayId) {
      e.preventDefault();
      deleteSlideAtIndex(state.currentSlideIndex);
      return;
    }
  }

  if ((e.key === "Delete" || e.key === "Backspace") && !typing && state.mode === "edit") {
    const slide = currentSlide();
    if (slide && state.selectedOverlayId) {
      const target = slide.overlays.find((o) => o.id === state.selectedOverlayId);
      if (target) {
        removeNotesForOverlay(target);
      }
      slide.overlays = slide.overlays.filter((o) => o.id !== state.selectedOverlayId);
      pruneMissingAnimationOverlayRefs(slide);
      state.selectedOverlayId = null;
      touch();
      renderAll();
      e.preventDefault();
    }
  }

  if (e.key === "ArrowDown" && state.mode === "edit" && !typing) {
    moveSlideDown(state.currentSlideIndex);
    e.preventDefault();
    return;
  }

  if (e.key === "ArrowUp" && state.mode === "edit" && !typing) {
    moveSlideUp(state.currentSlideIndex);
    e.preventDefault();
    return;
  }
}

function onKeyUp(e) {
  if (e.key === "Alt") {
    setPresenterHighlighterCtrlState(false);
  }
  if (e.key === "Shift" && state.shiftTempEraser) {
    state.shiftTempEraser = false;
    rerenderAfterAnnotationToolStateChange();
  }
}

function onWindowBlur() {
  setPresenterTextInsertArmed(false);
  setPresenterHighlighterCtrlState(false);
  if (state.shiftTempEraser) {
    state.shiftTempEraser = false;
    rerenderAfterAnnotationToolStateChange();
  }
}

function setPresenterHighlighterCtrlState(isDown) {
  const h = state.presenterHighlighter;
  h.ctrlDown = !!isDown;
  setPresenterHighlighterCaptureActive(h.ctrlDown);

  if (isDown) {
    return;
  }

  h.lastX = null;
  h.lastY = null;
  if (state.mode === "present" && h.points.length) {
    schedulePresenterHighlighterFade();
  }
}

function setPresenterHighlighterCaptureActive(isActive) {
  const h = state.presenterHighlighter;
  if (!h.capture) {
    return;
  }
  h.capture.style.pointerEvents = isActive ? "auto" : "none";
  h.capture.style.cursor = isActive ? "crosshair" : "default";
}

function resetPresenterHighlighterRuntime({ dropPoints = true } = {}) {
  const h = state.presenterHighlighter;
  h.ctrlDown = false;
  h.fading = false;
  h.fadeStartAt = 0;
  h.lastX = null;
  h.lastY = null;
  if (dropPoints) {
    h.points = [];
  }

  if (h.rafId) {
    cancelAnimationFrame(h.rafId);
    h.rafId = 0;
  }

  if (h.ctx && h.canvas) {
    h.ctx.setTransform(1, 0, 0, 1, 0, 0);
    h.ctx.clearRect(0, 0, h.canvas.width, h.canvas.height);
  }

  h.canvas = null;
  h.ctx = null;
  if (h.capture) {
    h.capture.style.pointerEvents = "none";
  }
  h.capture = null;
  h.stageWidth = 0;
  h.stageHeight = 0;
}

function schedulePresenterHighlighterFade() {
  const h = state.presenterHighlighter;
  if (h.rafId) {
    return;
  }
  h.rafId = requestAnimationFrame(onPresenterHighlighterFadeFrame);
}

function onPresenterHighlighterFadeFrame(ts) {
  const h = state.presenterHighlighter;
  h.rafId = 0;

  if (state.mode !== "present") {
    return;
  }

  ensurePresenterHighlighterLayer();
  drawPresenterHighlighterFrame(ts);

  if (h.points.length) {
    schedulePresenterHighlighterFade();
  }
}

function ensurePresenterHighlighterLayer() {
  if (state.mode !== "present" || !dom.stage) {
    return;
  }

  const h = state.presenterHighlighter;
  let capture = dom.stage.querySelector(".presenter-highlighter-capture");
  if (!(capture instanceof HTMLDivElement)) {
    capture = document.createElement("div");
    capture.className = "presenter-highlighter-capture";
    capture.addEventListener("pointermove", onPresenterHighlighterCapturePointerMove, { passive: true });
    dom.stage.appendChild(capture);
  }

  let canvas = dom.stage.querySelector(".presenter-highlighter-layer");
  if (!(canvas instanceof HTMLCanvasElement)) {
    canvas = document.createElement("canvas");
    canvas.className = "presenter-highlighter-layer";
    dom.stage.appendChild(canvas);
  }

  h.capture = capture;
  h.canvas = canvas;
  h.ctx = canvas.getContext("2d");
  setPresenterHighlighterCaptureActive(h.ctrlDown);
  syncPresenterHighlighterCanvasSize();
}

function syncPresenterHighlighterCanvasSize() {
  const h = state.presenterHighlighter;
  if (!h.canvas || !dom.stage) {
    return;
  }

  const rect = dom.stage.getBoundingClientRect();
  const cssW = Math.max(1, rect.width);
  const cssH = Math.max(1, rect.height);

  if (h.stageWidth > 0 && h.stageHeight > 0 && (h.stageWidth !== cssW || h.stageHeight !== cssH) && h.points.length) {
    const sx = cssW / h.stageWidth;
    const sy = cssH / h.stageHeight;
    const sr = (sx + sy) / 2;
    h.points.forEach((p) => {
      p.x *= sx;
      p.y *= sy;
      p.r *= sr;
    });
  }

  h.stageWidth = cssW;
  h.stageHeight = cssH;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  h.dpr = dpr;
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));

  if (h.canvas.width !== pxW || h.canvas.height !== pxH) {
    h.canvas.width = pxW;
    h.canvas.height = pxH;
  }
  h.canvas.style.width = `${cssW}px`;
  h.canvas.style.height = `${cssH}px`;
}

function drawPresenterHighlighterFrame(now = performance.now()) {
  const h = state.presenterHighlighter;
  if (!h.canvas || !h.ctx) {
    return;
  }

  syncPresenterHighlighterCanvasSize();

  const ctx = h.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, h.canvas.width, h.canvas.height);

  if (!h.points.length) {
    return;
  }

  ctx.setTransform(h.dpr, 0, 0, h.dpr, 0, 0);
  const alive = [];
  for (const p of h.points) {
    const pointLife = clamp(1 - ((now - (p.t0 || now)) / PRESENTER_HIGHLIGHTER_FADE_MS), 0, 1);
    const a = clamp(p.a * pointLife, 0, 0.72);
    if (a <= 0) {
      continue;
    }
    alive.push(p);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, `rgba(235, 18, 18, ${a})`);
    g.addColorStop(0.45, `rgba(235, 18, 18, ${a * 0.45})`);
    g.addColorStop(1, "rgba(235, 18, 18, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (alive.length !== h.points.length) {
    h.points = alive;
  }
}

function addPresenterHighlighterSpray(x, y, now = performance.now()) {
  const h = state.presenterHighlighter;
  const dabs = 8;
  const spread = 22;

  for (let i = 0; i < dabs; i += 1) {
    const t = Math.random();
    const jitter = spread * Math.sqrt(t);
    const ang = Math.random() * Math.PI * 2;
    const radialBias = 1 - (jitter / spread);
    h.points.push({
      x: x + (Math.cos(ang) * jitter),
      y: y + (Math.sin(ang) * jitter),
      r: 11 + (radialBias * 13) + (Math.random() * 4),
      a: 0.09 + (radialBias * 0.16),
      t0: now,
    });
  }

  if (h.points.length > PRESENTER_HIGHLIGHTER_MAX_POINTS) {
    h.points.splice(0, h.points.length - PRESENTER_HIGHLIGHTER_MAX_POINTS);
  }
}

function onPresenterHighlighterMouseMove(e) {
  handlePresenterHighlighterPointerMove(e.clientX, e.clientY, !!e.ctrlKey);
}

function onPresenterHighlighterCapturePointerMove(e) {
  handlePresenterHighlighterPointerMove(e.clientX, e.clientY, !!e.ctrlKey);
}

function handlePresenterHighlighterPointerMove(clientX, clientY, ctrlKeyDown) {
  const h = state.presenterHighlighter;
  const ctrlActive = h.ctrlDown || ctrlKeyDown;
  if (state.mode !== "present" || !ctrlActive || !dom.stage) {
    return;
  }

  // Recover gracefully if keydown was missed due to focus transitions.
  if (!h.ctrlDown && ctrlKeyDown) {
    h.ctrlDown = true;
    setPresenterHighlighterCaptureActive(true);
  }

  const rect = dom.stage.getBoundingClientRect();
  if (
    clientX < rect.left || clientX > rect.right
    || clientY < rect.top || clientY > rect.bottom
  ) {
    h.lastX = null;
    h.lastY = null;
    return;
  }

  ensurePresenterHighlighterLayer();

  const now = performance.now();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (h.lastX == null || h.lastY == null) {
    addPresenterHighlighterSpray(x, y, now);
  } else {
    const dx = x - h.lastX;
    const dy = y - h.lastY;
    const dist = Math.hypot(dx, dy);
    const step = 10;
    const segments = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments;
      addPresenterHighlighterSpray(h.lastX + (dx * t), h.lastY + (dy * t), now);
    }
  }

  h.lastX = x;
  h.lastY = y;
  drawPresenterHighlighterFrame(now);
  schedulePresenterHighlighterFade();
}

async function importSlides(fileList) {
  const files = Array.from(fileList || []).filter((f) => isImageFile(f));
  if (!files.length) {
    return;
  }

  files.sort((a, b) => naturalCollator.compare(a.name, b.name));

  const slides = [];
  for (const f of files) {
    const dataUrl = await fileToDataUrl(f);
    const assetId = uid();
    const fp = await fingerprintFromDataUrl(dataUrl);
    state.deck.assets[assetId] = {
      id: assetId,
      kind: "slide-image",
      mime: f.type || "image/jpeg",
      name: f.name,
      dataUrl,
    };
    slides.push(createSlide(assetId, f.name, fp, f.size || 0));
  }

  state.deck.slides = slides;
  state.deck.orphanedSlides = [];
  state.currentSlideIndex = 0;
  state.selectedOverlayId = null;
  state.remapHistory = [];
  touch();
  renderAll();
}

async function importOverlayImages(fileList) {
  const files = Array.from(fileList || []).filter((f) => isImageFile(f));
  if (!files.length) {
    clearPendingOverlaySourceTarget();
    return;
  }

  const addedIds = [];
  for (const f of files) {
    const dataUrl = await fileToDataUrl(f);
    const id = uid();
    state.deck.assets[id] = {
      id,
      kind: "overlay-image",
      mime: f.type || "image/jpeg",
      name: f.name,
      dataUrl,
    };
    addedIds.push(id);
  }

  consumePendingOverlaySourceTarget(addedIds);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
}

function parseSequenceFrameFileName(name) {
  const raw = String(name || "").trim();
  const dotIndex = raw.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex >= raw.length - 1) {
    return null;
  }
  const stem = raw.slice(0, dotIndex);
  const ext = raw.slice(dotIndex).toLowerCase();
  const match = stem.match(/^(.*?)(\d+)$/);
  if (!match) {
    return null;
  }
  const prefix = match[1];
  const index = Number.parseInt(match[2], 10);
  if (!Number.isFinite(index) || index < 1) {
    return null;
  }
  return { raw, prefix, ext, index };
}

function validateSequenceFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => isImageFile(f));
  if (files.length < 2) {
    return { ok: false, reason: "Select at least two image files for a sequence." };
  }

  const parsed = [];
  for (const file of files) {
    const info = parseSequenceFrameFileName(file.name);
    if (!info) {
      return { ok: false, reason: "Sequence files must end with numbers, e.g. Image1.jpg, Image2.jpg, ..." };
    }
    parsed.push({ file, ...info });
  }

  const prefixKey = parsed[0].prefix.toLowerCase();
  const ext = parsed[0].ext;
  for (const item of parsed) {
    if (item.prefix.toLowerCase() !== prefixKey || item.ext !== ext) {
      return { ok: false, reason: "All sequence files must share the same base name and extension." };
    }
  }

  parsed.sort((a, b) => a.index - b.index || naturalCollator.compare(a.raw, b.raw));
  for (let i = 0; i < parsed.length; i += 1) {
    if (parsed[i].index !== i + 1) {
      return { ok: false, reason: "Sequence numbering must be contiguous starting from 1 (1,2,3...)." };
    }
  }

  return {
    ok: true,
    orderedFiles: parsed.map((p) => p.file),
    prefix: parsed[0].prefix,
    ext,
  };
}

function ensureOverlaySequenceSourceDefaults(source) {
  if (!source || source.kind !== "overlay-sequence") {
    return;
  }

  // Backward-compatible migration: support draft schema using dataUrls array.
  if (!Array.isArray(source.frames) && Array.isArray(source.dataUrls)) {
    source.frames = source.dataUrls.map((dataUrl, i) => ({
      name: `${source.name || "frame"}${i + 1}`,
      mime: String(source.mime || "image/jpeg"),
      dataUrl: String(dataUrl || ""),
    }));
    delete source.dataUrls;
  }

  if (!Array.isArray(source.frames)) {
    source.frames = [];
  }

  source.frames = source.frames
    .map((frame, i) => ({
      name: String(frame?.name || `frame${i + 1}`),
      mime: String(frame?.mime || source.mime || "image/jpeg"),
      dataUrl: String(frame?.dataUrl || ""),
    }))
    .filter((frame) => !!frame.dataUrl);

  if (!source.mime && source.frames[0]?.mime) {
    source.mime = source.frames[0].mime;
  }
}

function normalizeOverlaySequenceIndex(index, frameCount) {
  const total = Math.max(1, Number(frameCount) || 1);
  const n = Number(index);
  if (!Number.isFinite(n)) {
    return 0;
  }
  const i = Math.floor(n);
  if (i < 0) {
    return 0;
  }
  if (i >= total) {
    return total - 1;
  }
  return i;
}

async function importOverlaySequence(fileList) {
  const validated = validateSequenceFiles(fileList);
  if (!validated.ok) {
    clearPendingOverlaySourceTarget();
    alert(validated.reason);
    return;
  }

  const frames = [];
  for (const f of validated.orderedFiles) {
    const dataUrl = await fileToDataUrl(f);
    frames.push({
      name: f.name,
      mime: f.type || "image/jpeg",
      dataUrl,
    });
  }

  const id = uid();
  const displayName = `${validated.prefix}[1-${frames.length}]${validated.ext}`;
  state.deck.assets[id] = {
    id,
    kind: "overlay-sequence",
    mime: frames[0]?.mime || "image/jpeg",
    name: displayName,
    frames,
  };

  consumePendingOverlaySourceTarget([id]);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
}

async function importOverlayVideos(fileList) {
  const files = Array.from(fileList || []).filter((f) => isVideoFile(f));
  if (!files.length) {
    clearPendingOverlaySourceTarget();
    return;
  }

  const addedIds = [];
  for (const f of files) {
    const dataUrl = await fileToDataUrl(f);
    const id = uid();
    state.deck.assets[id] = {
      id,
      kind: "overlay-video",
      mime: f.type || "video/mp4",
      name: f.name,
      dataUrl,
    };
    addedIds.push(id);
  }

  consumePendingOverlaySourceTarget(addedIds);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
}

async function importOverlayPdfs(fileList) {
  const files = Array.from(fileList || []).filter((f) => isPdfFile(f));
  if (!files.length) {
    clearPendingOverlaySourceTarget();
    return;
  }

  const addedIds = [];
  for (const f of files) {
    const dataUrl = await fileToDataUrl(f);
    const id = uid();
    state.deck.assets[id] = {
      id,
      kind: "overlay-pdf",
      mime: "application/pdf",
      name: f.name,
      dataUrl,
    };
    addedIds.push(id);
  }

  consumePendingOverlaySourceTarget(addedIds);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
}

async function importOverlayHtmlFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith(".html") || f.type.includes("html"));
  if (!files.length) {
    clearPendingOverlaySourceTarget();
    return;
  }

  const addedIds = [];
  for (const f of files) {
    const htmlText = await fileToText(f);
    const id = uid();
    state.deck.assets[id] = {
      id,
      kind: "overlay-html-file",
      mime: "text/html",
      name: f.name,
      htmlText,
    };
    addedIds.push(id);
  }

  consumePendingOverlaySourceTarget(addedIds);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
}

function addExternalHtmlSource() {
  const raw = prompt("Paste HTML URL/path to embed (this often fails because many websites block iframe embedding):", "https://");
  if (raw === null) {
    return;
  }
  const url = String(raw || "").trim();
  if (!url) {
    return;
  }
  const id = uid();
  state.deck.assets[id] = {
    id,
    kind: "overlay-html-external",
    mime: "text/uri-list",
    name: url,
    url,
  };
  consumePendingOverlaySourceTarget([id]);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
  dom.modeHint.textContent = "HTML link added. Embedding often fails because many sites block iframes (X-Frame-Options/CSP). If blocked, use an embeddable URL or the Open button.";
}

function printDeck() {
  if (!state.deckSessionReady || !state.deck.slides.length) {
    dom.modeHint.textContent = "No slides to print. Load or create a deck first.";
    return;
  }

  const pageCSS = `
    @page { size: landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; }
    .print-page {
      width: 100vw;
      height: 100vh;
      position: relative;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .print-page:last-child { page-break-after: avoid; break-after: avoid; }
    .print-slide-img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: center center;
    }
    .print-overlay {
      position: absolute;
      overflow: hidden;
    }
    .print-overlay-notes {
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: "Segoe UI Variable", "Segoe UI", Arial, sans-serif;
      font-size: 0.85rem;
      line-height: 1.45;
      padding: 6px 8px;
      background: rgba(255,255,255,0.92);
      color: #112846;
    }
    .print-overlay-notes h1 { font-size: 1.3em; color: #0b6cb8; margin: 0.2em 0; }
    .print-overlay-notes h2 { font-size: 1.05em; color: #112846; margin: 0.2em 0; opacity: 0.8; }
    .print-overlay-notes p  { margin: 0.2em 0; }
    .print-overlay-img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .print-annotation {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: fill;
      pointer-events: none;
    }
  `;

  const pages = state.deck.slides.map((slide) => {
    const slideAsset = resolveAssetByAnyId(slide.slideAssetId);
    const imgTag = slideAsset?.dataUrl
      ? `<img class="print-slide-img" src="${slideAsset.dataUrl}" alt="${slide.name || ""}" />`
      : `<div class="print-slide-img" style="background:#eee;display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:#888">${slide.name || "Slide"}</div>`;

    const sorted = [...(slide.overlays || [])].sort((a, b) => a.zIndex - b.zIndex);
    const overlayTags = sorted.map((overlay) => {
      const pct = (n) => `${(n * 100).toFixed(3)}%`;
      const style = [
        `left:${pct(overlay.x)}`,
        `top:${pct(overlay.y)}`,
        `width:${pct(overlay.w)}`,
        `height:${pct(overlay.h)}`,
        `opacity:${overlay.opacity ?? 1}`,
        overlay.framed ? "border:1px solid rgba(100,140,180,0.6)" : "",
        overlay.shaded ? "box-shadow:0 2px 10px rgba(0,0,0,0.2)" : "",
      ].filter(Boolean).join(";");

      const source = resolveAssetByAnyId(overlay.sourceId);
      let inner = "";

      if (source?.kind === "overlay-image" && source.dataUrl) {
        inner = `<img class="print-overlay-img" src="${source.dataUrl}" alt="${source.name || ""}" />`;
      } else if (source?.kind === "overlay-sequence") {
        ensureOverlaySequenceSourceDefaults(source);
        const frameIndex = normalizeOverlaySequenceIndex(overlay.sequenceIndex, source.frames.length);
        const frame = source.frames[frameIndex] || source.frames[0] || null;
        if (frame?.dataUrl) {
          inner = `<img class="print-overlay-img" src="${frame.dataUrl}" alt="${source.name || ""}" />`;
        }
      } else if (source?.kind === "overlay-text") {
        ensureOverlayTextSourceDefaults(source);
        inner = `<div class="print-overlay-notes" style="font-family:${source.font};font-size:${safeClampNumber(source.fontSize, 9, 24, 14)}px;font-weight:${source.bold ? 700 : 400};font-style:${source.italic ? "italic" : "normal"};color:${sanitizeHexColor(source.color, "#000000")};background:${source.shaded ? "rgba(200,220,240,0.3)" : "transparent"};white-space:pre-wrap;line-height:1.3;">${escapeHtml(String(source.text || ""))}</div>`;
      } else if (isNotesBoardSource(overlay.sourceId)) {
        const doc = state.deck.notes?.[overlay.notesKey]?.doc || "";
        inner = `<div class="print-overlay-notes">${doc}</div>`;
      }

      const notebookPage = isNotebookPanelSource(overlay.sourceId)
        ? getOverlayNotebookCurrentPage(overlay)
        : null;
      if (notebookPage) {
        // The typed notes carry markup now, so print the sanitized HTML rather
        // than escaping it into one wall of plain text.
        inner = `<div class="print-overlay-notes" style="position:absolute;inset:0;padding:10px 14px;box-sizing:border-box;line-height:1.4;">${sanitizeTextHtml(String(notebookPage.html || escapeHtml(String(notebookPage.text || ""))))}</div>`;
      }
      // Vector ink is rasterised once here so the printout matches the screen.
      const notebookAnno = notebookPage
        ? (renderNotebookPageToDataUrl(overlay, notebookPage) || String(notebookPage.drawingLayer || ""))
        : "";
      const notebookBg = notebookPage
        ? `<div class="print-overlay-notebook-bg" style="position:absolute;inset:0;background:${getNotebookBackgroundFill(notebookPage.backgroundMode)};"></div>`
        : "";
      const annoLayer = notebookAnno || overlay.annotationLayer;
      const anno = annoLayer
        ? `<img class="print-annotation" src="${annoLayer}" alt="" />`
        : "";

      return `<div class="print-overlay" style="${style}">${notebookBg}${inner}${anno}</div>`;
    }).join("\n");

    return `<div class="print-page">${imgTag}\n${overlayTags}</div>`;
  }).join("\n");

  const title = state.deck.meta?.title || "Deck";
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8"/>\n<title>${title}</title>\n<style>${pageCSS}</style>\n</head>\n<body>\n${pages}\n</body>\n</html>`;

  const pw = window.open("", "_blank");
  if (!pw) {
    dom.modeHint.textContent = "Print blocked — allow pop-ups for this page.";
    return;
  }
  pw.document.open();
  pw.document.write(html);
  pw.document.close();
  pw.addEventListener("load", () => {
    pw.focus();
    pw.print();
  });
}

function addNotesBoardSource() {
  if (!state.deckSessionReady) {
    dom.modeHint.textContent = "Create a New deck or Load one before adding a Notes Board source.";
    return;
  }

  const id = uid();
  state.deck.assets[id] = {
    id,
    kind: "overlay-notes-board",
    mime: "text/html",
    name: "Notes Board",
    url: NOTES_BOARD_FILE_NAME,
  };
  consumePendingOverlaySourceTarget([id]);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
  dom.modeHint.textContent = "Notes Board source added. Assign it to an overlay to enable slide text input with autosave.";
}

function addNotebookPanelSource() {
  if (!state.deckSessionReady) {
    dom.modeHint.textContent = "Create a New deck or Load one before adding a Notebook Panel source.";
    return;
  }

  const id = uid();
  state.deck.assets[id] = {
    id,
    kind: "overlay-notebook-panel",
    mime: "application/x-notebook-overlay",
    name: "Notebook Panel",
  };
  consumePendingOverlaySourceTarget([id]);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
  dom.modeHint.textContent = "Notebook Panel added. Assign it to an overlay for paged typing with optional pen drawing.";
}

async function addHtmlFileLinkFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith(".html") || f.type.includes("html"));
  if (!files.length) {
    clearPendingOverlaySourceTarget();
    return;
  }

  let directRefs = 0;
  let snapshotFallbacks = 0;
  let confirmedPaths = 0;
  let skipped = 0;
  const addedIds = [];
  for (const f of files) {
    const isNotesBoardFile = String(f.name || "").trim().toLowerCase() === NOTES_BOARD_FILE_NAME.toLowerCase();
    const directUrl = getSelectedHtmlFileReferenceUrl(f);
    if (directUrl) {
      directRefs += 1;
    }
    // v8 convention: keep HTML links relative to presentation root, preferably
    // under sims/ (or preserve sims/pdf subpath when known from absolute path).
    let storeUrl = "";
    if (directUrl) {
      storeUrl = relativizeAgainstPresentationRoot(directUrl)
        || inferConventionRelativeFromAbsolute(directUrl)
        || buildConventionRelativePath(f.name, "sims");
    } else if (isNotesBoardFile) {
      storeUrl = NOTES_BOARD_FILE_NAME;
    } else {
      // The browser file picker hands over a bare file name, never a folder, so
      // any path derived from the name alone is a guess and silently breaks for
      // files in a subfolder the guess knows nothing about. Offer the candidate
      // folders and let one be picked or a full path pasted — the latter is
      // converted to a portable relative one.
      storeUrl = await askForHtmlFileLinkPath(f.name);
      if (!storeUrl) {
        skipped += 1;
        continue;
      }
      confirmedPaths += 1;
      rememberHtmlFileLinkBase(storeUrl);
    }
    const htmlText = await fileToText(f);
    const unresolvedBareName = !directUrl
      && !/^(https?:|file:|data:|blob:|\/|\.\.\/|\.\/)/i.test(storeUrl) && !ROOT_LINK_FOLDER_RE.test(storeUrl)
      && !String(storeUrl).includes("/");
    const preferSnapshot = unresolvedBareName && !hasRelativeDependencies(htmlText);
    if (preferSnapshot) {
      snapshotFallbacks += 1;
    }
    const id = uid();
    state.deck.assets[id] = isNotesBoardFile
      ? {
        id,
        kind: "overlay-notes-board",
        mime: "text/html",
        name: "Notes Board",
        url: directUrl || NOTES_BOARD_FILE_NAME,
      }
      : {
        id,
        kind: "overlay-html-filelink",
        mime: "text/uri-list",
        name: f.name,
        url: storeUrl,
        htmlText,
        preferSnapshot,
      };
    addedIds.push(id);
  }

  if (!addedIds.length) {
    clearPendingOverlaySourceTarget();
    dom.modeHint.textContent = "HTML link cancelled — nothing added.";
    return;
  }

  consumePendingOverlaySourceTarget(addedIds);
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
  dom.modeHint.textContent = `HTML file link added. ${directRefs} direct reference(s) resolved; ${confirmedPaths} path(s) confirmed; ${snapshotFallbacks} using snapshot fallback${skipped ? `; ${skipped} cancelled` : ""}.`;
}

// The picked file's real folder is invisible to the page, so the candidate
// folders are offered as a short list instead of one silent guess. The deck's
// own sims/ folder is first and preselected because that is where linked sims
// normally live; the other candidates are there for the times it is not.
function htmlFileLinkPathCandidates(fileName) {
  const out = [];
  const push = (url, label) => {
    const clean = String(url || "").trim();
    if (!clean || out.some((c) => c.url === clean)) {
      return;
    }
    out.push({ url: clean, label });
  };
  push(buildConventionRelativePath(fileName, "sims"), "Deck sims folder");
  push(buildConventionRelativePath(fileName, "HTML"), "Deck HTML folder");
  push(presentationRootRelativePath(fileName), "Presentation folder");
  push(rememberedHtmlFileLinkPath(fileName), "Last used folder");
  push(workspaceFileGuessOutsideSims(fileName), "Guessed from the file name");
  return out;
}

// The presentation root as stored in deck settings, e.g.
// "../InteractivePresentations/2026 08 17 VL20 talk/". Skipped when the setting
// is an absolute location, which is not portable between machines.
function presentationRootRelativePath(fileName) {
  const root = String(state?.deck?.settings?.presentationRootPath || "").trim().replace(/\\/g, "/");
  if (!root || /^(https?:|file:|data:|blob:|deck:|\/|[a-z]:)/i.test(root)) {
    return "";
  }
  return joinRelativeUrlPath(root, fileName);
}

// Resolves to the chosen path, or "" when cancelled. A pasted absolute path
// (C:\... or file:///...) is normalized to a relative one so the deck stays
// portable.
async function askForHtmlFileLinkPath(fileName) {
  const candidates = htmlFileLinkPathCandidates(fileName);
  const root = getPresentationRootFileUrl();
  if (root) {
    for (let i = 0; i < candidates.length; i++) {
      if (!ROOT_LINK_FOLDER_RE.test(candidates[i].url)) continue;
      try {
        const r = await fetch(new URL(candidates[i].url, root).href, { cache: "no-store" });
        if (r.ok || r.status === 0) { candidates.unshift(candidates.splice(i, 1)[0]); break; }
      } catch { /* not there, or no file access */ }
    }
  }
  const preferred = candidates[0]?.url || buildConventionRelativePath(fileName, "sims");
  const finish = (raw) => {
    const trimmed = String(raw || "").trim();
    return trimmed ? (normalizeHtmlFileLinkInput(trimmed, fileName) || trimmed) : "";
  };

  const dlg = document.createElement("dialog");
  if (typeof dlg.showModal !== "function") {
    const answer = prompt(`Path for "${fileName}" — or paste the full path:`, preferred);
    return Promise.resolve(answer === null ? "" : finish(answer));
  }

  ensureHtmlLinkDialogStyle();
  dlg.className = "html-link-dialog";
  const options = candidates
    .map((c, i) => `
      <label class="html-link-option">
        <input type="radio" name="htmlLinkChoice" value="${escapeHtmlAttr(c.url)}"${i === 0 ? " checked" : ""}>
        <span class="html-link-option-text">
          <b>${escapeHtmlAttr(c.label)}</b>
          <code>${escapeHtmlAttr(c.url)}</code>
        </span>
      </label>`)
    .join("");
  dlg.innerHTML = `
    <form method="dialog">
      <h3>Link <code>${escapeHtmlAttr(fileName)}</code></h3>
      <p class="html-link-hint">The file picker does not reveal the folder. Pick where this file lives, or paste its full path.</p>
      ${options}
      <label class="html-link-field">
        <span>Path</span>
        <input type="text" class="html-link-input" value="${escapeHtmlAttr(preferred)}" spellcheck="false">
      </label>
      <menu>
        <button value="ok" class="html-link-btn primary">Link</button>
        <button value="cancel" class="html-link-btn">Cancel</button>
      </menu>
    </form>`;

  // The app's global shortcuts listen on window; with a radio focused, arrow
  // keys would otherwise page through slides behind the modal.
  dlg.addEventListener("keydown", (ev) => ev.stopPropagation());

  const input = dlg.querySelector(".html-link-input");
  for (const radio of dlg.querySelectorAll('input[name="htmlLinkChoice"]')) {
    radio.addEventListener("change", () => { input.value = radio.value; });
  }
  // Typing means the path is no longer one of the offered candidates.
  input.addEventListener("input", () => {
    for (const radio of dlg.querySelectorAll('input[name="htmlLinkChoice"]')) {
      radio.checked = radio.value === input.value.trim();
    }
  });

  document.body.appendChild(dlg);
  dlg.showModal();
  input.focus();
  input.select();

  return new Promise((resolve) => {
    dlg.addEventListener("close", () => {
      const chosen = dlg.returnValue === "ok" ? input.value : "";
      dlg.remove();
      resolve(finish(chosen));
    }, { once: true });
  });
}

function escapeHtmlAttr(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function ensureHtmlLinkDialogStyle() {
  if (document.getElementById("html-link-dialog-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "html-link-dialog-style";
  style.textContent = `
    .html-link-dialog{border:1px solid var(--line-strong,#a7b8cc);border-radius:12px;padding:0;
      background:var(--panel,#fff);color:var(--ink,#0f1d2f);box-shadow:var(--shadow-2,0 16px 40px rgba(10,28,52,.13));
      font:14px/1.45 "Segoe UI Variable","Segoe UI",Arial,sans-serif;max-width:min(620px,92vw)}
    .html-link-dialog::backdrop{background:rgba(10,28,52,.34)}
    .html-link-dialog form{padding:18px 20px;display:grid;gap:10px}
    .html-link-dialog h3{margin:0;font-size:15px;font-weight:650}
    .html-link-dialog h3 code,.html-link-option code{font-family:Consolas,monospace;font-size:12.5px}
    .html-link-hint{margin:0 0 4px;color:var(--muted,#546a86);font-size:12.5px}
    .html-link-option{display:flex;gap:9px;align-items:flex-start;padding:7px 9px;border:1px solid var(--line,#ced9e6);
      border-radius:8px;cursor:pointer}
    .html-link-option:hover{background:var(--accent-soft,#e3f0ff)}
    .html-link-option:has(input:checked){border-color:var(--accent,#0b6cb8);background:var(--accent-soft,#e3f0ff)}
    .html-link-option-text{display:grid;gap:1px;min-width:0}
    .html-link-option-text code{color:var(--ink-soft,#1f334d);word-break:break-all}
    .html-link-field{display:grid;gap:4px;margin-top:4px}
    .html-link-field span{color:var(--muted,#546a86);font-size:12px}
    .html-link-input{width:100%;padding:7px 9px;border:1px solid var(--line-strong,#a7b8cc);border-radius:7px;
      font-family:Consolas,monospace;font-size:12.5px}
    .html-link-input:focus{outline:none;border-color:var(--accent,#0b6cb8);box-shadow:var(--shadow-focus,0 0 0 3px rgba(11,108,184,.2))}
    /* Link is first in the DOM so Enter submits it; row-reverse keeps it on the right. */
    .html-link-dialog menu{display:flex;flex-direction:row-reverse;justify-content:flex-start;gap:8px;margin:8px 0 0;padding:0}
    .html-link-btn{padding:6px 14px;border:1px solid var(--line-strong,#a7b8cc);border-radius:7px;
      background:var(--bg-soft,#eef3f8);color:var(--ink,#0f1d2f);cursor:pointer;font:inherit}
    .html-link-btn.primary{background:var(--accent,#0b6cb8);border-color:var(--accent,#0b6cb8);color:#fff}`;
  document.head.appendChild(style);
}

function rememberHtmlFileLinkBase(url) {
  const normalized = String(url || "").replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  if (cut <= 0 || /^(https?:|data:|blob:)/i.test(normalized)) {
    return;
  }
  try {
    localStorage.setItem(HTML_LINK_BASE_STORAGE_KEY, normalized.slice(0, cut + 1));
  } catch {}
}

function rememberedHtmlFileLinkPath(fileName) {
  let base = "";
  try {
    base = localStorage.getItem(HTML_LINK_BASE_STORAGE_KEY) || "";
  } catch {}
  return base ? joinRelativeUrlPath(base, fileName) : "";
}

function clearPendingOverlaySourceTarget() {
  state.pendingOverlaySourceTargetId = null;
}

function setPendingOverlaySourceTarget(overlayId) {
  state.pendingOverlaySourceTargetId = String(overlayId || "");
}

function consumePendingOverlaySourceTarget(addedIds) {
  const overlayId = state.pendingOverlaySourceTargetId;
  state.pendingOverlaySourceTargetId = null;
  if (!overlayId || !Array.isArray(addedIds) || !addedIds.length) {
    return;
  }
  assignSourceToOverlayById(overlayId, addedIds[0]);
}

function assignSourceToOverlayById(overlayId, sourceId) {
  if (!overlayId) {
    return false;
  }
  for (const slide of state.deck.slides || []) {
    const overlay = (slide.overlays || []).find((item) => item.id === overlayId);
    if (!overlay) {
      continue;
    }
    overlay.sourceId = sourceId === "__canvas__" ? "__canvas__" : String(sourceId || "");
    applyOverlaySourceBehaviorDefaults(overlay);
    state.selectedOverlayId = overlay.id;
    touch();
    return true;
  }
  return false;
}

function severSelectedOverlaySource() {
  const slide = currentSlide();
  if (!slide || !state.selectedOverlayId) {
    dom.modeHint.textContent = "Select an overlay first.";
    return;
  }

  const overlay = (slide.overlays || []).find((item) => item.id === state.selectedOverlayId);
  if (!overlay) {
    dom.modeHint.textContent = "Selected overlay not found.";
    return;
  }

  const hasSource = !!String(overlay.sourceId || "").trim() && overlay.sourceId !== "__canvas__";
  if (!hasSource) {
    dom.modeHint.textContent = "Overlay already has no linked source.";
    return;
  }

  if (!confirm("Sever source link from selected overlay?")) {
    dom.modeHint.textContent = "Sever source cancelled.";
    return;
  }

  overlay.sourceId = "";
  touch();
  renderOverlayInspector();
  renderStage();
  dom.modeHint.textContent = "Overlay source link severed. Choose a new source from the overlay quick menu.";
}

function clearAllOverlaySources() {
  const sourceEntries = getOverlayAssetEntries();
  if (!sourceEntries.length) {
    dom.modeHint.textContent = "No overlay sources to clear.";
    return;
  }

  const usedCount = (state.deck.slides || []).reduce((total, slide) => total + (slide.overlays || []).filter((overlay) => {
    const key = resolveAssetKey(overlay.sourceId);
    return !!key && sourceEntries.some((entry) => entry.key === key);
  }).length, 0);

  const msg = usedCount > 0
    ? "Are you sure? The action cannot be undone.\n\nAll overlay sources will be removed, and overlays using them will become empty."
    : "Are you sure? The action cannot be undone.";
  if (!confirm(msg)) {
    return;
  }

  const sourceKeys = new Set(sourceEntries.map((entry) => entry.key));
  for (const key of sourceKeys) {
    const asset = state.deck.assets[key];
    if (asset && typeof asset === "object" && typeof asset.runtimePdfUrl === "string" && asset.runtimePdfUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(asset.runtimePdfUrl);
      } catch {
        // Ignore revoke failures.
      }
    }
    delete state.deck.assets[key];
  }

  for (const slide of state.deck.slides || []) {
    for (const overlay of slide.overlays || []) {
      const key = resolveAssetKey(overlay.sourceId);
      if (key && sourceKeys.has(key)) {
        overlay.sourceId = "";
      }
    }
  }

  clearPendingOverlaySourceTarget();
  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();
  dom.modeHint.textContent = "All overlay sources cleared.";
}

function resolveDeckAssetKeyByAnyId(assets, anyId) {
  const ref = String(anyId || "").trim();
  if (!ref) {
    return "";
  }
  if (assets && Object.prototype.hasOwnProperty.call(assets, ref)) {
    return ref;
  }
  for (const [key, asset] of Object.entries(assets || {})) {
    if (asset && String(asset.id || "") === ref) {
      return key;
    }
  }
  return "";
}

function collectReferencedAssetKeys(deck) {
  const assets = deck?.assets || {};
  const used = new Set();

  for (const slide of deck?.slides || []) {
    const slideKey = resolveDeckAssetKeyByAnyId(assets, slide?.slideAssetId);
    if (slideKey) {
      used.add(slideKey);
    }

    for (const overlay of slide?.overlays || []) {
      const sourceId = String(overlay?.sourceId || "").trim();
      if (!sourceId || sourceId === "__canvas__") {
        continue;
      }
      const sourceKey = resolveDeckAssetKeyByAnyId(assets, sourceId);
      if (sourceKey) {
        used.add(sourceKey);
      }
    }

    // Summary-slide cells reference image / HTML figures by asset key too.
    for (const item of slide?.summaryItems || []) {
      const itemAssetId = String(item?.assetId || "").trim();
      if (!itemAssetId) {
        continue;
      }
      const itemKey = resolveDeckAssetKeyByAnyId(assets, itemAssetId);
      if (itemKey) {
        used.add(itemKey);
      }
    }
  }

  return used;
}

function pruneDeckUnreferencedAssetsInPlace(deck) {
  if (!deck || typeof deck !== "object") {
    return {
      removedAssetCount: 0,
      removedOverlaySourceCount: 0,
      removedSlideAssetCount: 0,
    };
  }

  if (!deck.assets || typeof deck.assets !== "object") {
    deck.assets = {};
    return {
      removedAssetCount: 0,
      removedOverlaySourceCount: 0,
      removedSlideAssetCount: 0,
    };
  }

  const assets = deck.assets;
  const usedKeys = collectReferencedAssetKeys(deck);
  const removedKeys = new Set();
  let removedOverlaySourceCount = 0;
  let removedSlideAssetCount = 0;

  for (const key of Object.keys(assets)) {
    if (usedKeys.has(key)) {
      continue;
    }
    removedKeys.add(key);
    delete assets[key];
  }

  for (const slide of deck.slides || []) {
    const slideKey = resolveDeckAssetKeyByAnyId(assets, slide?.slideAssetId);
    if (!slideKey && slide?.slideAssetId) {
      slide.slideAssetId = "";
      removedSlideAssetCount++;
    } else if (slideKey) {
      slide.slideAssetId = slideKey;
    }

    for (const overlay of slide?.overlays || []) {
      const sourceId = String(overlay?.sourceId || "").trim();
      if (!sourceId || sourceId === "__canvas__") {
        continue;
      }
      const sourceKey = resolveDeckAssetKeyByAnyId(assets, sourceId);
      if (!sourceKey) {
        overlay.sourceId = "";
        removedOverlaySourceCount++;
      } else {
        overlay.sourceId = sourceKey;
      }
    }
  }

  return {
    removedAssetCount: removedKeys.size,
    removedOverlaySourceCount,
    removedSlideAssetCount,
  };
}

function getPrunePreviewStats(deck) {
  try {
    const snapshot = JSON.parse(JSON.stringify(deck || {}));
    return pruneDeckUnreferencedAssetsInPlace(snapshot);
  } catch {
    return {
      removedAssetCount: 0,
      removedOverlaySourceCount: 0,
      removedSlideAssetCount: 0,
    };
  }
}

function pruneUnusedDeckDataInteractive() {
  const preview = getPrunePreviewStats(state.deck);
  if (!preview.removedAssetCount && !preview.removedOverlaySourceCount && !preview.removedSlideAssetCount) {
    dom.modeHint.textContent = "No unused data found. Deck already clean.";
    return;
  }

  const confirmed = confirm(
    [
      "Prune unused data?",
      "",
      `Unused assets to remove: ${preview.removedAssetCount}`,
      `Overlay source refs cleared: ${preview.removedOverlaySourceCount}`,
      `Slide background refs cleared: ${preview.removedSlideAssetCount}`,
    ].join("\n"),
  );
  if (!confirmed) {
    dom.modeHint.textContent = "Prune cancelled.";
    return;
  }

  const stats = pruneDeckUnreferencedAssetsInPlace(state.deck);
  if (!stats.removedAssetCount && !stats.removedOverlaySourceCount && !stats.removedSlideAssetCount) {
    dom.modeHint.textContent = "No unused data found. Deck already clean.";
    return;
  }

  clearPendingOverlaySourceTarget();
  if (state.selectedOverlayId) {
    const slide = currentSlide();
    const stillExists = (slide?.overlays || []).some((o) => o.id === state.selectedOverlayId);
    if (!stillExists) {
      state.selectedOverlayId = null;
    }
  }

  touch();
  renderSources();
  renderOverlayInspector();
  renderStage();

  dom.modeHint.textContent = `Pruned ${stats.removedAssetCount} unused asset(s).`;
}

function getWorkspaceRootPrefix() {
  // Support both common deployments:
  // 1) .../InteractivePresenter/InteractivePresenter.html -> "../"
  // 2) .../InteractivePresentations/Presenter/InteractivePresenter/InteractivePresenter.html -> "../../../"
  const path = String(window?.location?.pathname || "").replace(/\\/g, "/").toLowerCase();
  if (path.includes("/interactivepresentations/presenter/interactivepresenter/")) {
    return "../../../";
  }
  return "../";
}


function buildConventionRelativePath(fileName, folder = "sims") {
  const rawName = String(fileName || "").trim();
  if (!rawName) {
    return "";
  }
  const encodedName = encodeURIComponent(rawName).replace(/%2F/gi, "/");
  const cleanFolder = String(folder || "sims").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "sims";
  return `${cleanFolder}/${encodedName}`;
}

function normalizeConventionRelativePath(rawPath) {
  const normalized = String(rawPath || "").trim().replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  if (ROOT_LINK_FOLDER_RE.test(normalized)) {
    return normalized.replace(/^\.\//, "");
  }
  return "";
}

function inferConventionRelativeFromAbsolute(absoluteUrl) {
  const raw = String(absoluteUrl || "").trim();
  if (!raw) {
    return "";
  }
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch {}
  const normalized = decoded.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const markers = ROOT_LINK_FOLDERS.map((d) => `/${d}/`);
  for (const marker of markers) {
    const idx = lower.lastIndexOf(marker);
    if (idx >= 0) {
      return normalized.slice(idx + 1);
    }
  }
  return "";
}

function savePresentationRootToLocalStorage(deckTitle, rawPath, zipFileName = "") {
  try {
    const normalized = String(rawPath || "").trim();
    if (/^deck:/i.test(normalized)) return; // depends on where the .ipe is: not remembered per title
    const titleKey = `presRoot:title:${String(deckTitle || "").trim().toLowerCase() || "_default"}`;
    const zipKey = `presRoot:zip:${String(zipFileName || "").trim().toLowerCase() || "_default"}`;

    if (normalized) {
      localStorage.setItem(titleKey, normalized);
      localStorage.setItem("presRoot:lastUsed", normalized);
      if (String(zipFileName || "").trim()) {
        localStorage.setItem(zipKey, normalized);
      }
    } else {
      localStorage.removeItem(titleKey);
      if (String(zipFileName || "").trim()) {
        localStorage.removeItem(zipKey);
      }
    }
  } catch {}
}

function loadPresentationRootFromLocalStorage(deckTitle, zipFileName = "") {
  try {
    const zipKey = `presRoot:zip:${String(zipFileName || "").trim().toLowerCase() || "_default"}`;
    const titleKey = `presRoot:title:${String(deckTitle || "").trim().toLowerCase() || "_default"}`;
    return localStorage.getItem(zipKey)
      || localStorage.getItem(titleKey)
      || localStorage.getItem("presRoot:lastUsed")
      || "";
  } catch {
    return "";
  }
}

function setPresentationRootFromZipFile(file, options = {}) {
  ensureDeckSettings();
  const explicitRoot = String(state.deck.settings.presentationRootPath || "").trim();
  if (explicitRoot) {
    state.presentationRootFileUrl = resolvePresentationRootFromSetting(explicitRoot);
    return;
  }
  if (state.deckFileUrl) {
    // no root stored in the deck and we know where the .ipe lives: its folder is the root, and the deck
    // remembers that as "deck:" so it stays portable (copy the .ipe with its sims folder anywhere)
    state.presentationRootFileUrl = resolvePresentationRootFromSetting("deck:");
    state.deck.settings.presentationRootPath = "deck:";
    return;
  }

  const pathCandidate = String(options?.zipPath || file?.path || "").trim();
  if (!pathCandidate) {
    state.presentationRootFileUrl = "";
    return;
  }
  const asUrl = toFileUrl(pathCandidate);
  if (!/^file:/i.test(asUrl)) {
    state.presentationRootFileUrl = "";
    return;
  }
  try {
    const rootUrl = new URL("./", asUrl).href;
    state.presentationRootFileUrl = rootUrl;
    const asRelative = computePresenterRelativeFromAbsolute(rootUrl);
    state.deck.settings.presentationRootPath = asRelative || rootUrl;
  } catch {
    state.presentationRootFileUrl = "";
  }
}

function resolvePresentationRootFromSetting(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return "";
  }
  if (/^deck:/i.test(raw)) {
    // relative to the .ipe file's folder; unknown unless the deck was opened by double-clicking the file
    if (!state.deckFileUrl) {
      return "";
    }
    const rest = raw.slice(5).trim().replace(/\\/g, "/");
    try {
      return new URL(rest ? (rest.endsWith("/") ? rest : rest + "/") : "./", state.deckFileUrl).href;
    } catch {
      return "";
    }
  }
  if (/^file:/i.test(raw)) {
    try {
      return new URL("./", raw).href;
    } catch {
      return raw;
    }
  }
  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) {
    const asFile = toFileUrl(raw);
    try {
      return new URL("./", asFile).href;
    } catch {
      return asFile;
    }
  }
  const normalized = raw.replace(/\\/g, "/");
  const abs = toAbsoluteIfFileProtocol(normalized);
  try {
    return new URL("./", abs).href;
  } catch {
    return abs;
  }
}

function getPresentationRootFileUrl() {
  return String(state.presentationRootFileUrl || "").trim();
}

function toPresentationRootAbsolute(relativePath) {
  const rel = normalizeConventionRelativePath(relativePath) || String(relativePath || "").trim().replace(/\\/g, "/");
  const root = getPresentationRootFileUrl();
  if (!rel || !root) {
    return "";
  }
  try {
    return new URL(rel, root).href;
  } catch {
    return "";
  }
}

function relativizeAgainstPresentationRoot(absoluteUrl) {
  const root = getPresentationRootFileUrl();
  if (!root || !absoluteUrl) {
    return "";
  }
  try {
    const abs = new URL(String(absoluteUrl));
    const rootUrl = new URL(root);
    if (abs.protocol.toLowerCase() !== "file:" || rootUrl.protocol.toLowerCase() !== "file:") {
      return "";
    }

    const decodePath = (p) => {
      let out = String(p || "").replace(/\\/g, "/");
      try { out = decodeURIComponent(out); } catch {}
      out = out.replace(/^\/(?:[a-zA-Z]:\/)/, (m) => m.slice(1));
      return out;
    };

    const baseSegs = decodePath(rootUrl.pathname).split("/").filter(Boolean);
    const fileSegs = decodePath(abs.pathname).split("/").filter(Boolean);
    if (!baseSegs.length || !fileSegs.length) {
      return "";
    }
    if (baseSegs[0].toLowerCase() !== fileSegs[0].toLowerCase()) {
      return "";
    }

    let i = 0;
    while (i < baseSegs.length && i < fileSegs.length && baseSegs[i].toLowerCase() === fileSegs[i].toLowerCase()) {
      i += 1;
    }

    // For this convention we only keep descendants of presentation root.
    if (i < baseSegs.length) {
      return "";
    }
    const rel = fileSegs.slice(i).join("/");
    return normalizeConventionRelativePath(rel) || rel;
  } catch {
    return "";
  }
}

function fromWorkspaceRoot(relativePath) {
  return `${getWorkspaceRootPrefix()}${String(relativePath || "").replace(/^\/+/, "")}`;
}

function getSelectedHtmlFileReferenceUrl(file) {
  // Some Chromium/Electron contexts expose a real local path on selected files.
  const pathCandidate = String(file?.path || "").trim();
  // Use file:// links only when presenter itself is opened from file://.
  // In hosted contexts, file:// iframe loading is commonly blocked.
  const presenterIsFileProtocol = String(window?.location?.protocol || "").toLowerCase() === "file:";
  if (presenterIsFileProtocol && pathCandidate && !/fakepath/i.test(pathCandidate)) {
    return toFileUrl(pathCandidate);
  }

  // If browser security hides absolute paths, return empty and let caller fall back.
  return "";
}

function toFileUrl(pathLike) {
  const raw = String(pathLike || "").trim();
  if (!raw) {
    return "";
  }

  if (/^(https?:|file:|data:|blob:)/i.test(raw)) {
    return raw;
  }

  const normalized = raw.replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("//")) {
    return `file:${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }

  return normalized;
}

function guessHtmlFileLinkUrlFromName(fileName) {
  const rawName = String(fileName || "").trim();
  if (!rawName) {
    return "";
  }

  const encodedName = encodeURIComponent(rawName).replace(/%2F/gi, "/");
  const lower = rawName.toLowerCase();

  // Compatibility fallback: preserve proven v5 filename heuristics when no
  // reliable direct file-path is available from the browser file picker.
  if (lower.startsWith("sim-10321-") || lower.includes("10321") && lower.startsWith("sim-")) {
    return fromWorkspaceRoot(`10321 Notes/sims/${encodedName}`);
  }
  if (lower.startsWith("sim-10031-") || lower.includes("10031") && lower.startsWith("sim-")) {
    return fromWorkspaceRoot(`10031 Notes/sims/${encodedName}`);
  }
  if (lower.startsWith("sim-10855-") || lower.includes("10855") && lower.startsWith("sim-")) {
    return fromWorkspaceRoot(`10855 Notes/sims/${encodedName}`);
  }
  if (lower.includes("10321") || lower.startsWith("lecture2") || lower.startsWith("lecture3") || lower.startsWith("lecture1")) {
    return fromWorkspaceRoot(`10321 Notes/${encodedName}`);
  }
  if (lower.includes("10031")) {
    return fromWorkspaceRoot(`10031 Notes/${encodedName}`);
  }
  if (lower.includes("10855")) {
    return fromWorkspaceRoot(`10855 Notes/${encodedName}`);
  }
  if (lower.startsWith("fluid-") || lower.includes("superhydrophobic") || lower.includes("direktørkreds") || lower.includes("direktorkreds")) {
    return fromWorkspaceRoot(`InteractivePresentations/2026 Direktørkreds/sims/${encodedName}`);
  }
  if (lower.includes("undervisningsseminar") || lower.includes("cantilever") || lower.includes("graphene") || lower.includes("doublependulum") || lower.includes("bloom")) {
    return fromWorkspaceRoot(`InteractivePresentations/2026 Undervisningsseminar/sims/${encodedName}`);
  }

  // Prefer the most common relative directory already used by HTML links in
  // the current deck (non-hardcoded, deck-specific inference).
  const inferredBase = inferHtmlFileLinkBaseFromDeck();
  if (inferredBase) {
    return joinRelativeUrlPath(inferredBase, rawName);
  }

  // Generic fallback only: keep the chosen filename/path as entered.
  return rawName.replace(/\\/g, "/");
}

// Browsers hide the real path of a picked file, so "Add HTML link" normally
// falls back to the deck convention sims/<name>. That is right for deck sims,
// but wrong for a whole notes document such as 10031Notes.html, which lives in
// its own course folder next to the JS and figures it loads. Use the filename
// heuristic when it points somewhere other than a sims/ folder; deck sims keep
// the sims/<name> convention exactly as before.
function workspaceFileGuessOutsideSims(fileName) {
  const guessed = guessHtmlFileLinkUrlFromName(fileName);
  if (!guessed || guessed === String(fileName || "").trim()) {
    return "";
  }
  if (!guessed.includes("/") || /\/sims\//i.test(guessed)) {
    return "";
  }
  return guessed;
}

function inferHtmlFileLinkBaseFromDeck() {
  const assets = Object.values(state?.deck?.assets || {});
  if (!assets.length) {
    return "";
  }

  const counts = new Map();
  for (const asset of assets) {
    if (!asset || asset.kind !== "overlay-html-filelink") {
      continue;
    }
    const raw = String(asset.url || "").trim().replace(/\\/g, "/");
    if (!raw || /^(https?:|file:|data:|blob:|\/)/i.test(raw)) {
      continue;
    }
    const cut = raw.lastIndexOf("/");
    if (cut <= 0) {
      continue;
    }
    const base = raw.slice(0, cut + 1);
    counts.set(base, (counts.get(base) || 0) + 1);
  }

  let bestBase = "";
  let bestScore = -1;
  for (const [base, count] of counts.entries()) {
    const simBoost = /\/sims\/$/i.test(base) ? 3 : 0;
    const relBoost = /^(\.\.\/|\.\/)/.test(base) ? 1 : 0;
    const score = count * 10 + simBoost + relBoost;
    if (score > bestScore) {
      bestScore = score;
      bestBase = base;
    }
  }

  return bestBase;
}

function joinRelativeUrlPath(base, fileName) {
  const left = String(base || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const right = String(fileName || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!left) {
    return right;
  }
  if (!right) {
    return `${left}/`;
  }
  return `${left}/${right}`;
}

function computePresenterRelativeFromAbsolute(absoluteUrl) {
  if (!absoluteUrl || String(window?.location?.protocol || "").toLowerCase() !== "file:") {
    return "";
  }

  try {
    const target = new URL(String(absoluteUrl));
    const presenterDirUrl = new URL("./", window.location.href);
    if (target.protocol.toLowerCase() !== "file:" || presenterDirUrl.protocol.toLowerCase() !== "file:") {
      return "";
    }

    const decodePath = (p) => {
      let out = String(p || "").replace(/\\/g, "/");
      try { out = decodeURIComponent(out); } catch {}
      // file:///C:/... -> C:/... for stable Windows drive handling.
      out = out.replace(/^\/(?:[a-zA-Z]:\/)/, (m) => m.slice(1));
      return out;
    };

    const toSegments = (p) => decodePath(p).split("/").filter(Boolean);
    const fromSegs = toSegments(presenterDirUrl.pathname);
    const toSegs = toSegments(target.pathname);
    if (!fromSegs.length || !toSegs.length) {
      return "";
    }

    // Different roots/drives cannot be expressed as a safe relative file path.
    if (fromSegs[0].toLowerCase() !== toSegs[0].toLowerCase()) {
      return "";
    }

    let i = 0;
    while (i < fromSegs.length && i < toSegs.length && fromSegs[i].toLowerCase() === toSegs[i].toLowerCase()) {
      i += 1;
    }

    const up = new Array(fromSegs.length - i).fill("..");
    const down = toSegs.slice(i);
    const rel = [...up, ...down].join("/");
    return rel || "./";
  } catch {
    return "";
  }
}

// Compute a workspace-relative path from an absolute file:// URL using the
// current presenter's location as the anchor point. Returns "" when not determinable.
// This is used so saved decks store portable relative paths, not absolute machine-
// specific file:// URLs — the deck works on any machine as long as the workspace
// folder structure is preserved.
function computeWorkspaceRelativeFromAbsolute(absoluteUrl) {
  if (!absoluteUrl || String(window?.location?.protocol || "").toLowerCase() !== "file:") return "";
  try {
    const presenterHref = window.location.href;
    const presenterDir = presenterHref.substring(0, presenterHref.lastIndexOf("/") + 1);
    const workspaceRootUrl = new URL(getWorkspaceRootPrefix(), presenterDir).href;
    let fileDecoded = absoluteUrl;
    try { fileDecoded = decodeURIComponent(absoluteUrl); } catch (e) {}
    let rootDecoded = workspaceRootUrl;
    try { rootDecoded = decodeURIComponent(workspaceRootUrl); } catch (e) {}
    if (fileDecoded.toLowerCase().startsWith(rootDecoded.toLowerCase())) {
      const suffix = fileDecoded.slice(rootDecoded.length);
      return getWorkspaceRootPrefix() + suffix;
    }
  } catch (e) {}
  return "";
}

function resolveHtmlFileLinkUrl(source) {
  const raw = String(source?.url || source?.name || "").trim();
  if (!raw) {
    return "";
  }

  // Preserve web URLs exactly as entered.
  if (/^(https?:|data:|blob:)/i.test(raw)) {
    return raw;
  }

  const conventionRel = normalizeConventionRelativePath(raw);
  if (conventionRel) {
    const fromPresentationRoot = toPresentationRootAbsolute(conventionRel);
    if (fromPresentationRoot) {
      return fromPresentationRoot;
    }
    // Root unknown — return empty so caller falls back to htmlText srcdoc snapshot.
    return "";
  }

  const workspaceRelativeFromFileUrl = knownWorkspaceRelativeFromFileUrl(raw);
  if (workspaceRelativeFromFileUrl) {
    return toAbsoluteIfFileProtocol(workspaceRelativeFromFileUrl);
  }

  // Prefer workspace-relative paths over absolute local paths for portability.
  if (/^file:/i.test(raw)) {
    const asRelative = computePresenterRelativeFromAbsolute(raw)
      || computeWorkspaceRelativeFromAbsolute(raw)
      || guessHtmlFileLinkUrlFromName(String(raw.split("/").pop() || source?.name || "").trim());
    return toAbsoluteIfFileProtocol(asRelative || raw);
  }

  // Convert direct Windows/macOS/Linux local paths to workspace-relative when possible.
  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) {
    const asFileUrl = toFileUrl(raw);
    const asRelative = computePresenterRelativeFromAbsolute(asFileUrl)
      || knownWorkspaceRelativeFromFileUrl(asFileUrl)
      || computeWorkspaceRelativeFromAbsolute(asFileUrl)
      || guessHtmlFileLinkUrlFromName(String(raw.split(/[\\/]/).pop() || source?.name || "").trim());
    return toAbsoluteIfFileProtocol(asRelative || asFileUrl);
  }

  let url = raw.replace(/\\/g, "/");
  const isAbsoluteLike = /^(https?:|file:|data:|blob:|\/)/i.test(url);
  const isRelativeLike = url.startsWith("./") || url.startsWith("../");

  if (!isAbsoluteLike && !isRelativeLike) {
    const guessed = guessHtmlFileLinkUrlFromName(source?.name || url);
    if (guessed) {
      url = guessed;
    }
  }

  // Normalize legacy relative links to current deployment prefix.
  const rebasedKnown = rebaseKnownWorkspaceRelativeUrl(url);
  if (rebasedKnown) {
    url = rebasedKnown;
  }

  return toAbsoluteIfFileProtocol(url);
}

function normalizeHtmlFileLinkInput(rawValue, assetName = "") {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return "";
  }

  if (/^(https?:|data:|blob:)/i.test(raw)) {
    return raw;
  }

  const conventionRel = normalizeConventionRelativePath(raw);
  if (conventionRel) {
    return conventionRel;
  }

  if (/^file:/i.test(raw)) {
    return computePresenterRelativeFromAbsolute(raw)
      || knownWorkspaceRelativeFromFileUrl(raw)
      || computeWorkspaceRelativeFromAbsolute(raw)
      || guessHtmlFileLinkUrlFromName(String(raw.split("/").pop() || assetName || "").trim())
      || raw;
  }

  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) {
    const asFileUrl = toFileUrl(raw);
    return computePresenterRelativeFromAbsolute(asFileUrl)
      || knownWorkspaceRelativeFromFileUrl(asFileUrl)
      || computeWorkspaceRelativeFromAbsolute(asFileUrl)
      || guessHtmlFileLinkUrlFromName(String(raw.split(/[\\/]/).pop() || assetName || "").trim())
      || raw;
  }

  return raw.replace(/\\/g, "/");
}

// When running on file:// protocol, convert a relative URL to absolute using the
// presenter's location as base. This gives iframes a definite base URL so all
// relative sub-resources (images, scripts, nested sim iframes) inside the loaded
// page resolve from that file's own directory — not from the presenter's directory.
function toAbsoluteIfFileProtocol(url) {
  if (!url) return url;
  if (String(window?.location?.protocol || "").toLowerCase() !== "file:") return url;
  if (/^(https?:|file:|data:|blob:)/i.test(url)) return url;
  try {
    return new URL(url, window.location.href).href;
  } catch (e) {
    return url;
  }
}

function rebaseKnownWorkspaceRelativeUrl(url) {
  const raw = String(url || "");
  const normalized = raw.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();

  const markers = [
    "10031 notes/",
    "10321 notes/",
    "10855 notes/",
    "interactivepresentations/2026 direktørkreds/sims/",
    "interactivepresentations/2026 direktorkreds/sims/",
    "interactivepresentations/2026 undervisningsseminar/sims/",
  ];

  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      const suffix = normalized.slice(idx);
      return fromWorkspaceRoot(suffix);
    }
  }
  return "";
}

function knownWorkspaceRelativeFromFileUrl(rawUrl) {
  // Keep legacy call sites working, but resolve generically relative to the presenter.
  return computePresenterRelativeFromAbsolute(rawUrl);
}

async function remapSlides(fileList) {
  const files = Array.from(fileList || []).filter((f) => isImageFile(f));
  if (!files.length) {
    return;
  }

  files.sort((a, b) => naturalCollator.compare(a.name, b.name));

  const newSlides = [];
  for (const f of files) {
    const dataUrl = await fileToDataUrl(f);
    const assetId = uid();
    const fp = await fingerprintFromDataUrl(dataUrl);
    state.deck.assets[assetId] = {
      id: assetId,
      kind: "slide-image",
      mime: f.type || "image/jpeg",
      name: f.name,
      dataUrl,
    };
    newSlides.push({
      uid: uid(),
      name: f.name,
      slideAssetId: assetId,
      fingerprint: fp,
      fileSize: safeClampNumber(f.size, 0, Number.MAX_SAFE_INTEGER, 0),
      overlays: [],
      animationEvents: [],
      textBoxes: [],
    });
  }

  const oldSlides = state.deck.slides.map((s) => ({ ...s }));
  const used = new Set();
  const mappingRows = [];

  for (const oldSlide of oldSlides) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < newSlides.length; i++) {
      if (used.has(i)) {
        continue;
      }
      const sim = fingerprintSimilarity(oldSlide.fingerprint, newSlides[i].fingerprint);
      const nameBonus = normalizeSlideName(oldSlide.name) === normalizeSlideName(newSlides[i].name) ? 0.12 : 0;
      const sizeSim = fileSizeSimilarity(getSlideFileSize(oldSlide), getSlideFileSize(newSlides[i]));
      const score = sim + nameBonus + (sizeSim * SIZE_REMAP_WEIGHT);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const newSlide = newSlides[bestIdx];
      const accepted = bestScore >= AUTO_REMAP_THRESHOLD;
      mappingRows.push({
        oldSlide,
        newIndex: bestIdx,
        newSlide,
        score: bestScore,
        accepted,
      });
      if (accepted) {
        used.add(bestIdx);
      }
    }
  }

  const acceptedMap = mappingRows.filter((r) => r.accepted);
  for (const row of acceptedMap) {
    const target = newSlides[row.newIndex];
    target.uid = row.oldSlide.uid;
    target.overlays = row.oldSlide.overlays || [];
    target.animationEvents = JSON.parse(JSON.stringify(row.oldSlide.animationEvents || []));
    ensureSlideAnimationDefaults(target);
  }

  const orphaned = oldSlides.filter((o) => !acceptedMap.find((m) => m.oldSlide.uid === o.uid));
  state.deck.orphanedSlides = orphaned;
  state.deck.slides = newSlides;

  const previouslySelectedUid = oldSlides[state.currentSlideIndex]?.uid;
  const newSelected = state.deck.slides.findIndex((s) => s.uid === previouslySelectedUid);
  state.currentSlideIndex = newSelected >= 0 ? newSelected : 0;
  state.selectedOverlayId = null;

  const report = [];
  report.push(`Old slides: ${oldSlides.length}`);
  report.push(`New slides: ${newSlides.length}`);
  report.push(`Auto-remapped: ${acceptedMap.length}`);
  report.push(`Unresolved old slides: ${orphaned.length}`);
  report.push("");
  report.push("Top matches:");
  mappingRows
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .forEach((r) => {
      report.push(
        `${r.accepted ? "OK" : "REVIEW"} | ${r.oldSlide.name} -> ${r.newSlide.name} | score=${r.score.toFixed(3)}`
      );
    });

  state.remapHistory.push({ at: new Date().toISOString(), report: report.join("\n") });
  if (dom.remapReport) {
    dom.remapReport.textContent = report.join("\n");
  }

  touch();
  renderAll();
}

function onStageMouseDown(e) {
  state.thumbnailPanelActive = false;
  maybeCloseNotebookPenSubBarByTarget(e.target);
  if (!state.deck.slides.length) {
    return;
  }

  const stageRect = dom.stage.getBoundingClientRect();
  const target = e.target;

  if (state.mode !== "edit") {
    if (state.mode !== "present") {
      return;
    }

    const ctrlShiftInsert = isPresenterTextInsertGesture(e);
    if (ctrlShiftInsert) {
      const textTarget = target.closest(".overlay-text-editable");
      const textOverlayEl = target.closest(".overlay");

      if (textOverlayEl?.dataset?.overlayId) {
        const textSource = getOverlayTextSourceByOverlayId(textOverlayEl.dataset.overlayId);
        if (textSource && beginPresenterTextEdit(textOverlayEl.dataset.overlayId, !textTarget)) {
          setPresenterTextInsertArmed(false);
          e.preventDefault();
          return;
        }
      }

      const x = clamp((e.clientX - stageRect.left) / stageRect.width, 0, 1);
      const y = clamp((e.clientY - stageRect.top) / stageRect.height, 0, 1);
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        ensurePresenterTextDefaults();
        createTextOverlayAt(x, y, { anchorAtClick: true, stageRect });
        if (state.selectedOverlayId) {
          beginPresenterTextEdit(state.selectedOverlayId, true);
        }
        setPresenterTextInsertArmed(false);
        e.preventDefault();
        return;
      }
    }

    if (state.presenterTextEditOverlayId) {
      const activeText = target.closest(`.overlay[data-overlay-id="${state.presenterTextEditOverlayId}"] .overlay-text-editable`);
      if (activeText) {
        e.preventDefault();
        return;
      }
      endPresenterTextEdit();
      setPresenterTextInsertArmed(false);
      e.preventDefault();
      return;
    }

    const interactiveTarget = target.closest(".overlay-key-control-toggle, .overlay-controls, .overlay-write-tools, .overlay-notebook-tools, .overlay-notebook-page-nav, button, input, select, textarea, a, label");
    if (interactiveTarget) {
      return;
    }

    // Summary figures open the shared zoom modal in present mode (image / sim).
    const summaryFigPresent = target.closest(".summary-figure.has-content");
    if (summaryFigPresent) {
      openZoomForSummaryFigureEl(summaryFigPresent);
      e.preventDefault();
      return;
    }

    const overlayEl = target.closest(".overlay");
    if (!overlayEl) {
      advancePresenterSequence(1);
      e.preventDefault();
      return;
    }

    const overlayId = overlayEl.dataset.overlayId;
    const overlay = currentSlide()?.overlays.find((o) => o.id === overlayId);
    if (!overlay) {
      return;
    }

    // If an overlay is not yet visible at the current animation step,
    // clicking its future area should behave like clicking outside overlays.
    const slideForVisibility = currentSlide();
    const visibilityMap = getOverlayVisibilityMapForStep(slideForVisibility, state.animationStepIndex);
    const overlayVisibleNow = visibilityMap.get(overlay.id) !== false;
    if (!overlayVisibleNow) {
      advancePresenterSequence(1);
      e.preventDefault();
      return;
    }

    if (isNotebookPanelSource(overlay.sourceId)) {
      ensureOverlayNotebookDefaults(overlay);
      if (overlay.notebookMode === "navigate") {
        stepOverlayNotebookPage(overlay, 1, { wrap: true });
        touch();
        renderStage();
      }
      e.preventDefault();
      return;
    }

    if (isOverlayLockedInCurrentMode(overlay)) {
      return;
    }

    const r = overlayEl.getBoundingClientRect();
    const localX = e.clientX - r.left;
    const localY = e.clientY - r.top;
    const nearMoveCorner = localX >= PRESENT_CORNER_INSET_PX
      && localX <= (PRESENT_CORNER_INSET_PX + PRESENT_CORNER_HIT_PX)
      && localY >= PRESENT_CORNER_INSET_PX
      && localY <= (PRESENT_CORNER_INSET_PX + PRESENT_CORNER_HIT_PX);
    const nearResizeCorner = localX >= (r.width - PRESENT_CORNER_INSET_PX - PRESENT_CORNER_HIT_PX)
      && localX <= (r.width - PRESENT_CORNER_INSET_PX)
      && localY >= (r.height - PRESENT_CORNER_INSET_PX - PRESENT_CORNER_HIT_PX)
      && localY <= (r.height - PRESENT_CORNER_INSET_PX);
    if (!nearMoveCorner && !nearResizeCorner) {
      return;
    }

    const start = {
      x: (e.clientX - stageRect.left) / stageRect.width,
      y: (e.clientY - stageRect.top) / stageRect.height,
    };

    state.selectedOverlayId = overlay.id;

    if (nearResizeCorner) {
      state.resizeCtx = {
        overlayId: overlay.id,
        start,
        base: { w: overlay.w, h: overlay.h },
        aspectRatio: Math.max(0.0001, safeClampNumber(overlay.w / overlay.h, 0.0001, 10000, 1)),
      };
    } else {
      state.dragCtx = {
        overlayId: overlay.id,
        start,
        base: { x: overlay.x, y: overlay.y },
      };
    }

    e.preventDefault();
    return;
  }

  if (state.textToolActive && !target.closest(".overlay")) {
    const x = (e.clientX - stageRect.left) / stageRect.width;
    const y = (e.clientY - stageRect.top) / stageRect.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      // Drag marks out a width the way PowerPoint's text tool does; a plain
      // click uses the default width. Either way the height comes from autofit.
      state.textDrawCtx = { x0: x, y0: y, moved: false };
    }
    e.preventDefault();
    return;
  }

  // Clicking away from the box being edited commits it and drops an empty one.
  if (state.activeTextEditOverlayId
    && !target.closest(`.overlay[data-overlay-id="${state.activeTextEditOverlayId}"]`)
    && !target.closest("#textToolbox")) {
    endTextOverlayEdit();
  }

  if (state.drawingEnabled && !target.closest(".overlay")) {
    const x = clamp((e.clientX - stageRect.left) / stageRect.width, 0, 1);
    const y = clamp((e.clientY - stageRect.top) / stageRect.height, 0, 1);
    const ghost = document.createElement("div");
    ghost.className = "draw-ghost";
    dom.stage.appendChild(ghost);
    state.drawCtx = { x0: x, y0: y, ghost };
    e.preventDefault();
    return;
  }

  // Summary-slide block: move grip / resize handle drag, and cell selection.
  const summarySlideEdit = currentSlide();
  if (isSummarySlide(summarySlideEdit)) {
    const gripEl = target.closest(".summary-move-grip");
    const resizeEl = target.closest(".summary-resize-handle");
    if (gripEl || resizeEl) {
      const rect = getSummaryRect(summarySlideEdit);
      const start = {
        x: (e.clientX - stageRect.left) / stageRect.width,
        y: (e.clientY - stageRect.top) / stageRect.height,
      };
      if (resizeEl) {
        state.summaryResizeCtx = {
          start,
          base: { w: rect.w, h: rect.h },
          aspectRatio: Math.max(0.0001, safeClampNumber(rect.w / rect.h, 0.0001, 10000, 1)),
        };
      } else {
        state.summaryDragCtx = { start, base: { x: rect.x, y: rect.y } };
      }
      e.preventDefault();
      return;
    }
    const cellEl = target.closest(".summary-cell");
    if (cellEl) {
      // Select the cell for the panel editor, unless the click is on a figure
      // button or the editable text (those handle themselves).
      if (!target.closest(".summary-text, .summary-cell-btn, button, input, select, textarea, a, label")) {
        state.summarySelectedItemId = cellEl.dataset.itemId;
        renderSummaryControls();
        renderStage();
        e.preventDefault();
      }
      return;
    }
    // Clicks on the block background stay inert (don't fall through to overlay
    // deselect), but overlay drawing above already ran, so drawing still works.
    if (target.closest(".summary-block")) {
      return;
    }
  }

  const overlayEl = target.closest(".overlay");
  if (!overlayEl) {
    state.selectedOverlayId = null;
    renderOverlayInspector();
    renderStage();
    return;
  }

  const overlayId = overlayEl.dataset.overlayId;
  const overlay = currentSlide()?.overlays.find((o) => o.id === overlayId);
  if (!overlay) {
    return;
  }

  const editInteractiveTarget = target.closest(".overlay-key-control-toggle, .overlay-controls, .overlay-write-tools, .overlay-notebook-tools, .overlay-notebook-page-nav, button, input, select, textarea, a, label");
  if (editInteractiveTarget) {
    return;
  }

  // The move grip is an explicit drag handle on a text box: it always moves,
  // never places a caret.
  const textGrip = target.closest(".text-overlay-grip");

  if (!textGrip && target.closest(".overlay-text-editable")) {
    const r = overlayEl.getBoundingClientRect();
    const localX = e.clientX - r.left;
    const localY = e.clientY - r.top;
    const edgePx = TEXT_BOX_EDGE_GRAB_PX;
    const nearEdge = localX <= edgePx
      || localY <= edgePx
      || localX >= (r.width - edgePx)
      || localY >= (r.height - edgePx);

    // Interior click edits text. Edge band, the grip, or Ctrl/Cmd drag moves it.
    if (!(e.ctrlKey || e.metaKey || nearEdge)) {
      state.selectedOverlayId = overlay.id;
      state.activeTextEditOverlayId = overlay.id;
      renderOverlayInspector(false);
      syncTextToolFromSelectedOverlaySource();
      return;
    }
    // Moving the box means we are done typing in it.
    if (state.activeTextEditOverlayId === overlay.id) {
      commitActiveTextEditor();
    }
  }

  state.selectedOverlayId = overlay.id;
  renderOverlayInspector();
  renderStage();

  if (isOverlayLockedInCurrentMode(overlay)) {
    return;
  }

  const handle = target.closest(".resize-handle");
  const start = {
    x: (e.clientX - stageRect.left) / stageRect.width,
    y: (e.clientY - stageRect.top) / stageRect.height,
  };

  if (handle) {
    state.resizeCtx = {
      overlayId: overlay.id,
      start,
      base: { w: overlay.w, h: overlay.h },
      aspectRatio: Math.max(0.0001, safeClampNumber(overlay.w / overlay.h, 0.0001, 10000, 1)),
    };
    e.preventDefault();
    return;
  }

  if (target.closest(".overlay-controls")) {
    return;
  }

  state.dragCtx = {
    overlayId: overlay.id,
    start,
    base: { x: overlay.x, y: overlay.y },
  };
  e.preventDefault();
}

function onWindowMouseMove(e) {
  if (!state.deck.slides.length) {
    return;
  }

  const stageRect = dom.stage.getBoundingClientRect();
  const px = clamp((e.clientX - stageRect.left) / stageRect.width, 0, 1);
  const py = clamp((e.clientY - stageRect.top) / stageRect.height, 0, 1);

  if (state.summaryDragCtx) {
    const slide = currentSlide();
    if (isSummarySlide(slide)) {
      const rect = getSummaryRect(slide);
      const nx = clamp(state.summaryDragCtx.base.x + (px - state.summaryDragCtx.start.x), 0, 1 - rect.w);
      const ny = clamp(state.summaryDragCtx.base.y + (py - state.summaryDragCtx.start.y), 0, 1 - rect.h);
      slide.summaryRect = { x: nx, y: ny, w: rect.w, h: rect.h };
      renderStage();
    }
    return;
  }

  if (state.summaryResizeCtx) {
    const slide = currentSlide();
    if (isSummarySlide(slide)) {
      const rect = getSummaryRect(slide);
      const minSize = 0.15;
      const maxW = 1 - rect.x;
      const maxH = 1 - rect.y;
      const rawW = state.summaryResizeCtx.base.w + (px - state.summaryResizeCtx.start.x);
      const rawH = state.summaryResizeCtx.base.h + (py - state.summaryResizeCtx.start.y);
      let nextW;
      let nextH;
      if (!e.shiftKey) {
        nextW = clamp(rawW, minSize, maxW);
        nextH = clamp(rawH, minSize, maxH);
      } else {
        const aspect = Math.max(0.0001, safeClampNumber(state.summaryResizeCtx.aspectRatio, 0.0001, 10000, 1));
        const widthDriven = Math.abs(rawW - state.summaryResizeCtx.base.w) >= Math.abs(rawH - state.summaryResizeCtx.base.h);
        if (widthDriven) {
          nextW = clamp(rawW, minSize, maxW);
          nextH = clamp(nextW / aspect, minSize, maxH);
        } else {
          nextH = clamp(rawH, minSize, maxH);
          nextW = clamp(nextH * aspect, minSize, maxW);
        }
      }
      slide.summaryRect = { x: rect.x, y: rect.y, w: nextW, h: nextH };
      renderStage();
    }
    return;
  }

  if (state.textDrawCtx) {
    const rect = normalizeRect(state.textDrawCtx.x0, state.textDrawCtx.y0, px, py);
    if (rect.w > 0.01) {
      if (!state.textDrawCtx.ghost) {
        const ghost = document.createElement("div");
        ghost.className = "draw-ghost text-draw-ghost";
        dom.stage.appendChild(ghost);
        state.textDrawCtx.ghost = ghost;
      }
      applyRectStyle(state.textDrawCtx.ghost, rect);
      state.textDrawCtx.currentRect = rect;
      state.textDrawCtx.moved = true;
    }
    return;
  }

  if (state.drawCtx) {
    const { x0, y0, ghost } = state.drawCtx;
    const rect = normalizeRect(x0, y0, px, py);
    applyRectStyle(ghost, rect);
    state.drawCtx.currentRect = rect;
    return;
  }

  if (state.dragCtx) {
    const overlay = findOverlay(state.dragCtx.overlayId);
    if (!overlay) {
      return;
    }
    overlay.x = clamp(state.dragCtx.base.x + (px - state.dragCtx.start.x), 0, 1 - overlay.w);
    overlay.y = clamp(state.dragCtx.base.y + (py - state.dragCtx.start.y), 0, 1 - overlay.h);
    renderStage();
    renderOverlayInspector(false);
    return;
  }

  if (state.resizeCtx) {
    const overlay = findOverlay(state.resizeCtx.overlayId);
    if (!overlay) {
      return;
    }
    const rawW = state.resizeCtx.base.w + (px - state.resizeCtx.start.x);
    const rawH = state.resizeCtx.base.h + (py - state.resizeCtx.start.y);
    const minSize = 0.02;
    const maxW = 1 - overlay.x;
    const maxH = 1 - overlay.y;

    if (!e.shiftKey) {
      overlay.w = clamp(rawW, minSize, maxW);
      overlay.h = clamp(rawH, minSize, maxH);
    } else {
      const aspect = Math.max(0.0001, safeClampNumber(state.resizeCtx.aspectRatio, 0.0001, 10000, 1));
      const widthDriven = Math.abs(rawW - state.resizeCtx.base.w) >= Math.abs(rawH - state.resizeCtx.base.h);

      let nextW;
      let nextH;
      if (widthDriven) {
        nextW = clamp(rawW, minSize, maxW);
        nextH = nextW / aspect;
      } else {
        nextH = clamp(rawH, minSize, maxH);
        nextW = nextH * aspect;
      }

      if (nextW > maxW) {
        nextW = maxW;
        nextH = nextW / aspect;
      }
      if (nextH > maxH) {
        nextH = maxH;
        nextW = nextH * aspect;
      }
      if (nextW < minSize) {
        nextW = minSize;
        nextH = nextW / aspect;
      }
      if (nextH < minSize) {
        nextH = minSize;
        nextW = nextH * aspect;
      }

      if (nextW > maxW) {
        nextW = maxW;
        nextH = nextW / aspect;
      }
      if (nextH > maxH) {
        nextH = maxH;
        nextW = nextH * aspect;
      }

      overlay.w = nextW;
      overlay.h = nextH;
    }
    renderStage();
    renderOverlayInspector(false);
  }
}

function onWindowMouseUp() {
  if (state.textDrawCtx) {
    const ctx = state.textDrawCtx;
    state.textDrawCtx = null;
    ctx.ghost?.remove();
    const rect = ctx.currentRect;
    // Disarm first: the new box is rendered inside createTextOverlayAt, and it
    // is only made editable when the tool is no longer armed. One box per
    // arming also means a stray click never spawns another.
    state.textToolActive = false;
    dom.textToolBtn?.classList.remove("active");
    dom.ftTextBtn?.classList.remove("active");
    document.body.classList.remove("text-tool-active");
    if (ctx.moved && rect && rect.w > 0.03) {
      createTextOverlayAt(rect.x + rect.w / 2, rect.y + rect.h / 2, { width: rect.w });
    } else {
      createTextOverlayAt(ctx.x0, ctx.y0, { anchorAtClick: true });
    }
    updateTextToolboxVisibility();
    dom.modeHint.textContent = "Text box added. Type now; Esc leaves the box, its grip or border moves it.";
    return;
  }

  if (state.drawCtx) {
    const { ghost, currentRect } = state.drawCtx;
    ghost.remove();
    state.drawCtx = null;

    const { x: left, y: top, w: width, h: height } = currentRect || { x: 0, y: 0, w: 0, h: 0 };

    if (width > 0.02 && height > 0.02) {
      const slide = currentSlide();
      const zMax = slide.overlays.reduce((m, o) => Math.max(m, o.zIndex), 1);
      const o = createOverlay({ x: left, y: top, w: width, h: height });
      o.zIndex = zMax + 1;
      slide.overlays.push(o);
      state.selectedOverlayId = o.id;
      // Auto-exit draw mode so the new overlay can immediately be selected/dragged
      state.drawingEnabled = false;
      dom.drawRectBtn.classList.remove("active");
      dom.modeHint.textContent = "Edit mode: draw rectangle then set source.";
      touch();
      renderAll();
    }
  }

  if (state.dragCtx || state.resizeCtx) {
    state.dragCtx = null;
    state.resizeCtx = null;
    touch();
    renderAll();
  }

  if (state.summaryDragCtx || state.summaryResizeCtx) {
    state.summaryDragCtx = null;
    state.summaryResizeCtx = null;
    touch();
    renderAll();
  }
}

// The mouse wheel no longer moves sliders (2026-10-19): scrolling a panel moved whatever slider was
// under the pointer, or the last one hovered even with the pointer elsewhere. Sliders are dragged,
// clicked or set with the arrow keys. What is left here is Ctrl+wheel = text size while editing text.
function onWindowWheelTextSize(e) {
  if (isPointerOverSimFrame(e.clientX, e.clientY)) {
    return;
  }

  if (state.mode === "present" && state.presenterTextEditOverlayId) {
    const target = e.target;
    const withinEditingOverlay = target instanceof Element
      && !!target.closest(`.overlay[data-overlay-id="${state.presenterTextEditOverlayId}"] .overlay-text-editable`);
    const activeWithinEditingOverlay = document.activeElement instanceof Element
      && !!document.activeElement.closest(`.overlay[data-overlay-id="${state.presenterTextEditOverlayId}"] .overlay-text-editable`);

    // Ctrl+wheel resizes the text, plain wheel is left alone so a long note can
    // still be scrolled. The old build hijacked the bare wheel and stepped one
    // pixel at a time inside a 9-24 range.
    if ((withinEditingOverlay || activeWithinEditingOverlay) && (e.ctrlKey || e.metaKey)) {
      const source = getOverlayTextSourceByOverlayId(state.presenterTextEditOverlayId);
      if (source) {
        const direction = e.deltaY < 0 ? 1 : -1;
        const nextSize = stepTextFontSize(source.fontSize, direction);
        if (nextSize !== normalizeTextFontSize(source.fontSize)) {
          state.currentTextSize = nextSize;
          applyTextStyle("size", nextSize);
          focusPresenterTextOverlay(state.presenterTextEditOverlayId, false);
        }
        e.preventDefault();
        return;
      }
    }
  }
}

function isPointerOverSimFrame(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return false;
  }

  const el = document.elementFromPoint(clientX, clientY);
  if (!(el instanceof Element)) {
    return false;
  }

  // Keep wheel interactions available to embedded HTML content/sims.
  return !!el.closest("iframe.overlay-content, object.overlay-content, #zoomViewport iframe, #zoomViewport object");
}

function applyRectStyle(el, rect) {
  el.style.left = `${rect.x * 100}%`;
  el.style.top = `${rect.y * 100}%`;
  el.style.width = `${rect.w * 100}%`;
  el.style.height = `${rect.h * 100}%`;
}

function normalizeRect(x0, y0, x1, y1) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  return { x, y, w, h };
}

function updateSelectedOverlay(mutator) {
  const slide = currentSlide();
  if (!slide || !state.selectedOverlayId) {
    return;
  }
  const overlay = slide.overlays.find((o) => o.id === state.selectedOverlayId);
  if (!overlay) {
    return;
  }
  mutator(overlay, slide);
  touch();
  renderStage();
  renderOverlayInspector(false);
}

function findOverlay(overlayId) {
  const slide = currentSlide();
  return slide?.overlays.find((o) => o.id === overlayId);
}

function currentSlide() {
  return state.deck.slides[state.currentSlideIndex] || null;
}

function gotoSlide(index) {
  clearAutoplayTimer();
  // Clear presenter spray immediately when the active slide changes.
  resetPresenterHighlighterRuntime({ dropPoints: true });
  state.showPresenterEndScreen = false;
  if (!state.deck.slides.length) {
    state.currentSlideIndex = 0;
    state.keyControlOverlayId = null;
    state.animationStepIndex = -1;
    renderAll();
    return;
  }
  state.currentSlideIndex = clamp(index, 0, state.deck.slides.length - 1);
  state.selectedOverlayId = null;
  state.keyControlOverlayId = null;
  state.animationStepIndex = -1;
  state.summaryRevealCount = 0;
  renderAll();
  scheduleAnimationAutoplay();
  queueEmbeddedResizeKick();
}

function moveSlideDown(index) {
  if (index < 0 || index >= state.deck.slides.length - 1) {
    return;
  }
  const slide = state.deck.slides[index];
  state.deck.slides.splice(index, 1);
  state.deck.slides.splice(index + 1, 0, slide);
  state.currentSlideIndex = index + 1;
  state.selectedOverlayId = null;
  touch();
  renderAll();
}

function moveSlideUp(index) {
  if (index <= 0 || index >= state.deck.slides.length) {
    return;
  }
  const slide = state.deck.slides[index];
  state.deck.slides.splice(index, 1);
  state.deck.slides.splice(index - 1, 0, slide);
  state.currentSlideIndex = index - 1;
  state.selectedOverlayId = null;
  touch();
  renderAll();
}

// ─── Shared slide mutation helpers ─────────────────────────────────────────
function deleteSlideAtIndex(index, { skipConfirm = false } = {}) {
  const slide = state.deck.slides[index];
  if (!slide) return;
  if (!skipConfirm && !confirm(`Delete slide ${index + 1}: "${slide.name}"?`)) return;
  for (const overlay of slide.overlays || []) {
    removeNotesForOverlay(overlay);
  }
  state.deck.slides.splice(index, 1);
  if (state.currentSlideIndex >= state.deck.slides.length) {
    state.currentSlideIndex = Math.max(0, state.deck.slides.length - 1);
  }
  state.selectedOverlayId = null;
  touch();
  renderAll();
}

// Toggle a slide's "hidden" flag. Hidden slides stay fully editable and keep
// their place in the deck, but presenter navigation skips over them.
function toggleSlideHidden(index) {
  const slide = state.deck.slides[index];
  if (!slide) return;
  slide.hidden = !slide.hidden;
  touch();
  renderSlideList();
  renderThumbnailGrid();
}

function duplicateSlideAtIndex(index) {
  const slide = state.deck.slides[index];
  if (!slide) return;
  const clone = JSON.parse(JSON.stringify(slide));
  clone.uid = uid();
  clone.overlays = clone.overlays.map((o) => {
    const c = { ...o, id: uid() };
    applyOverlaySourceBehaviorDefaults(c);
    ensureOverlayNotebookDefaults(c);
    if (isNotesBoardSource(c.sourceId)) {
      ensureDeckNotesStore();
      const newKey = uid();
      const oldRecord = state.deck.notes?.[o.notesKey];
      state.deck.notes[newKey] = {
        doc: String(oldRecord?.doc || DEFAULT_NOTES_DOC),
        settings: normalizeNotesSettings(oldRecord?.settings),
        updatedAt: new Date().toISOString(),
      };
      c.notesKey = newKey;
    }
    return c;
  });
  clone.name = slide.name + " (copy)";
  state.deck.slides.splice(index + 1, 0, clone);
  state.currentSlideIndex = index + 1;
  state.selectedOverlayId = null;
  state.animationStepIndex = -1;
  touch();
  renderAll();
}

function addBlankSlideAfterIndex(index) {
  const newSlide = createSlide("", "Blank slide", "", 0);
  const insertAt = Math.min(index + 1, state.deck.slides.length);
  state.deck.slides.splice(insertAt, 0, newSlide);
  state.currentSlideIndex = insertAt;
  state.selectedOverlayId = null;
  state.animationStepIndex = -1;
  touch();
  renderAll();
}

// Insert a new section-divider slide right after the given index and select it.
function addSectionDividerAfterIndex(index) {
  const divider = createSectionDividerSlide("New section");
  // Inherit the deck's shared section style so all sections stay consistent.
  const existing = getSectionDividerSlides()[0];
  if (existing) divider.sectionStyle = normalizeSectionStyle(existing.sectionStyle);
  const insertAt = clamp(index + 1, 0, state.deck.slides.length);
  state.deck.slides.splice(insertAt, 0, divider);
  state.currentSlideIndex = insertAt;
  state.selectedOverlayId = null;
  state.animationStepIndex = -1;
  touch();
  renderAll();
}

// Toggle the current slide's section-divider status on/off.
function convertCurrentSlideToRegular() {
  const slide = currentSlide();
  if (!isSectionDivider(slide)) return;
  delete slide.type;
  delete slide.titleLong;
  delete slide.titleShort;
  delete slide.sectionStyle;
  delete slide.sectionRole;
  slide.name = slide.name || "Slide";
  touch();
  renderAll();
}

// Insert a new summary slide right after the given index and select it.
function addSummarySlideAfterIndex(index) {
  const slide = createSummarySlide();
  // Inherit the design of an existing summary slide so a deck stays consistent.
  const existing = state.deck.slides.find(isSummarySlide);
  if (existing) {
    slide.summaryStyle = normalizeSummaryStyle(existing.summaryStyle);
    slide.summaryLayout = normalizeSummaryLayout(existing.summaryLayout);
  }
  const insertAt = clamp(index + 1, 0, state.deck.slides.length);
  state.deck.slides.splice(insertAt, 0, slide);
  state.currentSlideIndex = insertAt;
  state.selectedOverlayId = null;
  state.summarySelectedItemId = slide.summaryItems[0]?.id || null;
  state.animationStepIndex = -1;
  touch();
  renderAll();
}

// Turn the current summary slide back into a normal slide.
function convertSummaryToRegular() {
  const slide = currentSlide();
  if (!isSummarySlide(slide)) return;
  delete slide.type;
  delete slide.summaryTitle;
  delete slide.summaryEyebrow;
  delete slide.summaryStyle;
  delete slide.summaryLayout;
  delete slide.summaryItems;
  delete slide.summaryRect;
  delete slide.summaryImageZoom;
  delete slide.summaryTextZoom;
  slide.name = slide.name || "Slide";
  touch();
  renderAll();
}

// Insert a new title-page slide right after the given index and select it.
function addTitleSlideAfterIndex(index) {
  const slide = createTitleSlide();
  // Inherit the style/variant of any existing title-page so a deck stays
  // consistent (title-page style is a deck-wide choice, like section style).
  const existing = state.deck.slides.find(isTitleSlide);
  if (existing) {
    slide.titleStyle = normalizeTitleStyle(existing.titleStyle);
    slide.titleVariant = normalizeTitleVariant(existing.titleVariant);
  }
  // Default a new title's main text from the deck title, if any.
  const deckTitle = (state.deck?.meta?.title || "").trim();
  if (deckTitle) slide.titleMain = deckTitle;
  const insertAt = clamp(index + 1, 0, state.deck.slides.length);
  state.deck.slides.splice(insertAt, 0, slide);
  state.currentSlideIndex = insertAt;
  state.selectedOverlayId = null;
  state.animationStepIndex = -1;
  touch();
  renderAll();
}

// Turn the current title-page slide back into a normal slide.
function convertTitleToRegular() {
  const slide = currentSlide();
  if (!isTitleSlide(slide)) return;
  delete slide.type;
  delete slide.titleMain;
  delete slide.titleSubtitle;
  delete slide.titlePresenters;
  delete slide.titleEvent;
  delete slide.titleStyle;
  delete slide.titleVariant;
  delete slide.titleLogoVisible;
  slide.name = slide.name || "Slide";
  touch();
  renderAll();
}

// ─── moveSlide helper used by thumbnail DnD ──────────────────────────────────
function moveSlide(fromIndex, gapIndex) {
  const n = state.deck.slides.length;
  if (n < 2 || fromIndex === gapIndex) return;
  fromIndex = clamp(fromIndex, 0, n - 1);
  gapIndex  = clamp(gapIndex, 0, n);
  const [slide] = state.deck.slides.splice(fromIndex, 1);
  // Gap indices are defined against the original slide order.
  // If the slide originated before the gap, the insertion point shifts left by one.
  const insertAt = gapIndex > fromIndex ? gapIndex - 1 : gapIndex;
  state.deck.slides.splice(insertAt, 0, slide);
  state.currentSlideIndex = insertAt;
  state.selectedOverlayId = null;
  touch();
  renderAll();
}

// ─── Thumbnail grid ───────────────────────────────────────────────────────────
// ─── Thumbnail section collapse (view-only state) ───────────────────────────
function ensureCollapsedSectionSet() {
  if (!(state.collapsedThumbSections instanceof Set)) {
    state.collapsedThumbSections = new Set();
  }
  return state.collapsedThumbSections;
}
// A section is keyed by its divider slide's uid; the leading ungrouped block
// uses a fixed key.
function thumbSectionKey(dividerSlide) {
  return isSectionDivider(dividerSlide) ? ("sec:" + dividerSlide.uid) : "__unsectioned__";
}
function isThumbSectionCollapsed(key) {
  return ensureCollapsedSectionSet().has(key);
}
function toggleThumbSectionCollapsed(key) {
  const set = ensureCollapsedSectionSet();
  if (set.has(key)) set.delete(key); else set.add(key);
  // Keep the sidebar Slides list and the thumbnail strip in sync.
  renderThumbnailGrid();
  renderSlideList();
}

function renderThumbnailGrid() {
  if (!dom.thumbnailGridContainer) return;
  const container = dom.thumbnailGridContainer;
  container.innerHTML = "";

  const refW = state.deck.settings?.referenceWidth  || 960;
  const refH = state.deck.settings?.referenceHeight || 640;
  const THUMB_W = 152;
  const THUMB_H = Math.round(THUMB_W * refH / refW);
  const scale   = THUMB_W / refW;
  const htmlTagDisplayFontPx = 13;
  const htmlTagFontPx = htmlTagDisplayFontPx / Math.max(0.0001, scale);
  const htmlTagPadPx = 3 / Math.max(0.0001, scale);
  const htmlTagInsetPx = 4 / Math.max(0.0001, scale);
  const htmlShellBorderPx = 1.8 / Math.max(0.0001, scale);

  // Group thumbnails by section: each block starts with a section-divider slide
  // (or a leading block for slides before the first divider) and is followed by
  // the slides in that section. A deck with no dividers renders as one plain
  // block with no header — visually identical to the classic flat grid.
  const deckHasSections = state.deck.slides.some(isSectionDivider);

  // Precompute how many slides fall in each section block (keyed by the block's
  // starting slide index) so headers can show a count.
  const sizeByStart = {};
  {
    let curStart = null;
    state.deck.slides.forEach((slide, i) => {
      if (isSectionDivider(slide) || curStart === null) {
        curStart = i;
        sizeByStart[curStart] = 0;
      }
      sizeByStart[curStart]++;
    });
  }

  let currentSectionItems = null;
  let currentSectionCollapsed = false;
  const startSectionBlock = (labelText, kind, key, size) => {
    const collapsible = kind !== "plain";
    const collapsed = collapsible && isThumbSectionCollapsed(key);
    currentSectionCollapsed = collapsed;

    const block = document.createElement("div");
    block.className = "thumb-section-block is-" + kind + (collapsed ? " is-collapsed" : "");
    if (labelText || collapsible) {
      const header = document.createElement("div");
      header.className = "thumb-section-header" + (collapsible ? " is-collapsible" : "");
      if (collapsible) {
        const caret = document.createElement("span");
        caret.className = "thumb-section-caret";
        caret.textContent = collapsed ? "▸" : "▾";
        header.appendChild(caret);
      }
      const lbl = document.createElement("span");
      lbl.className = "thumb-section-header-label";
      lbl.textContent = labelText || "Section";
      header.appendChild(lbl);
      const count = document.createElement("span");
      count.className = "thumb-section-count";
      count.textContent = `${size} ${size === 1 ? "slide" : "slides"}`;
      header.appendChild(count);
      if (collapsible) {
        header.title = "Double-click to collapse / expand this section";
        header.addEventListener("dblclick", (e) => {
          e.preventDefault();
          toggleThumbSectionCollapsed(key);
        });
      }
      block.appendChild(header);
    }
    const items = document.createElement("div");
    items.className = "thumb-section-items";
    block.appendChild(items);
    container.appendChild(block);
    currentSectionItems = items;
  };

  state.deck.slides.forEach((slide, i) => {
    if (isSectionDivider(slide)) {
      startSectionBlock(sectionShortLabel(slide), "section", thumbSectionKey(slide), sizeByStart[i] || 1);
    } else if (currentSectionItems === null) {
      startSectionBlock(deckHasSections ? "Unsectioned" : "", deckHasSections ? "unsectioned" : "plain", "__unsectioned__", sizeByStart[i] || 1);
    }

    // Collapsed sections render only their header — skip their thumbnails.
    if (currentSectionCollapsed) return;

    const item = document.createElement("div");
    item.className = "thumbnail-item";
    item.dataset.slideIndex = String(i);
    if (isSectionDivider(slide)) item.classList.add("is-section-divider");
    if (isSummarySlide(slide)) item.classList.add("is-summary");
    if (slide.hidden) item.classList.add("thumb-hidden");
    item.style.width  = THUMB_W + "px";
    item.style.height = THUMB_H + "px";
    if (i === state.currentSlideIndex)                             item.classList.add("active");
    if (state.thumbDragCtx?.fromIndex   === i)                     item.classList.add("drag-source");

    // ── scaled-down miniature of the slide ──────────────────────────────
    const inner = document.createElement("div");
    inner.className = "thumb-inner-stage";
    inner.style.width           = refW + "px";
    inner.style.height          = refH + "px";
    inner.style.transform       = `scale(${scale})`;
    inner.style.transformOrigin = "top left";
    inner.style.position        = "absolute";
    inner.style.top             = "0";
    inner.style.left            = "0";
    inner.style.pointerEvents   = "none";
    inner.style.overflow        = "hidden";

    // Background slide image
    const bgAsset = resolveAssetByAnyId(slide.slideAssetId);
    if (isSectionDivider(slide)) {
      // Miniature of the section-divider composition (style bg + title + image).
      inner.appendChild(buildSectionDividerThumb(slide, bgAsset, refW, refH, scale));
    } else if (isSummarySlide(slide)) {
      // Miniature of the summary composition (style bg + title + figure/text cells).
      inner.appendChild(buildSummaryThumb(slide));
    } else if (isTitleSlide(slide)) {
      // Miniature of the title-page composition (style bg + title/presenters + logo).
      inner.appendChild(buildTitleThumb(slide));
    } else if (bgAsset?.dataUrl) {
      const bg = document.createElement("img");
      bg.src = getImageDisplayUrl(bgAsset);
      bg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;";
      inner.appendChild(bg);
    } else {
      inner.style.background = "#1c2d3f";
    }

    const thumbTitle = buildSlideTitleLayer(slide);
    if (thumbTitle) inner.appendChild(thumbTitle);

    // Image overlays (sorted by z-index)
    const sorted = [...(slide.overlays || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    for (const overlay of sorted) {
      const source = resolveAssetByAnyId(overlay.sourceId);
      if (source?.kind === "overlay-image" && source.dataUrl) {
        const img = document.createElement("img");
        img.src = getImageDisplayUrl(source);
        img.style.cssText = `position:absolute;left:${overlay.x*100}%;top:${overlay.y*100}%;width:${overlay.w*100}%;height:${overlay.h*100}%;object-fit:fill;display:block;pointer-events:none;opacity:${overlay.opacity ?? 1};`;
        inner.appendChild(img);
      } else if (source?.kind === "overlay-sequence") {
        ensureOverlaySequenceSourceDefaults(source);
        const frameIndex = normalizeOverlaySequenceIndex(overlay.sequenceIndex, source.frames.length);
        const frame = source.frames[frameIndex] || source.frames[0] || null;
        if (frame?.dataUrl) {
          const img = document.createElement("img");
          img.src = getImageDisplayUrl(frame);
          img.style.cssText = `position:absolute;left:${overlay.x*100}%;top:${overlay.y*100}%;width:${overlay.w*100}%;height:${overlay.h*100}%;object-fit:fill;display:block;pointer-events:none;opacity:${overlay.opacity ?? 1};`;
          inner.appendChild(img);
        }
      } else if (
        source?.kind === "overlay-html-file"
        || source?.kind === "overlay-html-filelink"
        || source?.kind === "overlay-html-external"
        || source?.kind === "overlay-notes-board"
      ) {
        const shell = document.createElement("div");
        shell.style.cssText = `position:absolute;left:${overlay.x*100}%;top:${overlay.y*100}%;width:${overlay.w*100}%;height:${overlay.h*100}%;display:block;pointer-events:none;opacity:${overlay.opacity ?? 1};border:${htmlShellBorderPx}px dashed rgba(255,255,255,0.95);background:rgba(30,45,68,0.25);box-sizing:border-box;overflow:hidden;`;

        const rawName = String(source?.name || source?.url || "html");
        const simName = rawName.split(/[\\/]/).pop() || rawName;
        const tag = document.createElement("div");
        tag.textContent = simName;
        tag.style.cssText = `position:absolute;left:${htmlTagInsetPx}px;top:${htmlTagInsetPx}px;max-width:calc(100% - ${htmlTagInsetPx * 2}px);padding:${htmlTagPadPx}px ${htmlTagPadPx * 1.6}px;border-radius:${htmlTagPadPx}px;background:rgba(0,0,0,0.62);color:#fff;font:600 ${htmlTagFontPx}px/1.2 Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;

        shell.appendChild(tag);
        inner.appendChild(shell);
      }
    }

    // Text boxes
    for (const tb of (slide.textBoxes || [])) {
      const tel = document.createElement("div");
      tel.style.cssText = `position:absolute;left:${tb.x*100}%;top:${tb.y*100}%;width:${tb.w*100}%;overflow:hidden;white-space:pre-wrap;word-break:break-word;pointer-events:none;`;
      tel.style.fontFamily = tb.font  || "Arial, sans-serif";
      tel.style.fontSize   = (tb.fontSize || 14) + "px";
      tel.style.fontWeight = tb.bold   ? "bold"   : "normal";
      tel.style.fontStyle  = tb.italic ? "italic" : "normal";
      tel.style.color      = tb.color  || "#000";
      if (tb.shaded) tel.style.background = "rgba(255,255,255,0.75)";
      tel.textContent = tb.content || "";
      inner.appendChild(tel);
    }

    item.appendChild(inner);

    // Slide number label
    const label = document.createElement("div");
    label.className = "thumb-index";
    label.textContent = String(i + 1);
    item.appendChild(label);

    // Hidden badge — visible at a glance without hovering the action bar.
    if (slide.hidden) {
      const badge = document.createElement("div");
      badge.className = "thumb-hidden-badge";
      badge.textContent = "🚫 Hidden";
      item.appendChild(badge);
    }

    // Action bar (edit mode only) — rename/hide/overwrite/duplicate/delete
    if (state.mode === "edit") {
      const actionBar = document.createElement("div");
      actionBar.className = "thumb-action-bar";

      const overwriteInput = document.createElement("input");
      overwriteInput.type = "file";
      overwriteInput.accept = "image/png,image/jpeg,image/gif,image/svg+xml,.png,.jpg,.jpeg,.gif,.svg";
      overwriteInput.style.display = "none";
      overwriteInput.addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const dataUrl = await fileToDataUrl(f);
        const assetId = uid();
        const fp = await fingerprintFromDataUrl(dataUrl);
        state.deck.assets[assetId] = {
          id: assetId,
          kind: "slide-image",
          mime: f.type || "image/jpeg",
          name: f.name,
          dataUrl,
        };
        slide.slideAssetId = assetId;
        // A real background image ends any white-canvas status the slide was
        // created with; leaving the flag set makes the white canvas layer cover
        // the new image.
        slide.canvasBackground = "";
        slide.fingerprint = fp;
        slide.fileSize = safeClampNumber(f.size, 0, Number.MAX_SAFE_INTEGER, 0);
        slide.name = f.name;
        e.target.value = "";
        touch();
        // The ⟳ button deliberately does not select the slide (its pointerdown is
        // swallowed so the click cannot start a thumbnail drag), so without this
        // the new image would appear in the thumbnail while the stage kept
        // showing whichever slide was current.
        const slideIndex = state.deck.slides.indexOf(slide);
      if (slideIndex >= 0) {
        gotoSlide(slideIndex);
      } else {
        renderAll();
      }
      });

      const thumbRenameBtn = document.createElement("button");
      thumbRenameBtn.className = "thumb-action-btn";
      thumbRenameBtn.textContent = "✏";
      thumbRenameBtn.title = "Rename slide";
      thumbRenameBtn.dataset.tooltip = "Rename slide";
      thumbRenameBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
      thumbRenameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const newName = prompt("Rename slide:", slide.name);
        if (newName === null) return;
        const trimmed = newName.trim();
        if (!trimmed) return;
        slide.name = trimmed;
        touch();
        renderSlideList();
      });

      const thumbHideBtn = document.createElement("button");
      thumbHideBtn.className = "thumb-action-btn thumb-action-hide" + (slide.hidden ? " is-hidden" : "");
      thumbHideBtn.textContent = slide.hidden ? "🚫" : "👁";
      thumbHideBtn.title = slide.hidden ? "Slide hidden — click to show" : "Hide slide during presentation";
      thumbHideBtn.dataset.tooltip = thumbHideBtn.title;
      thumbHideBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
      thumbHideBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSlideHidden(i); });

      const thumbOverwriteBtn = document.createElement("button");
      thumbOverwriteBtn.className = "thumb-action-btn";
      thumbOverwriteBtn.textContent = "⟳";
      thumbOverwriteBtn.title = "Overwrite background image";
      thumbOverwriteBtn.dataset.tooltip = "Overwrite background image";
      thumbOverwriteBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
      thumbOverwriteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm(`Overwrite background image for slide ${i + 1}: \"${slide.name}\"?`)) return;
        overwriteInput.click();
      });

      const thumbDupBtn = document.createElement("button");
      thumbDupBtn.className = "thumb-action-btn";
      thumbDupBtn.textContent = "+";
      thumbDupBtn.title = "Duplicate slide (Ctrl+D)";
      thumbDupBtn.dataset.tooltip = "Duplicate slide (Ctrl+D)";
      thumbDupBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
      thumbDupBtn.addEventListener("click", (e) => { e.stopPropagation(); duplicateSlideAtIndex(i); });

      const thumbDelBtn = document.createElement("button");
      thumbDelBtn.className = "thumb-action-btn thumb-action-delete";
      thumbDelBtn.textContent = "🗑";
      thumbDelBtn.title = "Delete slide (Backspace)";
      thumbDelBtn.dataset.tooltip = "Delete slide (Backspace)";
      thumbDelBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
      thumbDelBtn.addEventListener("click", (e) => { e.stopPropagation(); gotoSlide(i); deleteSlideAtIndex(i); });

      actionBar.appendChild(thumbRenameBtn);
      if (slideSupportsTitle(slide)) {
        const titleOn = slide.slideTitleOn === true;
        const thumbTitleBtn = document.createElement("button");
        thumbTitleBtn.className = "thumb-action-btn thumb-action-title" + (titleOn ? " is-on" : "");
        thumbTitleBtn.textContent = "T";
        thumbTitleBtn.title = titleOn ? "Title shown — click to switch it off" : "Add a title to this slide";
        thumbTitleBtn.dataset.tooltip = thumbTitleBtn.title;
        thumbTitleBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); });
        thumbTitleBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSlideTitleFromThumb(i); });
        actionBar.appendChild(thumbTitleBtn);
      }
      actionBar.appendChild(thumbHideBtn);
      actionBar.appendChild(thumbOverwriteBtn);
      actionBar.appendChild(thumbDupBtn);
      actionBar.appendChild(thumbDelBtn);
      item.appendChild(actionBar);
      item.appendChild(overwriteInput);
    }

    item.addEventListener("pointerdown", (e) => {
      state.thumbnailPanelActive = true;
      startThumbnailDrag(e, i);
    });

    (currentSectionItems || container).appendChild(item);
  });

  // Draw a dedicated insertion line between thumbnails while dragging.
  // The insert index is a flat slide-array gap; anchor it on the first VISIBLE
  // thumbnail whose slide index is >= the gap (robust to collapsed sections
  // whose thumbnails are not in the DOM).
  if (state.thumbDragCtx?.hasMoved && state.deck.slides.length) {
    const visible = [...container.querySelectorAll(".thumbnail-item")].filter((it) => {
      const r = it.getBoundingClientRect();
      return r.width || r.height;
    });
    if (visible.length) {
      const insert = state.thumbDragCtx.insertIndex;
      const cRect = container.getBoundingClientRect();
      const toLocalX = (clientX) => clientX - cRect.left + container.scrollLeft;
      const toLocalY = (clientY) => clientY - cRect.top + container.scrollTop;
      let anchor = null;
      let after = false;
      for (const it of visible) {
        if (Number(it.dataset.slideIndex) >= insert) { anchor = it; break; }
      }
      if (!anchor) { anchor = visible[visible.length - 1]; after = true; }
      const r = anchor.getBoundingClientRect();
      const dropLine = document.createElement("div");
      dropLine.className = "thumbnail-drop-line";
      dropLine.style.left = `${toLocalX(after ? r.right : r.left)}px`;
      dropLine.style.top = `${toLocalY(r.top)}px`;
      dropLine.style.height = `${r.height || THUMB_H}px`;
      container.appendChild(dropLine);
    }
  }
}

function startThumbnailDrag(e, slideIndex) {
  if (e.button !== 0) return;
  e.stopPropagation();
  state.thumbDragCtx = {
    pointerId:   e.pointerId,
    fromIndex:   slideIndex,
    insertIndex: slideIndex,
    startX:      e.clientX,
    startY:      e.clientY,
    hasMoved:    false,
  };
  e.currentTarget.setPointerCapture(e.pointerId);
}

function onThumbnailDragMove(e) {
  const ctx = state.thumbDragCtx;
  if (!ctx || e.pointerId !== ctx.pointerId) return;

  const dx = e.clientX - ctx.startX;
  const dy = e.clientY - ctx.startY;
  if (!ctx.hasMoved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;

  const wasMoving = ctx.hasMoved;
  ctx.hasMoved = true;

  // Find the insertion gap as a flat slide-array index by hit-testing the
  // VISIBLE thumbnails in row-major order and reading their data-slide-index.
  // (Collapsed sections contribute no thumbnails, so counting DOM position is
  // not reliable — we use the stored slide index instead.)
  const items = dom.thumbnailGridContainer.querySelectorAll(".thumbnail-item");
  let newInsert = state.deck.slides.length; // default: end of deck
  for (let k = 0; k < items.length; k++) {
    const r = items[k].getBoundingClientRect();
    if (!r.width && !r.height) continue; // skip hidden
    const idx = Number(items[k].dataset.slideIndex);
    if (!Number.isFinite(idx)) continue;
    if (e.clientY < r.top) {
      newInsert = idx;
      break;
    }
    if (e.clientY >= r.top && e.clientY <= r.bottom) {
      newInsert = (e.clientX < (r.left + r.width / 2)) ? idx : (idx + 1);
      if (e.clientX <= r.right) {
        break;
      }
    }
  }

  if (!wasMoving || newInsert !== ctx.insertIndex) {
    ctx.insertIndex = newInsert;
    renderThumbnailGrid();
  }
}

function onThumbnailDragEnd(e) {
  const ctx = state.thumbDragCtx;
  if (!ctx || e.pointerId !== ctx.pointerId) return;
  state.thumbDragCtx = null;
  if (ctx.hasMoved) {
    moveSlide(ctx.fromIndex, ctx.insertIndex);
  } else {
    // Simple click — navigate to the tapped slide
    gotoSlide(ctx.fromIndex);
  }
}


function renderAll() {
  const slide = currentSlide();
  if (slide) {
    ensureSlideAnimationDefaults(slide);
    state.animationStepIndex = clamp(state.animationStepIndex, -1, slide.animationEvents.length - 1);
  } else {
    state.animationStepIndex = -1;
  }
  renderDeckMeta();
  renderSlideTitleBar();
  renderSectionControls();
  renderSummaryControls();
  renderTitleControls();
  renderCreditsControls();
  renderSlideList();
  renderThumbnailGrid();
  renderSources();
  renderOverlayInspector();
  renderAnimationPanel();
  renderStage();
}

// Sync the title bar above the stage with the current slide (edit mode only;
// slides with their own built-in title hide it).
function renderSlideTitleBar() {
  if (!dom.slideTitleBar) return;
  const slide = currentSlide();
  const show = state.mode === "edit" && slideSupportsTitle(slide);
  dom.slideTitleBar.hidden = !show;
  if (!show) return;
  dom.slideTitleToggle.checked = slide.slideTitleOn === true;
  if (document.activeElement !== dom.slideTitleInput) {
    dom.slideTitleInput.value = slide.slideTitle || "";
  }
  dom.slideTitleStyleSelect.value = normalizeSlideTitleStyleSetting(state.deck.settings?.slideTitleStyle);
}

// Re-draw only what a title change touches: the stage when it is the current
// slide (a full renderAll would also reload every sim), and the thumbnails.
function refreshAfterSlideTitleChange(slide) {
  touch();
  if (slide === currentSlide()) {
    renderSlideTitleBar();
    renderStage();
  }
  renderThumbnailGrid();
}

// The thumbnail "T" button. Switching a title on that has no text yet asks for
// it; switching it off keeps the text for next time.
function toggleSlideTitleFromThumb(index) {
  const slide = state.deck.slides[index];
  if (!slideSupportsTitle(slide)) return;
  if (slide.slideTitleOn === true) {
    slide.slideTitleOn = false;
  } else {
    if (!String(slide.slideTitle || "").trim()) {
      const suggestion = String(slide.name || "").replace(/\.(png|jpe?g|gif|svg|webp)$/i, "");
      const entered = prompt(`Title for slide ${index + 1}:`, suggestion);
      if (entered === null || !entered.trim()) return;
      slide.slideTitle = entered.trim();
    }
    slide.slideTitleOn = true;
  }
  refreshAfterSlideTitleChange(slide);
}

function bindSlideTitleBar() {
  if (!dom.slideTitleBar) return;
  dom.slideTitleToggle.addEventListener("change", () => {
    const slide = currentSlide();
    if (!slideSupportsTitle(slide)) return;
    slide.slideTitleOn = dom.slideTitleToggle.checked;
    refreshAfterSlideTitleChange(slide);
    if (slide.slideTitleOn && !String(slide.slideTitle || "").trim()) dom.slideTitleInput.focus();
  });

  dom.slideTitleInput.addEventListener("input", () => {
    const slide = currentSlide();
    if (!slideSupportsTitle(slide)) return;
    slide.slideTitle = dom.slideTitleInput.value;
    touch();
    // Typing a title switches it on.
    if (slide.slideTitleOn !== true && slide.slideTitle.trim()) {
      slide.slideTitleOn = true;
      dom.slideTitleToggle.checked = true;
      renderStage();
      return;
    }
    // Otherwise update the strip in place, so sims on the slide do not reload
    // on every keystroke. Thumbnails catch up on "change".
    const layer = dom.stage.querySelector(".slide-title-layer");
    const heading = layer?.querySelector(".slide-title-text");
    if (heading) {
      const text = slide.slideTitle.trim();
      heading.textContent = text || "Slide title";
      layer.classList.toggle("is-empty", !text);
    } else if (slide.slideTitleOn === true) {
      renderStage();
    }
  });
  dom.slideTitleInput.addEventListener("change", () => renderThumbnailGrid());
  dom.slideTitleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      dom.slideTitleInput.blur();
    }
  });

  dom.slideTitleStyleSelect.addEventListener("change", () => {
    state.deck.settings = state.deck.settings || {};
    state.deck.settings.slideTitleStyle = normalizeSlideTitleStyleSetting(dom.slideTitleStyleSelect.value);
    touch();
    renderStage();
    renderThumbnailGrid();
  });
}

// Sync the section-divider editor panel, the two progress toggles and the DTU
// logo panel with the current slide / deck settings.
function renderSectionControls() {
  const slide = currentSlide();
  const isDivider = isSectionDivider(slide);

  if (dom.sectionProgressToggle) {
    dom.sectionProgressToggle.checked = state.deck.settings?.showSectionProgress !== false;
  }
  if (dom.includeFrontEndToggle) {
    dom.includeFrontEndToggle.checked = state.deck.settings?.includeFrontEndInProgress !== false;
  }
  if (dom.sectionProgressScaleRange || dom.sectionProgressScaleValue) {
    const spScale = safeClampNumber(state.deck.settings?.sectionProgressScale, 0.5, 2.5, 1);
    if (dom.sectionProgressScaleRange) dom.sectionProgressScaleRange.value = String(spScale);
    if (dom.sectionProgressScaleValue) dom.sectionProgressScaleValue.textContent = `${Math.round(spScale * 100)}%`;
  }

  if (dom.sectionDividerPanel) {
    dom.sectionDividerPanel.hidden = !isDivider;
  }
  if (isDivider) {
    normalizeSectionDividerSlide(slide);
    if (dom.sectionRoleSelect) dom.sectionRoleSelect.value = normalizeSectionRole(slide.sectionRole);
    if (dom.sectionTitleLongInput && document.activeElement !== dom.sectionTitleLongInput) {
      dom.sectionTitleLongInput.value = slide.titleLong || "";
    }
    if (dom.sectionTitleShortInput && document.activeElement !== dom.sectionTitleShortInput) {
      dom.sectionTitleShortInput.value = slide.titleShort || "";
    }
    if (dom.sectionEyebrowVisibleToggle) {
      dom.sectionEyebrowVisibleToggle.checked = slide.eyebrowVisible !== false;
    }
    if (dom.sectionEyebrowTextInput) {
      if (document.activeElement !== dom.sectionEyebrowTextInput) {
        dom.sectionEyebrowTextInput.value = slide.eyebrowText || "";
      }
      dom.sectionEyebrowTextInput.placeholder = SECTION_ROLE_EYEBROW[normalizeSectionRole(slide.sectionRole)] || "Section";
    }
    if (dom.sectionStyleSelect) dom.sectionStyleSelect.value = normalizeSectionStyle(slide.sectionStyle);
    if (dom.sectionMediaSelect) {
      const sel = dom.sectionMediaSelect;
      sel.innerHTML = "";
      const none = document.createElement("option");
      none.value = ""; none.textContent = "— None —";
      sel.appendChild(none);
      const assets = state.deck.assets || {};
      for (const asset of Object.values(assets)) {
        if (!asset || typeof asset !== "object") continue;
        const isImg = asset.dataUrl && (asset.kind === "slide-image" || asset.kind === "overlay-image");
        const isSim = isHtmlSimAsset(asset);
        if (!isImg && !isSim) continue;
        const opt = document.createElement("option");
        opt.value = asset.id;
        opt.textContent = (isSim ? "◧ sim · " : "🖼 img · ") + (asset.name || asset.id);
        sel.appendChild(opt);
      }
      sel.value = resolveDeckAssetKeyByAnyId(assets, slide.slideAssetId) || "";
    }
  }

  // DTU logo panel
  const logo = ensureDeckLogoSettings(state.deck);
  if (dom.logoEnabledCheckbox) dom.logoEnabledCheckbox.checked = logo.enabled;
  if (dom.logoColorSelect) dom.logoColorSelect.value = logo.color;
  if (dom.logoScopeSelect) dom.logoScopeSelect.value = logo.scope;
  if (dom.logoPositionSelect) dom.logoPositionSelect.value = logo.position;
  if (dom.logoScaleRange) dom.logoScaleRange.value = String(logo.scale);
  if (dom.logoScaleValue) dom.logoScaleValue.textContent = `${Math.round(logo.scale * 100)}%`;
  if (dom.logoOpacityRange) dom.logoOpacityRange.value = String(logo.opacity);
  if (dom.logoOpacityValue) dom.logoOpacityValue.textContent = `${Math.round(logo.opacity * 100)}%`;
}

function renderDeckMeta() {
  ensureDeckSettings();
  dom.deckTitleInput.value = state.deck.meta.title;
  dom.globalContentScaleInput.value = String(state.deck.settings.globalContentScale ?? 1);
  const scaleCtx = getScaleContext();
  dom.globalContentScaleValue.textContent = `Base ${Math.round(scaleCtx.base * 100)}% | Effective ${Math.round(scaleCtx.effective * 100)}%`;
  dom.scaleLockModeSelect.value = state.deck.settings.scaleLockMode;
  dom.customRefWidthInput.value = String(state.deck.settings.referenceWidth);
  dom.customRefHeightInput.value = String(state.deck.settings.referenceHeight);
  dom.customRefSizeRow.style.display = state.deck.settings.scaleLockMode === "custom" ? "flex" : "none";
  dom.scaleContextHint.textContent = `Scale preview source: ${scaleCtx.sourceLabel}; target ${Math.round(scaleCtx.stageWidth)}x${Math.round(scaleCtx.stageHeight)} px; reference ${Math.round(scaleCtx.refWidth)}x${Math.round(scaleCtx.refHeight)} px; fit ${(scaleCtx.fitRatio || 1).toFixed(3)}.`;
  if (!getPresentationRootFileUrl() && state.deck.settings.presentationRootPath) {
    state.presentationRootFileUrl = resolvePresentationRootFromSetting(state.deck.settings.presentationRootPath);
  }
  if (dom.presentationRootInput) {
    dom.presentationRootInput.value = String(state.deck.settings.presentationRootPath || "");
  }
  if (dom.presentationRootHint) {
    const root = getPresentationRootFileUrl();
    dom.presentationRootHint.textContent = root
      ? `Resolved root: ${root}`
      : "No explicit root set. sims/pdf links resolve relative to presenter file.";
  }
  if (dom.unpackedAssetsCheckbox) {
    dom.unpackedAssetsCheckbox.checked = state.deck.settings.unpackedAssets === true;
  }
  dom.slideCounter.textContent = `Slide ${state.deck.slides.length ? state.currentSlideIndex + 1 : 0} / ${state.deck.slides.length}`;
  if (dom.remapReport && !state.remapHistory.length) {
    dom.remapReport.textContent = "No remap run yet.";
  }
}

// Sync the summary-slide editor panel with the current slide.
function renderSummaryControls() {
  const slide = currentSlide();
  const isSummary = isSummarySlide(slide);
  if (dom.summaryPanel) dom.summaryPanel.hidden = !isSummary;
  if (!isSummary) return;
  normalizeSummarySlide(slide);

  // Keep a valid selected cell for the per-cell editor.
  if (!slide.summaryItems.some((it) => it.id === state.summarySelectedItemId)) {
    state.summarySelectedItemId = slide.summaryItems[0]?.id || null;
  }
  const item = slide.summaryItems.find((it) => it.id === state.summarySelectedItemId) || slide.summaryItems[0] || null;
  const itemIdx = item ? slide.summaryItems.indexOf(item) : -1;

  if (dom.summaryTitleInput && document.activeElement !== dom.summaryTitleInput) {
    dom.summaryTitleInput.value = slide.summaryTitle || "";
  }
  if (dom.summaryEyebrowInput && document.activeElement !== dom.summaryEyebrowInput) {
    dom.summaryEyebrowInput.value = slide.summaryEyebrow || "";
  }
  if (dom.summaryStyleSelect) dom.summaryStyleSelect.value = normalizeSummaryStyle(slide.summaryStyle);
  if (dom.summaryLayoutSelect) dom.summaryLayoutSelect.value = normalizeSummaryLayout(slide.summaryLayout);
  if (dom.summaryRevealSelect) dom.summaryRevealSelect.value = normalizeSummaryReveal(slide.summaryReveal);
  if (dom.summaryCellCountHint) dom.summaryCellCountHint.textContent = `${slide.summaryItems.length} / ${SUMMARY_MAX_CELLS} cells`;
  if (dom.summaryAddCellBtn) dom.summaryAddCellBtn.disabled = slide.summaryItems.length >= SUMMARY_MAX_CELLS;
  if (dom.summaryRemoveCellBtn) dom.summaryRemoveCellBtn.disabled = slide.summaryItems.length <= SUMMARY_MIN_CELLS;
  if (dom.summaryImageZoomRange) dom.summaryImageZoomRange.value = String(slide.summaryImageZoom);
  if (dom.summaryImageZoomValue) dom.summaryImageZoomValue.textContent = `${Math.round(slide.summaryImageZoom * 100)}%`;
  if (dom.summaryTextZoomRange) dom.summaryTextZoomRange.value = String(slide.summaryTextZoom);
  if (dom.summaryTextZoomValue) dom.summaryTextZoomValue.textContent = `${Math.round(slide.summaryTextZoom * 100)}%`;

  if (dom.summarySelectedCellHint) {
    dom.summarySelectedCellHint.textContent = item
      ? `Editing cell ${itemIdx + 1} of ${slide.summaryItems.length}.`
      : "Click a cell on the slide to edit it here.";
  }
  if (dom.summaryCellFigureHint) {
    const src = (item && item.assetId) ? resolveAssetByAnyId(item.assetId) : null;
    dom.summaryCellFigureHint.textContent = src
      ? (isHtmlSimAsset(src) ? `HTML figure: ${src.name || "(unnamed)"}` : `Image figure: ${src.name || "(unnamed)"}`)
      : "No figure set.";
  }
  const cellControlsDisabled = !item;
  if (dom.summaryCellImageBtn) dom.summaryCellImageBtn.disabled = cellControlsDisabled;
  if (dom.summaryCellHtmlBtn) dom.summaryCellHtmlBtn.disabled = cellControlsDisabled;
  if (dom.summaryCellClearBtn) dom.summaryCellClearBtn.disabled = cellControlsDisabled || !item.assetId;
  if (dom.summaryCellTextInput && document.activeElement !== dom.summaryCellTextInput) {
    dom.summaryCellTextInput.value = item ? (item.text || "") : "";
    dom.summaryCellTextInput.disabled = cellControlsDisabled;
  }
}

// Sync the title-page editor panel with the current slide.
function renderTitleControls() {
  const slide = currentSlide();
  const isTitle = isTitleSlide(slide);
  if (dom.titlePanel) dom.titlePanel.hidden = !isTitle;
  if (!isTitle) return;
  normalizeTitleSlide(slide);

  if (dom.titleMainInput && document.activeElement !== dom.titleMainInput) {
    dom.titleMainInput.value = slide.titleMain || "";
  }
  if (dom.titleSubtitleInput && document.activeElement !== dom.titleSubtitleInput) {
    dom.titleSubtitleInput.value = slide.titleSubtitle || "";
  }
  if (dom.titleEventInput && document.activeElement !== dom.titleEventInput) {
    dom.titleEventInput.value = slide.titleEvent || "";
  }
  if (dom.titleStyleSelect) dom.titleStyleSelect.value = normalizeTitleStyle(slide.titleStyle);
  if (dom.titleVariantSelect) dom.titleVariantSelect.value = normalizeTitleVariant(slide.titleVariant);
  if (dom.titleLogoToggle) dom.titleLogoToggle.checked = slide.titleLogoVisible !== false;

  // Presenter list — rebuild rows to match the current array.
  if (dom.titlePresentersList) {
    dom.titlePresentersList.innerHTML = "";
    slide.titlePresenters.forEach((p, idx) => {
      const row = document.createElement("div");
      row.className = "title-presenter-row";
      const nameLbl = document.createElement("label");
      nameLbl.className = "field";
      nameLbl.innerHTML = `<span>Presenter ${idx + 1} — name</span>`;
      const nameInp = document.createElement("input");
      nameInp.type = "text";
      nameInp.placeholder = "Full name";
      nameInp.value = p.name || "";
      nameInp.dataset.presenterId = p.id;
      nameInp.dataset.field = "name";
      nameLbl.appendChild(nameInp);
      row.appendChild(nameLbl);
      const affLbl = document.createElement("label");
      affLbl.className = "field";
      affLbl.innerHTML = "<span>Affiliation</span>";
      const affInp = document.createElement("input");
      affInp.type = "text";
      affInp.placeholder = "e.g. DTU Physics";
      affInp.value = p.affiliation || "";
      affInp.dataset.presenterId = p.id;
      affInp.dataset.field = "affiliation";
      affLbl.appendChild(affInp);
      row.appendChild(affLbl);
      dom.titlePresentersList.appendChild(row);
    });
  }
  if (dom.titlePresenterCountHint) {
    dom.titlePresenterCountHint.textContent = `${slide.titlePresenters.length} / ${TITLE_MAX_PRESENTERS} presenters`;
  }
  if (dom.titleAddPresenterBtn) dom.titleAddPresenterBtn.disabled = slide.titlePresenters.length >= TITLE_MAX_PRESENTERS;
  if (dom.titleRemovePresenterBtn) dom.titleRemovePresenterBtn.disabled = slide.titlePresenters.length <= TITLE_MIN_PRESENTERS;

  // Media selector — reuse the same asset list logic as the section divider.
  if (dom.titleMediaSelect) {
    const sel = dom.titleMediaSelect;
    sel.innerHTML = "";
    const none = document.createElement("option");
    none.value = ""; none.textContent = "— None —";
    sel.appendChild(none);
    const assets = state.deck.assets || {};
    for (const asset of Object.values(assets)) {
      if (!asset || typeof asset !== "object") continue;
      const isImg = asset.dataUrl && (asset.kind === "slide-image" || asset.kind === "overlay-image");
      const isSim = isHtmlSimAsset(asset);
      if (!isImg && !isSim) continue;
      const opt = document.createElement("option");
      opt.value = asset.id;
      opt.textContent = (isSim ? "◧ sim · " : "🖼 img · ") + (asset.name || asset.id);
      sel.appendChild(opt);
    }
    sel.value = resolveDeckAssetKeyByAnyId(assets, slide.slideAssetId) || "";
  }
}

function renderSlideList() {
  dom.slideList.innerHTML = "";

  // Slides in a collapsed section are hidden; the section-divider row acts as
  // the collapsible header (shared collapse state with the thumbnail strip).
  const sizeByStart = {};
  {
    let cur = null;
    state.deck.slides.forEach((slide, i) => {
      if (isSectionDivider(slide) || cur === null) { cur = i; sizeByStart[cur] = 0; }
      sizeByStart[cur]++;
    });
  }
  let currentKey = null;
  let currentCollapsed = false;

  state.deck.slides.forEach((slide, i) => {
    const isDivider = isSectionDivider(slide);
    if (isDivider) {
      currentKey = thumbSectionKey(slide);
      currentCollapsed = isThumbSectionCollapsed(currentKey);
    } else if (currentKey === null) {
      currentCollapsed = false; // leading unsectioned slides are always shown
    }
    // Hide members of a collapsed section (its divider row stays as the header).
    if (!isDivider && currentCollapsed) return;

    const sectionKey = currentKey;
    const li = document.createElement("li");
    li.className = i === state.currentSlideIndex ? "active" : "";
    if (slide.hidden) li.classList.add("slide-hidden");
    if (isDivider) {
      li.classList.add("slide-section-divider");
      if (currentCollapsed) li.classList.add("collapsed");
      li.addEventListener("dblclick", (e) => { e.preventDefault(); toggleThumbSectionCollapsed(sectionKey); });
      const caret = document.createElement("span");
      caret.className = "slide-section-caret";
      caret.textContent = currentCollapsed ? "▸" : "▾";
      caret.title = "Collapse / expand section (or double-click the row)";
      caret.addEventListener("click", (e) => { e.stopPropagation(); toggleThumbSectionCollapsed(sectionKey); });
      li.appendChild(caret);
    }

    const isSummary = isSummarySlide(slide);
    if (isSummary) li.classList.add("slide-summary");
    const isTitle = isTitleSlide(slide);
    if (isTitle) li.classList.add("slide-title");

    const label = document.createElement("span");
    label.className = "slide-label";
    label.textContent = (isDivider || isSummary || isTitle)
      ? `${i + 1}. ${slide.name}`
      : `${i + 1}. ${slide.name} (${slide.overlays.length} overlays)`;
    label.addEventListener("click", () => {
      gotoSlide(i);
    });

    // -- Duplicate (+) --
    const dupBtn = document.createElement("button");
    dupBtn.className = "slide-action-btn";
    dupBtn.textContent = "+";
    dupBtn.dataset.tooltip = "Duplicate slide (with overlays)";
    dupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      duplicateSlideAtIndex(i);
    });

    // -- Overwrite image (⟳) -- uses a hidden file input
    const overwriteInput = document.createElement("input");
    overwriteInput.type = "file";
    overwriteInput.accept = "image/png,image/jpeg,image/gif,image/svg+xml,.png,.jpg,.jpeg,.gif,.svg";
    overwriteInput.style.display = "none";
    overwriteInput.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const dataUrl = await fileToDataUrl(f);
      const assetId = uid();
      const fp = await fingerprintFromDataUrl(dataUrl);
      state.deck.assets[assetId] = {
        id: assetId,
        kind: "slide-image",
        mime: f.type || "image/jpeg",
        name: f.name,
        dataUrl,
      };
      slide.slideAssetId = assetId;
      // See the thumbnail overwrite handler: a real background image ends any
      // white-canvas status, which would otherwise paint over it.
      slide.canvasBackground = "";
      slide.fingerprint = fp;
      slide.fileSize = safeClampNumber(f.size, 0, Number.MAX_SAFE_INTEGER, 0);
      slide.name = f.name;
      e.target.value = "";
      touch();
      // Show the slide that was just changed, rather than leaving the stage on
      // whatever slide happened to be current.
      const slideIndex = state.deck.slides.indexOf(slide);
      if (slideIndex >= 0) {
        gotoSlide(slideIndex);
      } else {
        renderAll();
      }
    });

    const overwriteBtn = document.createElement("button");
    overwriteBtn.className = "slide-action-btn";
    overwriteBtn.textContent = "⟳";
    overwriteBtn.dataset.tooltip = "Overwrite slide image (keeps overlays)";
    overwriteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      overwriteInput.click();
    });

    // -- Hide / show (👁 / 🚫) -- skips the slide during presentation
    const hideBtn = document.createElement("button");
    hideBtn.className = "slide-action-btn slide-hide-btn" + (slide.hidden ? " is-hidden" : "");
    hideBtn.textContent = slide.hidden ? "🚫" : "👁";
    hideBtn.dataset.tooltip = slide.hidden
      ? "Slide hidden in presentation — click to show"
      : "Hide slide during presentation";
    hideBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSlideHidden(i);
    });

    // -- Delete (🗑) --
    const delBtn = document.createElement("button");
    delBtn.className = "slide-action-btn slide-delete-btn";
    delBtn.textContent = "🗑";
    delBtn.dataset.tooltip = "Delete this slide";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSlideAtIndex(i);
    });

    // -- Rename (✏) --
    const renameBtn = document.createElement("button");
    renameBtn.className = "slide-action-btn";
    renameBtn.textContent = "✏";
    renameBtn.dataset.tooltip = "Rename this slide";
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const newName = prompt("Rename slide:", slide.name);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) return;
      slide.name = trimmed;
      touch();
      renderSlideList();
    });

    const actions = document.createElement("span");
    actions.className = "slide-actions";
    actions.append(renameBtn, hideBtn, dupBtn, overwriteBtn, overwriteInput, delBtn);

    if (isDivider) {
      const members = Math.max(0, (sizeByStart[i] || 1) - 1);
      const count = document.createElement("span");
      count.className = "slide-section-count";
      count.textContent = `${members} ${members === 1 ? "slide" : "slides"}`;
      li.append(label, count, actions);
    } else {
      li.append(label, actions);
    }
    dom.slideList.appendChild(li);
  });
}

function renderSources() {
  dom.sourceList.innerHTML = "";
  const assets = getOverlayAssetEntries();
  assets.forEach(({ key, asset: a }) => {
    const row = document.createElement("div");
    row.className = "source-item";
    const left = document.createElement("span");
    left.textContent = `${a.name}`;
    const right = document.createElement("span");
    right.textContent = sourceTypeLabel(a.kind);

    const trashBtn = document.createElement("button");
    trashBtn.className = "source-delete-btn";
    trashBtn.textContent = "🗑";
    trashBtn.dataset.tooltip = "Remove this source from the library";
    trashBtn.addEventListener("click", () => {
      const usageCount = (state.deck.slides || []).reduce((n, slide) =>
        n + (slide.overlays || []).filter((o) => o.sourceId === key).length, 0);
      const msg = usageCount > 0
        ? `"${a.name}" is used by ${usageCount} overlay(s). Remove it anyway? Those overlays will have no source.`
        : `Remove source "${a.name}"?`;
      if (!confirm(msg)) return;
      delete state.deck.assets[key];
      touch();
      renderSources();
      renderOverlayInspector();
    });

    row.append(left, right, trashBtn);

    if (a.kind === "overlay-html-filelink") {
      const editRow = document.createElement("div");
      editRow.className = "source-item-url-edit";
      const urlInput = document.createElement("input");
      urlInput.type = "text";
      urlInput.value = a.url || a.name;
      urlInput.dataset.tooltip = "Edit path/URL for this HTML link. Use a relative path from this page (e.g. ../../10321 Notes/10321-lecture2.html) or an absolute path/URL.";
      urlInput.addEventListener("change", () => {
        const normalized = normalizeHtmlFileLinkInput(urlInput.value, a.name);
        a.url = normalized || a.url;
        a.preferSnapshot = false;
        urlInput.value = a.url;
        renderOverlayInspector(false);
        touch();
      });
      editRow.appendChild(urlInput);
      row.appendChild(editRow);
    }

    dom.sourceList.appendChild(row);
  });
}

function renderOverlayInspector(updateSelect = true) {
  const slide = currentSlide();
  const selected = slide?.overlays.find((o) => o.id === state.selectedOverlayId);
  // The text toolbox follows the selection, so a text box can be restyled by
  // selecting it — without re-arming the text tool and risking a stray box.
  updateTextToolboxVisibility();
  const options = [
    { value: "", label: "(none)" },
    { value: "__canvas__", label: "(canvas only)" },
    ...getOverlayAssetEntries().map(({ key, asset }) => ({
      // Store canonical asset-key in overlay.sourceId to survive legacy/missing asset.id decks
      value: key,
      label: `${asset.name} [${sourceTypeLabel(asset.kind)}]`,
    })),
  ];

  if (updateSelect) {
    dom.overlaySourceSelect.innerHTML = "";
    options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      dom.overlaySourceSelect.appendChild(o);
    });
  }

  const enabled = !!selected;
  for (const id of [
    "overlaySourceSelect",
    "overlayFramedCheckbox",
    "overlayShadedCheckbox",
    "overlayLockedCheckbox",
    "overlayAllowKeyControlCheckbox",
    "overlayAllowWritingCheckbox",
    "overlayOpacityRange",
    "overlayLocalScaleRange",
    "overlayLocalScaleResetBtn",
    "overlayXInput",
    "overlayYInput",
    "overlayWInput",
    "overlayHInput",
    "bringFrontBtn",
    "sendBackBtn",
  ]) {
    dom[id].disabled = !enabled;
  }

  if (!selected) {
    dom.overlaySourceSelect.value = "";
    dom.overlayFramedCheckbox.checked = true;
    dom.overlayShadedCheckbox.checked = false;
    dom.overlayLockedCheckbox.checked = false;
    dom.overlayAllowKeyControlCheckbox.checked = false;
    dom.overlayAllowWritingCheckbox.checked = false;
    dom.overlayOpacityRange.value = "1";
    dom.overlayLocalScaleRange.value = "1";
    dom.overlayLocalScaleValue.textContent = "100%";
    dom.overlayXInput.value = "";
    dom.overlayYInput.value = "";
    dom.overlayWInput.value = "";
    dom.overlayHInput.value = "";
    syncFloatingToolbarState(null);
    return;
  }

  ensureOverlayAnnotationDefaults(selected);
  const sourceValue = selected.sourceId === "__canvas__"
    ? "__canvas__"
    : (resolveAssetKey(selected.sourceId) || "");
  dom.overlaySourceSelect.value = sourceValue;
  if (selected.sourceId && selected.sourceId !== "__canvas__" && !sourceValue) {
    dom.modeHint.textContent = "Selected overlay source is missing in this deck package. Reassign a source in Overlay Editor.";
  }
  dom.overlayFramedCheckbox.checked = !!selected.framed;
  dom.overlayShadedCheckbox.checked = !!selected.shaded;
  dom.overlayLockedCheckbox.checked = !!selected.locked;
  dom.overlayAllowKeyControlCheckbox.checked = !!selected.allowKeyControl;
  if (isNotebookPanelSource(selected.sourceId)) {
    ensureOverlayNotebookDefaults(selected);
    dom.overlayAllowWritingCheckbox.checked = selected.notebookMode === "pen";
    dom.overlayAllowWritingCheckbox.title = "Notebook pen mode; uncheck to return to typing";
  } else {
    dom.overlayAllowWritingCheckbox.checked = !!selected.annotationsEnabled;
    dom.overlayAllowWritingCheckbox.title = "Enable pen annotations on this overlay";
  }

  dom.overlayOpacityRange.value = String(selected.opacity ?? 1);
  const localScale = safeClampNumber(selected.localScale, 0.25, 3, 1);
  dom.overlayLocalScaleRange.value = String(localScale);
  dom.overlayLocalScaleValue.textContent = `${Math.round(localScale * 100)}%`;
  dom.overlayXInput.value = (selected.x * 100).toFixed(2);
  dom.overlayYInput.value = (selected.y * 100).toFixed(2);
  dom.overlayWInput.value = (selected.w * 100).toFixed(2);
  dom.overlayHInput.value = (selected.h * 100).toFixed(2);
  syncFloatingToolbarState(selected);
  syncTextToolFromSelectedOverlaySource();
}

function initFloatingToolbar() {
  restoreFloatingToolbarPosition();
  updateFloatingToolbarVisibility();
  syncFloatingToolbarState(null);
}

function restoreFloatingToolbarPosition() {
  if (!dom.floatingToolbar) {
    return;
  }
  try {
    const raw = localStorage.getItem(FLOATING_TOOLBAR_POSITION_STORAGE_KEY);
    if (!raw) {
      const fallback = getDefaultFloatingToolbarPosition();
      applyFloatingToolbarPosition(fallback.x, fallback.y, { persist: false });
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      const fallback = getDefaultFloatingToolbarPosition();
      applyFloatingToolbarPosition(fallback.x, fallback.y, { persist: false });
      return;
    }
    const clamped = clampFloatingToolbarPosition(parsed.x, parsed.y);
    applyFloatingToolbarPosition(clamped.x, clamped.y, { persist: false });
  } catch {
    const fallback = getDefaultFloatingToolbarPosition();
    applyFloatingToolbarPosition(fallback.x, fallback.y, { persist: false });
  }
}

function getDefaultFloatingToolbarPosition() {
  const stageRect = dom.stage?.getBoundingClientRect?.();
  const topbarRect = document.querySelector(".topbar")?.getBoundingClientRect?.();
  const toolbarRect = dom.floatingToolbar?.getBoundingClientRect?.();
  const toolbarWidth = Math.max(320, Number(toolbarRect?.width) || 0);
  const toolbarHeight = Math.max(44, Number(toolbarRect?.height) || 0);

  if (stageRect && Number.isFinite(stageRect.left) && Number.isFinite(stageRect.top)) {
    const x = stageRect.left + ((stageRect.width - toolbarWidth) / 2);
    const minY = (topbarRect?.bottom || 0) + 6;
    const preferredY = stageRect.top - toolbarHeight - 10;
    const y = Math.max(preferredY, minY);
    return clampFloatingToolbarPosition(x, y);
  }

  const fallbackY = (topbarRect?.bottom || 0) + 8;
  const fallbackX = (window.innerWidth - toolbarWidth) / 2;
  return clampFloatingToolbarPosition(fallbackX, Math.max(16, fallbackY));
}

function clampFloatingToolbarPosition(x, y) {
  if (!dom.floatingToolbar) {
    return { x: 16, y: 16 };
  }
  const rect = dom.floatingToolbar.getBoundingClientRect();
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
  return {
    x: clamp(Number.isFinite(x) ? x : 16, margin, maxX),
    y: clamp(Number.isFinite(y) ? y : 16, margin, maxY),
  };
}

function applyFloatingToolbarPosition(x, y, { persist = true } = {}) {
  if (!dom.floatingToolbar) {
    return;
  }
  const clamped = clampFloatingToolbarPosition(x, y);
  dom.floatingToolbar.style.left = `${clamped.x}px`;
  dom.floatingToolbar.style.top = `${clamped.y}px`;
  dom.floatingToolbar.style.right = "auto";
  dom.floatingToolbar.style.bottom = "auto";
  if (!persist) {
    return;
  }
  try {
    localStorage.setItem(FLOATING_TOOLBAR_POSITION_STORAGE_KEY, JSON.stringify(clamped));
  } catch {
    // Ignore storage write failures.
  }
}

function startFloatingToolbarDrag(e) {
  if (e.button !== 0 || !dom.floatingToolbar) {
    return;
  }
  const rect = dom.floatingToolbar.getBoundingClientRect();
  applyFloatingToolbarPosition(rect.left, rect.top, { persist: false });
  state.floatingToolbarDragCtx = {
    pointerId: e.pointerId,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
  };
  dom.ftDragHandle?.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onFloatingToolbarPointerMove(e) {
  const ctx = state.floatingToolbarDragCtx;
  if (!ctx || e.pointerId !== ctx.pointerId) {
    return;
  }
  applyFloatingToolbarPosition(e.clientX - ctx.offsetX, e.clientY - ctx.offsetY, { persist: false });
  updateFloatingStyleMenuLayout();
}

function onFloatingToolbarPointerUp(e) {
  const ctx = state.floatingToolbarDragCtx;
  if (!ctx || e.pointerId !== ctx.pointerId) {
    return;
  }
  state.floatingToolbarDragCtx = null;
  dom.ftDragHandle?.releasePointerCapture?.(e.pointerId);
  if (dom.floatingToolbar) {
    const rect = dom.floatingToolbar.getBoundingClientRect();
    applyFloatingToolbarPosition(rect.left, rect.top, { persist: true });
  }
}

function toggleFloatingToolbar() {
  state.floatingToolbarHidden = !state.floatingToolbarHidden;
  updateFloatingToolbarVisibility();
}

function updateFloatingToolbarVisibility() {
  if (!dom.floatingToolbar) {
    return;
  }
  const visible = state.mode === "edit" && !state.floatingToolbarHidden;
  dom.floatingToolbar.classList.toggle("hidden", !visible);
  if (dom.floatingToolbarToggleBtn) {
    dom.floatingToolbarToggleBtn.classList.toggle("active", visible);
  }
  if (!visible && dom.ftStyleMenu) {
    dom.ftStyleMenu.classList.add("hidden");
  }
}

function updateFloatingStyleMenuLayout() {
  if (!dom.floatingToolbar || !dom.ftStyleMenu || dom.ftStyleMenu.classList.contains("hidden")) {
    return;
  }

  const toolbarRect = dom.floatingToolbar.getBoundingClientRect();
  const toggleRect = dom.ftStyleMenuToggleBtn?.getBoundingClientRect?.();
  const menuRect = dom.ftStyleMenu.getBoundingClientRect();

  if (toggleRect && Number.isFinite(toggleRect.left) && Number.isFinite(toggleRect.width)) {
    const margin = 8;
    const desiredLeftViewport = toggleRect.left + ((toggleRect.width - menuRect.width) / 2);
    const clampedLeftViewport = clamp(desiredLeftViewport, margin, Math.max(margin, window.innerWidth - menuRect.width - margin));
    const leftRelativeToToolbar = clampedLeftViewport - toolbarRect.left;
    dom.ftStyleMenu.style.left = `${Math.round(leftRelativeToToolbar)}px`;
    dom.ftStyleMenu.style.right = "auto";
  } else {
    dom.ftStyleMenu.style.left = "8px";
    dom.ftStyleMenu.style.right = "auto";
  }

  const spaceAbove = Math.max(0, toolbarRect.top);
  const spaceBelow = Math.max(0, window.innerHeight - toolbarRect.bottom);
  const nearTop = toolbarRect.top < 150;
  const nearBottom = (window.innerHeight - toolbarRect.bottom) < 150;

  let openDown = false;
  if (nearTop && !nearBottom) {
    openDown = true;
  } else if (!nearTop && nearBottom) {
    openDown = false;
  } else {
    const needed = menuRect.height + 16;
    openDown = spaceBelow >= needed || spaceBelow > spaceAbove;
  }

  dom.ftStyleMenu.classList.toggle("open-down", openDown);
}

function syncFloatingToolbarState(selectedOverlay) {
  if (!dom.floatingToolbar) {
    return;
  }
  const selected = selectedOverlay || null;
  const hasSelected = !!selected;

  for (const id of ["ftForwardBtn", "ftBackwardBtn", "ftStyleMenuToggleBtn", "ftZoomRange", "ftAppearAfterClickBtn"]) {
    if (dom[id]) {
      dom[id].disabled = !hasSelected;
    }
  }

  if (dom.ftStyleMenu && !hasSelected) {
    dom.ftStyleMenu.classList.add("hidden");
  }

  if (dom.ftZoomRange) {
    const localScale = hasSelected ? safeClampNumber(selected.localScale, 0.25, 3, 1) : 1;
    dom.ftZoomRange.value = String(localScale);
  }

  const checkMappings = [
    ["ftToggleFramedBtn", "overlayFramedCheckbox"],
    ["ftTogglePenBtn", "overlayAllowWritingCheckbox"],
    ["ftToggleKeyBtn", "overlayAllowKeyControlCheckbox"],
    ["ftToggleShadedBtn", "overlayShadedCheckbox"],
    ["ftToggleLockedBtn", "overlayLockedCheckbox"],
  ];

  checkMappings.forEach(([btnId, checkId]) => {
    const btn = dom[btnId];
    const checkbox = dom[checkId];
    if (!btn || !checkbox) {
      return;
    }
    btn.disabled = !hasSelected;
    btn.classList.toggle("active", hasSelected && !!checkbox.checked);
  });
}

function renderStage() {
  beginTextRenderSelectionGuard();
  // Everything except the DTUwrite board layer (dtuwrite-board.js): those boards must survive a
  // re-render, reloading them would lose the stroke being written and their undo history.
  for (const child of [...dom.stage.children]) {
    if (!child.classList.contains("dtuwrite-layer")) child.remove();
  }
  state.notesIframeWindows.clear();
  state.presenterTextBridgeWindows.clear();
  state.presenterHighlighter.canvas = null;
  state.presenterHighlighter.ctx = null;

  if (state.mode === "present" && state.showPresenterEndScreen) {
    const end = document.createElement("div");
    end.className = "presentation-end-screen";
    end.innerHTML = `
      <div class="presentation-end-eyebrow">End of presentation</div>
      <h1>Thank you for your attention</h1>
      <div class="presentation-end-sub">Press Previous to return to the last slide.</div>
    `;
    dom.stage.appendChild(end);
    dom.stage.appendChild(buildPresenterEdgeNav());
    ensurePresenterHighlighterLayer();
    drawPresenterHighlighterFrame(performance.now());
    if (state.presenterHighlighter.fading) {
      schedulePresenterHighlighterFade();
    }
    state.pendingTextSelection = null;
    state.stageRenderInProgress = false;
    return;
  }

  const slide = currentSlide();
  const useAnimationPlayback = state.mode === "present";
  const visibilityMap = useAnimationPlayback ? getOverlayVisibilityMapForStep(slide, state.animationStepIndex) : null;

  if (!slide?.overlays.some((o) => o.id === state.keyControlOverlayId)) {
    state.keyControlOverlayId = null;
  }

  if (!slide) {
    const guide = buildEmptyStageGuide();
    dom.stage.appendChild(guide);
    if (state.mode === "present") {
      ensurePresenterHighlighterLayer();
      drawPresenterHighlighterFrame(performance.now());
      if (state.presenterHighlighter.fading) {
        schedulePresenterHighlighterFade();
      }
    }
    state.pendingTextSelection = null;
    state.stageRenderInProgress = false;
    return;
  }

  const slideAsset = resolveAssetByAnyId(slide.slideAssetId);
  if (isSectionDivider(slide)) {
    // Section dividers compose the image into a styled layout instead of the
    // full-bleed base image; overlays/animations still render on top.
    dom.stage.appendChild(buildSectionDividerLayer(slide, slideAsset));
  } else if (isSummarySlide(slide)) {
    // Summary slides compose a movable block of figure/text cells; overlays and
    // animations still render on top exactly like on a divider.
    dom.stage.appendChild(buildSummaryLayer(slide));
  } else if (isTitleSlide(slide)) {
    // Title-page slides compose title / presenters / affiliation / DTU logo
    // and an optional image or sim in one of 5 styles × 2 variants.
    dom.stage.appendChild(buildTitleLayer(slide));
  } else if (slideAsset?.dataUrl) {
    const img = document.createElement("img");
    img.className = "base-slide";
    img.src = getImageDisplayUrl(slideAsset);
    img.alt = slide.name;
    dom.stage.appendChild(img);
  }

  // Optional title strip: above the slide image, below overlays.
  const titleLayer = buildSlideTitleLayer(slide, { placeholder: state.mode === "edit" });
  if (titleLayer) {
    dom.stage.appendChild(titleLayer);
  }

  const sorted = [...slide.overlays].sort((a, b) => a.zIndex - b.zIndex);
  const blockOverlayContentPointerEvents = false;
  const passThroughHtmlOverlayContent = state.mode === "present" && state.presenterTextInsertArmed;
  for (const overlay of sorted) {
    const el = document.createElement("div");
    const baseOpacity = safeClampNumber(overlay.opacity, 0.1, 1, 1);
    const visibleAtStep = useAnimationPlayback ? (visibilityMap.get(overlay.id) !== false) : true;
    el.className = `overlay ${overlay.framed ? "framed" : "seamless"} ${overlay.shaded ? "shaded" : ""} ${overlay.id === state.selectedOverlayId ? "selected" : ""}`;
    el.dataset.overlayId = overlay.id;
    el.dataset.baseOpacity = String(baseOpacity);
    el.style.left = `${overlay.x * 100}%`;
    el.style.top = `${overlay.y * 100}%`;
    el.style.width = `${overlay.w * 100}%`;
    el.style.height = `${overlay.h * 100}%`;
    el.style.zIndex = String(overlay.zIndex || 1);
    el.style.opacity = visibleAtStep ? String(baseOpacity) : "0";
    el.style.pointerEvents = visibleAtStep ? "" : "none";

    const source = resolveAssetByAnyId(overlay.sourceId);
    if (source) {
      if (source.kind === "overlay-image") {
        const img = document.createElement("img");
        img.className = "overlay-content";
        img.src = getImageDisplayUrl(source);
        img.alt = source.name;
        img.draggable = false;
        img.style.objectFit = "contain";
        img.style.width = "100%";
        img.style.height = "100%";
        applyGlobalContentScale(img, overlay.localScale);
        el.appendChild(img);
      } else if (source.kind === "overlay-sequence") {
        ensureOverlaySequenceSourceDefaults(source);
        const frameIndex = normalizeOverlaySequenceIndex(overlay.sequenceIndex, source.frames.length);
        const frame = source.frames[frameIndex] || source.frames[0] || null;
        const img = document.createElement("img");
        img.className = "overlay-content";
        img.src = frame ? getImageDisplayUrl(frame) : "";
        img.alt = source.name;
        img.draggable = false;
        img.style.objectFit = "contain";
        img.style.width = "100%";
        img.style.height = "100%";
        if (state.mode === "present" && source.frames.length > 1 && !blockOverlayContentPointerEvents) {
          img.style.pointerEvents = "auto";
          img.addEventListener("click", (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            overlay.sequenceIndex = (frameIndex + 1) % source.frames.length;
            renderStage();
          });
        } else {
          img.style.pointerEvents = "none";
        }
        applyGlobalContentScale(img, overlay.localScale);
        el.appendChild(img);
      } else if (source.kind === "overlay-video") {
        const video = document.createElement("video");
        video.className = "overlay-content";
        video.src = source.dataUrl;
        video.loop = false;
        video.muted = false;
        video.autoplay = false;
        video.playsInline = true;
        video.controls = false;
        video.preload = "metadata";
        if (state.mode === "edit") {
          video.style.pointerEvents = "none";
        } else if (blockOverlayContentPointerEvents) {
          video.style.pointerEvents = "none";
        } else {
          video.style.pointerEvents = "auto";
        }
        applyGlobalContentScale(video, overlay.localScale);
        el.appendChild(video);

        if (state.mode === "present") {
          const videoControls = buildOverlayVideoControls(overlay, video);
          if (videoControls) {
            el.appendChild(videoControls);
            bindOverlayVideoControlsVisibility(el, videoControls);
          }
        }
      } else if (source.kind === "overlay-text") {
        ensureOverlayTextSourceDefaults(source);
        el.classList.add("text-overlay");
        el.dataset.textAlign = source.align;
        el.dataset.textValign = source.valign;
        el.dataset.bulletStyle = normalizeTextBulletStyle(source.bulletStyle);

        const textEl = document.createElement("div");
        textEl.className = "overlay-content overlay-text-editable";
        textEl.innerHTML = source.html || "";
        if (useAnimationPlayback) applyParagraphStateToTextEl(textEl, overlay.id, slide, state.animationStepIndex);
        textEl.style.fontFamily = source.font || "Arial, sans-serif";
        // Slide points -> px against the live stage, so the box reads the same
        // while editing, while presenting, and on a projector of any size.
        textEl.style.setProperty("--tx-size", `${slidePointsToPx(source.fontSize)}px`);
        textEl.style.setProperty("--tx-line", String(safeClampNumber(source.lineHeight, 0.8, 3, 1.25)));
        textEl.style.fontWeight = source.bold ? "700" : "400";
        textEl.style.fontStyle = source.italic ? "italic" : "normal";
        textEl.style.textDecoration = source.underline ? "underline" : "none";
        textEl.style.color = sanitizeHexColor(source.color, "#000000");
        textEl.style.textAlign = source.align;
        // Only a box with autofit off ever needs to scroll. Leaving overflow on
        // "auto" while autofit is working puts a scrollbar in the box for the
        // moment it is still too small, which narrows the text and makes the
        // measurement chase itself.
        textEl.style.overflow = normalizeTextAutoFit(source.autoFit) === "none" ? "auto" : "hidden";
        textEl.classList.toggle("has-shade", !!source.shaded);
        if (source.shaded) {
          textEl.style.backgroundColor = hexToRgba(source.fillColor, source.fillOpacity);
        } else {
          textEl.style.backgroundColor = "transparent";
        }

        // In edit mode a text box is always ready to take the caret, so a
        // single click lands where you clicked instead of only selecting the
        // box and making you click again. The border band and Ctrl+drag stay
        // reserved for moving it.
        // overlay.locked only freezes dragging while presenting, so it must not
        // gate typing here — old decks default it to true.
        const canEditText = (
          state.mode === "edit" && !state.drawingEnabled && !state.textToolActive
        ) || (
          state.mode === "present" && overlay.id === state.presenterTextEditOverlayId
        );
        textEl.contentEditable = canEditText ? "true" : "false";
        textEl.spellcheck = false;
        if (!String(source.text || "").trim()) {
          textEl.dataset.placeholder = state.mode === "edit" ? "Type here" : "";
        }

        textEl.addEventListener("mousedown", (ev) => {
          if (!canEditText) {
            return;
          }
          const rect = el.getBoundingClientRect();
          const inset = TEXT_BOX_EDGE_GRAB_PX;
          const nearEdge = (ev.clientX - rect.left) <= inset
            || (ev.clientY - rect.top) <= inset
            || (rect.right - ev.clientX) <= inset
            || (rect.bottom - ev.clientY) <= inset;
          if (nearEdge || ev.ctrlKey || ev.metaKey) {
            // Let the stage handler pick this up as a move/resize drag.
            return;
          }
          state.activeTextEditOverlayId = overlay.id;
          ev.stopPropagation();
        });

        textEl.addEventListener("focus", () => {
          state.activeTextEditOverlayId = overlay.id;
          state.selectedOverlayId = overlay.id;
          syncTextToolFromSelectedOverlaySource();
          renderOverlayInspector(false);
          updateTextToolboxVisibility();
        });

        textEl.addEventListener("blur", () => {
          if (state.activeTextEditOverlayId !== overlay.id) {
            return;
          }
          // Blur is dispatched as a task, so it can arrive after a stage
          // rebuild has already replaced this node. Committing from a detached
          // editor would write back whatever it happened to be showing and
          // undo the change that caused the rebuild.
          if (!textEl.isConnected) {
            return;
          }
          commitActiveTextEditor();
        });

        textEl.addEventListener("keyup", () => syncTextToolFromCaret());
        textEl.addEventListener("mouseup", () => {
          rememberTextSelection();
          syncTextToolFromCaret();
        });

        textEl.addEventListener("keydown", (ev) => {
          handleTextEditorKeydown(ev, overlay, source);
        });

        // Paste as sanitized markup: keeps bold/italic/lists from Word or a
        // browser, drops images, tables, fonts and colours that would fight
        // the slide design. Shift+paste drops all formatting.
        textEl.addEventListener("paste", (ev) => {
          ev.preventDefault();
          const clip = ev.clipboardData;
          if (!clip) {
            return;
          }
          const plain = clip.getData("text/plain") || "";
          const rich = ev.shiftKey ? "" : (clip.getData("text/html") || "");
          const markup = rich ? sanitizeTextHtml(rich) : escapeTextToHtml(plain);
          document.execCommand("insertHTML", false, markup);
          commitActiveTextEditor();
        });

        textEl.addEventListener("input", () => {
          source.html = sanitizeTextHtml(textEl.innerHTML);
          source.text = textHtmlToPlain(source.html);
          source.name = source.text.trim() ? `Text: ${source.text.trim().slice(0, 18)}` : "Text";
          delete textEl.dataset.placeholder;
          touch();
          scheduleSourceListRefresh();
          applyTextOverlayAutoFit(overlay, source);
        });

        applyGlobalContentScale(textEl, overlay.localScale);
        el.appendChild(textEl);

        if (state.mode === "edit") {
          // A visible grip, so moving a text box never means hunting for the
          // 8px border band the way it used to. It sits above the box, except
          // for a box at the very top of the slide where there is no room.
          const stageRectForGrip = dom.stage.getBoundingClientRect();
          if (overlay.y * stageRectForGrip.height < 18) {
            el.classList.add("text-grip-inside");
          }
          const grip = document.createElement("div");
          grip.className = "text-overlay-grip";
          grip.title = "Drag to move this text box";
          grip.dataset.overlayId = overlay.id;
          el.appendChild(grip);
        }

        queueMicrotask(() => applyTextOverlayAutoFit(overlay, source));
      } else if (source.kind === "overlay-pdf") {
        el.classList.add("pdf-overlay");
        const iframe = document.createElement("iframe");
        iframe.className = "overlay-content";
        iframe.loading = "eager";
        iframe.src = getPdfDisplayUrl(source);
        iframe.removeAttribute("sandbox");
        if (state.mode === "edit") {
          iframe.style.pointerEvents = "none";
        } else if (blockOverlayContentPointerEvents) {
          iframe.style.pointerEvents = "none";
        } else {
          iframe.style.pointerEvents = "auto";
        }
        applyGlobalContentScale(iframe, overlay.localScale);
        el.appendChild(iframe);
      } else if (source.kind === "overlay-html-file" && !isNotesBoardSource(overlay.sourceId)) {
        const iframe = document.createElement("iframe");
        iframe.className = "overlay-content";
        iframe.loading = "eager";
        const htmlText = source.htmlText || "";
        const externalUrl = resolveHtmlFileSourceExternalUrl(source, htmlText);
        if (externalUrl) {
          iframe.src = externalUrl;
        } else {
          iframe.srcdoc = htmlText;
        }
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-pointer-lock");
        bindEmbedResizeKick(iframe);
        bindPresenterTextShortcutBridge(iframe, overlay.id);
        if (state.mode === "edit") {
          iframe.style.pointerEvents = "none";
        } else if (passThroughHtmlOverlayContent) {
          iframe.style.pointerEvents = "none";
        } else if (blockOverlayContentPointerEvents) {
          iframe.style.pointerEvents = "none";
        } else {
          iframe.style.pointerEvents = "auto";
        }
        applyGlobalContentScale(iframe, overlay.localScale);
        el.appendChild(iframe);
      } else if (source.kind === "overlay-html-external" && !isNotesBoardSource(overlay.sourceId)) {
        const iframe = document.createElement("iframe");
        iframe.className = "overlay-content";
        iframe.loading = "eager";
        iframe.src = source.url;
        // External pages often break in sandboxed iframes even when embeddable.
        // Keep external overlays unsandboxed for compatibility.
        iframe.removeAttribute("sandbox");
        iframe.referrerPolicy = "no-referrer-when-downgrade";
        bindEmbedResizeKick(iframe);
        bindPresenterTextShortcutBridge(iframe, overlay.id);
        if (state.mode === "edit") {
          iframe.style.pointerEvents = "none";
        } else if (passThroughHtmlOverlayContent) {
          iframe.style.pointerEvents = "none";
        } else if (blockOverlayContentPointerEvents) {
          iframe.style.pointerEvents = "none";
        } else {
          iframe.style.pointerEvents = "auto";
        }
        applyGlobalContentScale(iframe, overlay.localScale);
        el.appendChild(iframe);
      } else if (source.kind === "overlay-html-filelink" && !isNotesBoardSource(overlay.sourceId)) {
        const iframe = document.createElement("iframe");
        iframe.className = "overlay-content";
        iframe.loading = "eager";
        const useSnapshot = !!source.preferSnapshot && !!source.htmlText;
        const filelinkUrl = useSnapshot ? "" : resolveHtmlFileLinkUrl(source);
        if (filelinkUrl) {
          // Always load from the live file URL so edits to the file are reflected.
          // Only cache-bust for http(s) — file:// URLs never cache and don't support query strings.
          const isHttp = /^https?:/i.test(filelinkUrl);
          iframe.src = isHttp
            ? (filelinkUrl.includes("?") ? `${filelinkUrl}&_t=${Date.now()}` : `${filelinkUrl}?_t=${Date.now()}`)
            : filelinkUrl;
          iframe.removeAttribute("sandbox");
          iframe.referrerPolicy = "no-referrer-when-downgrade";
        } else if (source.htmlText) {
          // Fallback: URL could not be resolved — show stored snapshot.
          iframe.srcdoc = source.htmlText;
          iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-pointer-lock");
        }
        bindEmbedResizeKick(iframe);
        bindPresenterTextShortcutBridge(iframe, overlay.id);
        if (state.mode === "edit") {
          iframe.style.pointerEvents = "none";
        } else if (passThroughHtmlOverlayContent) {
          iframe.style.pointerEvents = "none";
        } else if (blockOverlayContentPointerEvents) {
          iframe.style.pointerEvents = "none";
        } else {
          iframe.style.pointerEvents = "auto";
        }
        applyGlobalContentScale(iframe, overlay.localScale);
        el.appendChild(iframe);
      } else if (isNotesBoardSource(overlay.sourceId)) {
        el.classList.add("notes-board-overlay");
        ensureOverlayNotesDefaults(overlay);
        if (overlay.notesBoardTypingVersion !== 1) {
          // Notes Board is a typed editor first. Older overlays sometimes
          // inherited the presenter's annotation layer and hid the iframe UI.
          overlay.annotationsEnabled = false;
          overlay.notesBoardTypingVersion = 1;
          touch();
        }
        if (!overlay.notesKey) {
          overlay.notesKey = uid();
          touch();
        }
        const iframe = document.createElement("iframe");
        iframe.className = "overlay-content overlay-notes-board-frame";
        iframe.loading = "eager";
        iframe.src = source.url || NOTES_BOARD_FILE_NAME;
        iframe.removeAttribute("sandbox");
        iframe.referrerPolicy = "no-referrer-when-downgrade";
        bindPresenterTextShortcutBridge(iframe, overlay.id);
        if (state.mode === "edit" && overlay.annotationsEnabled && state.annotationTool !== "arrow") {
          iframe.style.pointerEvents = "none";
        } else if (passThroughHtmlOverlayContent) {
          iframe.style.pointerEvents = "none";
        } else if (blockOverlayContentPointerEvents) {
          iframe.style.pointerEvents = "none";
        } else {
          iframe.style.pointerEvents = "auto";
        }
        bindEmbedResizeKick(iframe);
        iframe.addEventListener("load", () => {
          if (iframe.contentWindow) {
            state.notesIframeWindows.set(iframe.contentWindow, overlay.id);
            postNotesInitToOverlay(overlay.id, iframe.contentWindow);
          }
        });
        applyGlobalContentScale(iframe, overlay.localScale);
        el.appendChild(iframe);
      } else if (source.kind === "overlay-notebook-panel") {
        el.classList.add("notebook-panel-overlay");
        ensureOverlayNotebookDefaults(overlay);
        const currentPage = getOverlayNotebookCurrentPage(overlay);
        const panel = document.createElement("div");
        panel.className = "overlay-notebook-surface";
        panel.dataset.backgroundMode = getNotebookPageBackgroundMode(currentPage);
        panel.style.background = getNotebookBackgroundFill(currentPage?.backgroundMode);
        el.appendChild(panel);
      }
    } else if (state.mode === "edit") {
      el.appendChild(buildEmptyOverlaySourceQuickAccess(overlay));
    }

    ensureOverlayAnnotationDefaults(overlay);
    const notebookSource = isNotebookPanelSource(overlay.sourceId);
    if (notebookSource) {
      ensureOverlayNotebookDefaults(overlay);
      overlay.annotationsEnabled = true;
      el.dataset.notebookMode = overlay.notebookMode;
      el.classList.add(`notebook-mode-${overlay.notebookMode}`);
      // Previous-page underlay. Drawn as a canvas so it replays vector strokes
      // as well as a legacy raster layer, and scales with the panel.
      if (overlay.notebookShadowEnabled && overlay.notebookPageIndex > 0) {
        const shadowCanvas = buildOverlayNotebookShadowCanvas(overlay);
        if (shadowCanvas) {
          el.appendChild(shadowCanvas);
        }
      }
      const notebookText = buildOverlayNotebookTextEditor(overlay);
      if (notebookText) {
        el.appendChild(notebookText);
      }
      const notebookCanvas = buildOverlayNotebookCanvas(overlay);
      if (notebookCanvas) {
        el.appendChild(notebookCanvas);
      }
    } else if (overlay.annotationsEnabled) {
      const canvas = buildOverlayAnnotationCanvas(overlay);
      if (canvas) {
        el.appendChild(canvas);
      }
    }

    const controls = document.createElement("div");
    controls.className = "overlay-controls";
    const showControls = state.mode === "edit" && overlay.id === state.selectedOverlayId;

    if (showControls) {
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "overlay-annotation-color";
      colorInput.value = sanitizeHexColor(overlay.annotationColor, "#000000");
      colorInput.title = "Pen color";
      colorInput.disabled = !overlay.annotationsEnabled;
      colorInput.addEventListener("click", (ev) => ev.stopPropagation());
      colorInput.addEventListener("input", (ev) => {
        ev.stopPropagation();
        ensureOverlayAnnotationDefaults(overlay);
        overlay.annotationColor = sanitizeHexColor(colorInput.value, "#000000");
        if (state.selectedOverlayId === overlay.id) {
          renderOverlayInspector(false);
        }
        touch();
      });
      controls.appendChild(colorInput);
    }

    const openUrl = source?.kind === "overlay-html-filelink"
      ? resolveHtmlFileLinkUrl(source)
      : source?.url;
    if (showControls && (source?.kind === "overlay-html-external" || source?.kind === "overlay-html-filelink") && openUrl) {
      const openBtn = document.createElement("button");
      openBtn.textContent = "Open";
      openBtn.title = "Open external source in a new browser tab.";
      openBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        window.open(openUrl, "_blank", "noopener,noreferrer");
      });
      controls.appendChild(openBtn);
    }

    if (showControls && controls.children.length) {
      el.appendChild(controls);
    }

    if (notebookSource) {
      const notebookNav = buildOverlayNotebookPageNav(overlay);
      if (notebookNav) {
        el.appendChild(notebookNav);
      }
      const notebookTools = buildOverlayNotebookTools(overlay);
      if (notebookTools) {
        // The bar hovers above the panel; a panel at the top of the slide has
        // no room there, so it drops inside instead of off the stage.
        const stageRectForTools = dom.stage.getBoundingClientRect();
        if (overlay.y * stageRectForTools.height < 40) {
          el.classList.add("notebook-tools-inside");
        }
        el.appendChild(notebookTools);
      }
      bindNotebookOverlayHoverUi(el);
    } else if (overlay.annotationsEnabled) {
      const writeTools = buildOverlayWriteTools(overlay);
      if (writeTools) {
        el.appendChild(writeTools);
        bindOverlayToolbarVisibility(el);
      }
    }

    if (state.mode === "edit") {
      const handle = document.createElement("div");
      handle.className = "resize-handle";
      el.appendChild(handle);
    }

    if (state.mode === "present" && !isOverlayLockedInCurrentMode(overlay)) {
      const moveHint = document.createElement("div");
      moveHint.className = "overlay-corner-hint move";
      moveHint.textContent = "✥";
      moveHint.title = "Move overlay";
      el.appendChild(moveHint);

      const resizeHint = document.createElement("div");
      resizeHint.className = "overlay-corner-hint resize";
      resizeHint.textContent = "◢";
      resizeHint.title = "Resize overlay (hold Shift to keep aspect ratio)";
      el.appendChild(resizeHint);
    }

    const showKeyControlToggle = state.mode === "present" && !!overlay.allowKeyControl && isKeyControlEligibleSource(source);
    if (showKeyControlToggle) {
      const keyBtn = document.createElement("button");
      keyBtn.type = "button";
      keyBtn.className = "overlay-key-control-toggle";
      keyBtn.textContent = state.keyControlOverlayId === overlay.id ? "KEY ON" : "KEY";
      keyBtn.title = state.keyControlOverlayId === overlay.id
        ? "Keyboard control active for this overlay. Click to release."
        : "Click to give this overlay keyboard control (Esc still exits presenter mode).";
      if (state.keyControlOverlayId === overlay.id) {
        keyBtn.classList.add("active");
      }
      keyBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (state.keyControlOverlayId === overlay.id) {
          state.keyControlOverlayId = null;
          dom.modeHint.textContent = "Keyboard control released. Arrow keys navigate slides again.";
          renderStage();
          return;
        }
        state.keyControlOverlayId = overlay.id;
        const frame = el.querySelector("iframe.overlay-content");
        if (frame) {
          try {
            frame.focus();
          } catch {
            // Some embedded origins may reject focus calls.
          }
        }
        dom.modeHint.textContent = "Keyboard control sent to overlay. Press KEY again to release. Esc still exits presenter mode.";
        renderStage();
      });
      el.appendChild(keyBtn);
    }

    dom.stage.appendChild(el);
  }

  // DTU logo watermark (above slide content, non-interactive).
  const slideLogo = buildSlideLogo(slide);
  if (slideLogo) {
    dom.stage.appendChild(slideLogo);
  }

  // People credits / acknowledgements and the references line sit above all
  // other slide graphics and are never interactive.
  const creditsLayer = buildSlideCreditsLayer(slide);
  if (creditsLayer) {
    dom.stage.appendChild(creditsLayer);
  }
  const referencesBar = buildSlideReferencesBar(slide);
  if (referencesBar) {
    dom.stage.appendChild(referencesBar);
  }

  if (state.mode === "present") {
    dom.stage.appendChild(buildPresenterEdgeNav());
    ensurePresenterHighlighterLayer();
    drawPresenterHighlighterFrame(performance.now());
    if (state.presenterHighlighter.fading) {
      schedulePresenterHighlighterFade();
    }
  }

  refreshPresenterTextOverlayHighlights();
  // A stage rebuild destroys the contenteditable node under the caret. Put the
  // caret back so typing, style changes and autofit never interrupt a sentence.
  endTextRenderSelectionGuard();
}

function buildPresenterEdgeNav() {
  const nav = document.createElement("div");
  nav.className = "presenter-edge-nav";

  const makeEdgeButton = (className, title, delta, symbol) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.style.width = `${PRESENT_EDGE_NAV_HIT_PX}px`;

    const glyph = document.createElement("span");
    glyph.className = "presenter-edge-nav-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = symbol;
    btn.appendChild(glyph);

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      advancePresenterSequence(delta);
    });
    return btn;
  };

  nav.appendChild(makeEdgeButton("presenter-edge-nav-btn prev", "Previous slide", -1, "‹"));
  nav.appendChild(makeEdgeButton("presenter-edge-nav-btn next", "Next slide", 1, "›"));
  return nav;
}

function buildEmptyStageGuide() {
  const guide = document.createElement("div");
  guide.className = "empty-stage-guide";

  const title = document.createElement("h3");
  title.className = "empty-stage-guide-title";
  title.textContent = EMPTY_STAGE_GUIDE_TITLE;

  const subtext = document.createElement("p");
  subtext.className = "empty-stage-guide-subtext";
  subtext.textContent = EMPTY_STAGE_GUIDE_SUBTEXT;

  const actions = document.createElement("div");
  actions.className = "empty-stage-guide-actions";

  const addGuideButton = (label, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "empty-stage-guide-btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    actions.appendChild(btn);
  };

  addGuideButton("New", () => {
    dom.newDeckBtn?.click();
  });

  addGuideButton("Open .ipe", () => {
    dom.loadZipBtn?.click();
  });

  addGuideButton("Import slide images", () => {
    dom.importSlidesInput?.click();
  });

  guide.append(title, subtext, actions);
  return guide;
}

function ensureOverlayAnnotationDefaults(overlay) {
  if (!overlay || typeof overlay !== "object") {
    return;
  }
  if (typeof overlay.annotationsEnabled !== "boolean") {
    overlay.annotationsEnabled = false;
  }
  if (typeof overlay.annotationLayer !== "string") {
    overlay.annotationLayer = "";
  }
  overlay.annotationColor = sanitizeHexColor(overlay.annotationColor, "#000000");
}

function buildOverlayAnnotationCanvas(overlay) {
  if (!overlay || (state.mode === "edit" && state.drawingEnabled)) {
    return null;
  }

  const stageRect = dom.stage.getBoundingClientRect();
  const widthPx = Math.max(160, Math.round(stageRect.width * overlay.w));
  const heightPx = Math.max(120, Math.round(stageRect.height * overlay.h));

  const canvas = document.createElement("canvas");
  canvas.className = "overlay-annotation-canvas";
  canvas.width = widthPx;
  canvas.height = heightPx;
  canvas.dataset.overlayId = overlay.id;
  const effectiveTool = getEffectiveToolWithShiftEraser(state.annotationTool);
  canvas.dataset.tool = effectiveTool;
  canvas.style.pointerEvents = effectiveTool === "arrow" ? "none" : "auto";
  canvas.style.cursor = effectiveTool === "eraser"
    ? (state.shiftTempEraser ? SHIFT_ERASER_CURSOR : ERASER_CURSOR)
    : "crosshair";

  restoreAnnotationLayerToCanvas(canvas, overlay.annotationLayer);
  bindOverlayAnnotationCanvasEvents(canvas, overlay.id);
  return canvas;
}

function restoreAnnotationLayerToCanvas(canvas, dataUrl) {
  if (!canvas || !dataUrl) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataUrl;
}

function bindOverlayAnnotationCanvasEvents(canvas, overlayId) {
  if (!canvas) {
    return;
  }

  let drawing = false;
  let lastStrokeWidth = 2.6;
  let activeTool = "arrow";

  const effectivePressure = (ev) => {
    const raw = Number.isFinite(ev.pressure) ? ev.pressure : NaN;
    if (ev.pointerType === "pen" && Number.isFinite(raw) && raw > 0) {
      return clamp(raw, 0, 1);
    }
    // Keep non-pen tools predictable (mouse/touch) instead of forcing very thin strokes.
    return 0.5;
  };

  const penWidthForPressure = (pressure) => (1.2 + pressure * 5.8) * state.annotationLineWidth;
  const eraserWidthForPressure = (pressure) => 12 + pressure * 18;

  const getPoint = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = clamp((ev.clientX - rect.left) / Math.max(1, rect.width), 0, 1) * canvas.width;
    const y = clamp((ev.clientY - rect.top) / Math.max(1, rect.height), 0, 1) * canvas.height;
    return { x, y };
  };

  const beginStroke = (ev) => {
    activeTool = getEffectiveToolWithShiftEraser(state.annotationTool, ev);
    if ((state.mode === "edit" && state.drawingEnabled) || activeTool === "arrow") {
      return;
    }
    const overlay = findOverlay(overlayId);
    if (!overlay) {
      return;
    }
    if (!overlay.annotationsEnabled) {
      return;
    }

    state.selectedOverlayId = overlay.id;
    renderOverlayInspector(false);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const pressure = effectivePressure(ev);
    const p = getPoint(ev);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (activeTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = eraserWidthForPressure(pressure);
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = sanitizeHexColor(overlay.annotationColor, "#000000");
      ctx.lineWidth = penWidthForPressure(pressure);
    }
    lastStrokeWidth = ctx.lineWidth;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);

    drawing = true;
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    ev.stopPropagation();
  };

  const moveStroke = (ev) => {
    if (!drawing) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const pressure = effectivePressure(ev);
    if (activeTool === "eraser") {
      ctx.lineWidth = eraserWidthForPressure(pressure);
    } else {
      const target = penWidthForPressure(pressure);
      // Light smoothing avoids jitter while still reacting to pressure changes.
      ctx.lineWidth = lastStrokeWidth * 0.65 + target * 0.35;
    }
    lastStrokeWidth = ctx.lineWidth;
    const p = getPoint(ev);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ev.preventDefault();
    ev.stopPropagation();
  };

  const endStroke = (ev) => {
    if (!drawing) {
      return;
    }
    drawing = false;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.closePath();
      ctx.restore();
    }

    const overlay = findOverlay(overlayId);
    if (overlay) {
      ensureOverlayAnnotationDefaults(overlay);
      overlay.annotationLayer = canvas.toDataURL("image/png");
      touch();
    }

    if (canvas.hasPointerCapture(ev.pointerId)) {
      canvas.releasePointerCapture(ev.pointerId);
    }
    ev.preventDefault();
    ev.stopPropagation();
  };

  canvas.addEventListener("pointerdown", beginStroke);
  canvas.addEventListener("pointermove", moveStroke);
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("mousedown", (e) => e.stopPropagation());
}

function buildOverlayWriteTools(overlay) {
  const bar = document.createElement("div");
  bar.className = "overlay-write-tools";
  bar.dataset.overlayId = overlay.id;

  const rerenderAnnotationUi = () => {
    if (refreshStatefulHtmlOverlayAnnotationUi(overlay.id)) {
      renderOverlayInspector(false);
      return;
    }
    renderStage();
    renderOverlayInspector(false);
  };

  const addBtn = (label, title, onClick, active = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `overlay-write-tool${active ? " active" : ""}`;
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
    bar.appendChild(btn);
    return btn;
  };

  // Arrow button — for notes boards show a "𝐀 Type" letter instead for clarity
  if (isNotesBoardSource(overlay.sourceId)) {
    addBtn("𝐀", "Type in text board (pointer mode — lets you click and type)", () => {
      state.annotationTool = "arrow";
      state.penSubBarOpen = false;
      rerenderAnnotationUi();
    }, state.annotationTool === "arrow");
  } else {
    addBtn("↖", "Arrow: interact without drawing", () => {
      state.annotationTool = "arrow";
      rerenderAnnotationUi();
    }, state.annotationTool === "arrow");
  }

  // Pen button with vertical sub-bar for line width + color
  {
    const penWrap = document.createElement("div");
    penWrap.className = `pen-btn-wrap${state.penSubBarOpen ? " pen-sub-open" : ""}`;

    const penBtn = document.createElement("button");
    penBtn.type = "button";
    penBtn.className = `overlay-write-tool${state.annotationTool === "pen" ? " active" : ""}`;
    penBtn.textContent = "✎";
    penBtn.title = "Pen (click again to open line options)";
    penBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (state.annotationTool !== "pen") {
        // Switch to pen — don't open sub-bar yet
        state.annotationTool = "pen";
        state.penSubBarOpen = false;
      } else {
        // Already on pen — toggle sub-bar
        state.penSubBarOpen = !state.penSubBarOpen;
      }
      rerenderAnnotationUi();
    });
    penWrap.appendChild(penBtn);

    const subBar = document.createElement("div");
    subBar.className = "pen-sub-bar";

    const lineSVG = (w) =>
      `<svg width="16" height="16" viewBox="0 0 16 16"><line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/></svg>`;

    // Order: thin (bottom, closest to pen), medium, thick, color (top)
    // flex-direction: column-reverse so first appended = bottom
    [{ factor: 0.4, svgW: 1.5, title: "Thin line" },
     { factor: 1,   svgW: 3,   title: "Medium line" },
     { factor: 2.5, svgW: 5,   title: "Thick line" },
    ].forEach(({ factor, svgW, title }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `overlay-write-tool pen-sub-btn${state.annotationLineWidth === factor ? " active" : ""}`;
      btn.innerHTML = lineSVG(svgW);
      btn.title = title;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.annotationLineWidth = factor;
        state.penSubBarOpen = false;
        rerenderAnnotationUi();
      });
      subBar.appendChild(btn);
    });

    // Color swatch button + hidden input
    const colorBtn = document.createElement("button");
    colorBtn.type = "button";
    colorBtn.className = "overlay-write-tool pen-sub-btn pen-color-btn";
    colorBtn.title = "Pen color";
    const currentColor = sanitizeHexColor(overlay.annotationColor, "#000000");
    colorBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${currentColor}" stroke="rgba(0,0,0,0.25)" stroke-width="1"/></svg>`;

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = currentColor;
    colorInput.className = "pen-sub-color-input";
    colorInput.addEventListener("input", (ev) => {
      ev.stopPropagation();
      const target = findOverlay(overlay.id);
      if (target) {
        target.annotationColor = sanitizeHexColor(colorInput.value, "#000000");
        touch();
        const circle = colorBtn.querySelector("circle");
        if (circle) { circle.setAttribute("fill", target.annotationColor); }
      }
    });
    colorInput.addEventListener("change", (ev) => {
      ev.stopPropagation();
      // Color committed — close the sub-bar
      state.penSubBarOpen = false;
      rerenderAnnotationUi();
    });
    colorBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      colorInput.click();
    });
    subBar.appendChild(colorBtn);
    subBar.appendChild(colorInput);

    penWrap.appendChild(subBar);
    bar.appendChild(penWrap);
  }

  addBtn("⌫", "Eraser", () => {
    state.annotationTool = "eraser";
    rerenderAnnotationUi();
  }, state.annotationTool === "eraser");

  addBtn("✕", "Clear writing", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    ensureOverlayAnnotationDefaults(target);
    target.annotationLayer = "";
    touch();
    rerenderAnnotationUi();
  });

  return bar;
}

function isStatefulHtmlOverlaySource(sourceId) {
  const source = resolveAssetByAnyId(sourceId);
  return !!source && (
    source.kind === "overlay-html-file"
    || source.kind === "overlay-html-filelink"
    || source.kind === "overlay-html-external"
    || source.kind === "overlay-notes-board"
  );
}

function refreshStatefulHtmlOverlayAnnotationUi(overlayId) {
  const overlay = findOverlay(overlayId);
  if (!overlay || isNotebookPanelSource(overlay.sourceId) || !isStatefulHtmlOverlaySource(overlay.sourceId)) {
    return false;
  }

  const overlayEl = dom.stage?.querySelector(`.overlay[data-overlay-id="${overlayId}"]`);
  if (!overlayEl) {
    return false;
  }

  overlayEl.querySelectorAll(".overlay-write-tools, canvas.overlay-annotation-canvas:not(.overlay-notebook-canvas)").forEach((node) => {
    node.remove();
  });

  ensureOverlayAnnotationDefaults(overlay);
  if (overlay.annotationsEnabled) {
    const canvas = buildOverlayAnnotationCanvas(overlay);
    if (canvas) {
      overlayEl.appendChild(canvas);
    }
    const writeTools = buildOverlayWriteTools(overlay);
    if (writeTools) {
      overlayEl.appendChild(writeTools);
      bindOverlayToolbarVisibility(overlayEl);
    }
  }

  return true;
}

function buildOverlayNotebookCanvas(overlay) {
  if (!overlay || (state.mode === "edit" && state.drawingEnabled)) {
    return null;
  }
  ensureOverlayNotebookDefaults(overlay);

  const stageRect = dom.stage.getBoundingClientRect();
  // Back the canvas at device resolution so ink is not soft on a HiDPI laptop
  // or a 4K projector. The CSS box stays at the panel's layout size.
  const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
  const cssW = Math.max(160, Math.round(stageRect.width * overlay.w));
  const cssH = Math.max(120, Math.round(stageRect.height * overlay.h));

  const canvas = document.createElement("canvas");
  canvas.className = "overlay-notebook-canvas overlay-annotation-canvas";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.dataset.overlayId = overlay.id;
  const effectiveTool = getEffectiveToolWithShiftEraser(overlay.notebookMode);
  canvas.dataset.tool = effectiveTool;
  canvas.style.pointerEvents = (effectiveTool === "pen" || effectiveTool === "eraser") ? "auto" : "none";
  canvas.style.cursor = effectiveTool === "eraser"
    ? (state.shiftTempEraser ? SHIFT_ERASER_CURSOR : ERASER_CURSOR)
    : "crosshair";

  redrawOverlayNotebookCanvas(canvas, overlay);
  bindOverlayNotebookCanvasEvents(canvas, overlay.id);
  return canvas;
}

// Replays a page: the legacy raster layer first (scaled to fill rather than
// drawn at its captured pixel size, which is what used to clip or blur it
// after a resize), then the vector strokes on top.
function redrawOverlayNotebookCanvas(canvas, overlay, pageOverride = null) {
  if (!canvas || !overlay) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const page = pageOverride || getOverlayNotebookCurrentPage(overlay);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const paintStrokes = () => {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of (page?.strokes || [])) {
      const pts = stroke.pts;
      if (!pts || pts.length < 2) {
        continue;
      }
      ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
      ctx.strokeStyle = stroke.erase ? "rgba(0,0,0,1)" : stroke.color;
      ctx.lineWidth = Math.max(1, stroke.width * canvas.width);
      ctx.beginPath();
      ctx.moveTo(pts[0] * canvas.width, pts[1] * canvas.height);
      if (pts.length === 2) {
        // A single tap still leaves a dot.
        ctx.lineTo(pts[0] * canvas.width + 0.01, pts[1] * canvas.height);
      }
      for (let i = 2; i + 1 < pts.length; i += 2) {
        ctx.lineTo(pts[i] * canvas.width, pts[i + 1] * canvas.height);
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  const legacy = String(page?.drawingLayer || "");
  if (legacy) {
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      paintStrokes();
    };
    img.onerror = () => paintStrokes();
    img.src = legacy;
    return;
  }

  paintStrokes();
}

// Flattens a page (legacy raster + vector strokes) to a PNG for printing and
// for any consumer that still expects a single image layer.
function renderNotebookPageToDataUrl(overlay, page) {
  if (!page || (!page.strokes?.length && !page.drawingLayer)) {
    return "";
  }
  if (!page.strokes?.length) {
    return String(page.drawingLayer || "");
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = Math.max(200, Math.round(1600 * (overlay.h / Math.max(0.01, overlay.w))));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return String(page.drawingLayer || "");
  }
  // Drawn synchronously: the legacy raster is skipped here because loading an
  // image is async and printing cannot wait for it. Strokes are the current
  // format, so this covers everything authored in this build.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of page.strokes) {
    if (stroke.erase) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color;
    }
    ctx.lineWidth = Math.max(1, stroke.width * canvas.width);
    ctx.beginPath();
    ctx.moveTo(stroke.pts[0] * canvas.width, stroke.pts[1] * canvas.height);
    for (let i = 2; i + 1 < stroke.pts.length; i += 2) {
      ctx.lineTo(stroke.pts[i] * canvas.width, stroke.pts[i + 1] * canvas.height);
    }
    ctx.stroke();
  }
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return String(page.drawingLayer || "");
  }
}

function buildOverlayNotebookShadowCanvas(overlay) {
  ensureOverlayNotebookDefaults(overlay);
  const prev = overlay.notebookPages[overlay.notebookPageIndex - 1];
  if (!prev || (!prev.strokes?.length && !prev.drawingLayer)) {
    return null;
  }
  const stageRect = dom.stage.getBoundingClientRect();
  const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
  const canvas = document.createElement("canvas");
  canvas.className = "overlay-notebook-shadow";
  canvas.width = Math.round(Math.max(160, stageRect.width * overlay.w) * dpr);
  canvas.height = Math.round(Math.max(120, stageRect.height * overlay.h) * dpr);
  redrawOverlayNotebookCanvas(canvas, overlay, prev);
  return canvas;
}

function bindOverlayNotebookCanvasEvents(canvas, overlayId) {
  if (!canvas) {
    return;
  }

  let drawing = false;
  let activeTool = "navigate";
  let current = null;

  const effectivePressure = (ev) => {
    const raw = Number.isFinite(ev.pressure) ? ev.pressure : NaN;
    if (ev.pointerType === "pen" && Number.isFinite(raw) && raw > 0) {
      return clamp(raw, 0, 1);
    }
    return 0.5;
  };

  // Stroke widths are fractions of the panel width so they scale with it.
  const penWidthForPressure = (pressure) => ((1.2 + pressure * 5.8) * state.annotationLineWidth) / Math.max(1, canvas.width / (window.devicePixelRatio || 1));
  const eraserWidthForPressure = (pressure) => (12 + pressure * 18) / Math.max(1, canvas.width / (window.devicePixelRatio || 1));

  const getPoint = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((ev.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((ev.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    };
  };

  const paintSegment = (fromX, fromY, toX, toY, width, erase, color) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.strokeStyle = erase ? "rgba(0,0,0,1)" : color;
    ctx.lineWidth = Math.max(1, width * canvas.width);
    ctx.beginPath();
    ctx.moveTo(fromX * canvas.width, fromY * canvas.height);
    ctx.lineTo(toX * canvas.width, toY * canvas.height);
    ctx.stroke();
    ctx.restore();
  };

  const beginStroke = (ev) => {
    const overlay = findOverlay(overlayId);
    if (!overlay || !isNotebookPanelSource(overlay.sourceId)) {
      return;
    }
    ensureOverlayNotebookDefaults(overlay);
    ensureOverlayAnnotationDefaults(overlay);
    activeTool = getEffectiveToolWithShiftEraser(overlay.notebookMode, ev);
    if (activeTool === "navigate" || activeTool === "type") {
      return;
    }

    const pressure = effectivePressure(ev);
    const p = getPoint(ev);
    current = {
      color: sanitizeHexColor(overlay.annotationColor, "#000000"),
      width: activeTool === "eraser" ? eraserWidthForPressure(pressure) : penWidthForPressure(pressure),
      erase: activeTool === "eraser",
      pts: [p.x, p.y],
    };
    paintSegment(p.x, p.y, p.x + 0.0001, p.y, current.width, current.erase, current.color);

    drawing = true;
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    ev.stopPropagation();
  };

  const moveStroke = (ev) => {
    if (!drawing || !current) {
      return;
    }
    const p = getPoint(ev);
    const lastX = current.pts[current.pts.length - 2];
    const lastY = current.pts[current.pts.length - 1];
    // Drop sub-pixel jitter: fewer points means a smaller deck and a smoother
    // line, without any visible loss.
    if (Math.abs(p.x - lastX) * canvas.width < 1 && Math.abs(p.y - lastY) * canvas.height < 1) {
      return;
    }
    current.pts.push(p.x, p.y);
    paintSegment(lastX, lastY, p.x, p.y, current.width, current.erase, current.color);
    ev.preventDefault();
    ev.stopPropagation();
  };

  const endStroke = (ev) => {
    if (!drawing) {
      return;
    }
    drawing = false;

    const overlay = findOverlay(overlayId);
    if (overlay && current) {
      ensureOverlayNotebookDefaults(overlay);
      appendOverlayNotebookStroke(overlay, current);
      touch();
    }
    current = null;

    if (canvas.hasPointerCapture(ev.pointerId)) {
      canvas.releasePointerCapture(ev.pointerId);
    }
    ev.preventDefault();
    ev.stopPropagation();
  };

  canvas.addEventListener("pointerdown", beginStroke);
  canvas.addEventListener("pointermove", moveStroke);
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("mousedown", (e) => e.stopPropagation());
}

function buildOverlayNotebookTextEditor(overlay) {
  if (!overlay) return null;
  ensureOverlayNotebookDefaults(overlay);
  const page = getOverlayNotebookCurrentPage(overlay);
  const editor = document.createElement("div");
  editor.className = "overlay-notebook-text";
  editor.dataset.overlayId = overlay.id;
  const typing = overlay.notebookMode === "type";
  editor.contentEditable = typing ? "true" : "false";
  editor.spellcheck = true;
  editor.innerHTML = String(page?.html || "");
  // Same slide-point scale as free text boxes, so a notebook and a text box at
  // the same number look the same and both track the stage.
  editor.style.setProperty("--nb-size", `${slidePointsToPx(overlay.notebookFontSize)}px`);
  if (typing) {
    editor.dataset.placeholder = "Type notes here…";
  }

  const keepEventInsideNotebook = (ev) => {
    if (overlay.notebookMode === "type") ev.stopPropagation();
  };
  editor.addEventListener("pointerdown", keepEventInsideNotebook);
  editor.addEventListener("mousedown", keepEventInsideNotebook);
  editor.addEventListener("click", keepEventInsideNotebook);

  editor.addEventListener("keydown", (ev) => {
    if (overlay.notebookMode !== "type") {
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    const lower = String(ev.key || "").toLowerCase();
    if (mod && !ev.altKey && (lower === "b" || lower === "i" || lower === "u")) {
      ev.preventDefault();
      document.execCommand("styleWithCSS", false, false);
      document.execCommand(lower === "b" ? "bold" : (lower === "i" ? "italic" : "underline"));
      commitNotebookEditor(overlay.id, editor);
      return;
    }
    if (mod && !ev.altKey && ev.shiftKey && lower === "l") {
      ev.preventDefault();
      document.execCommand("insertUnorderedList");
      commitNotebookEditor(overlay.id, editor);
      return;
    }
    // Ctrl+Shift+> / < steps the notebook's type size.
    if (mod && ev.shiftKey && (ev.key === ">" || ev.key === "." || ev.key === "<" || ev.key === ",")) {
      ev.preventDefault();
      const target = findOverlay(overlay.id);
      if (target) {
        ensureOverlayNotebookDefaults(target);
        target.notebookFontSize = stepTextFontSize(target.notebookFontSize, (ev.key === ">" || ev.key === ".") ? 1 : -1);
        editor.style.setProperty("--nb-size", `${slidePointsToPx(target.notebookFontSize)}px`);
        touch();
      }
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      commitNotebookEditor(overlay.id, editor);
      editor.blur();
      return;
    }
    // Arrows, Delete, Space and PageUp/Down are text editing here. Without
    // this they reached the deck shortcuts and changed slide mid-sentence
    // while presenting.
    ev.stopPropagation();
  });

  editor.addEventListener("paste", (ev) => {
    if (overlay.notebookMode !== "type") {
      return;
    }
    ev.preventDefault();
    const clip = ev.clipboardData;
    if (!clip) {
      return;
    }
    const plain = clip.getData("text/plain") || "";
    const rich = ev.shiftKey ? "" : (clip.getData("text/html") || "");
    document.execCommand("insertHTML", false, rich ? sanitizeTextHtml(rich) : escapeTextToHtml(plain));
    commitNotebookEditor(overlay.id, editor);
  });

  editor.addEventListener("input", () => {
    delete editor.dataset.placeholder;
    commitNotebookEditor(overlay.id, editor);
  });

  return editor;
}

function commitNotebookEditor(overlayId, editor) {
  const target = findOverlay(overlayId);
  if (!target || !editor) return;
  const targetPage = getOverlayNotebookCurrentPage(target);
  if (!targetPage) return;
  targetPage.html = sanitizeTextHtml(editor.innerHTML);
  targetPage.text = textHtmlToPlain(targetPage.html);
  targetPage.updatedAt = new Date().toISOString();
  touch();
}

function buildOverlayNotebookPageNav(overlay) {
  const nav = document.createElement("div");
  nav.className = "overlay-notebook-page-nav";
  nav.dataset.overlayId = overlay.id;

  const makeBtn = (label, title, delta, cls) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `overlay-notebook-page-btn ${cls}`;
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const target = findOverlay(overlay.id);
      if (!target) {
        return;
      }
      stepOverlayNotebookPage(target, delta, { wrap: true });
      touch();
      renderStage();
    });
    return btn;
  };

  nav.appendChild(makeBtn("‹", "Previous notebook page", -1, "prev"));
  nav.appendChild(makeBtn("›", "Next notebook page", 1, "next"));
  return nav;
}

function buildOverlayNotebookTools(overlay) {
  const bar = document.createElement("div");
  bar.className = "overlay-notebook-tools";
  bar.dataset.overlayId = overlay.id;

  ensureOverlayNotebookDefaults(overlay);

  const addBtn = (label, title, onClick, active = false, className = "") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `overlay-write-tool overlay-notebook-tool${active ? " active" : ""}${className ? ` ${className}` : ""}`;
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
    bar.appendChild(btn);
    return btn;
  };

  const refreshAfterNotebookChange = () => {
    touch();
    renderStage();
    renderOverlayInspector(false);
  };

  addBtn("N", "Insert new page after current", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    insertOverlayNotebookPage(target, false);
    refreshAfterNotebookChange();
  });

  addBtn("P", "Insert new page before current", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    insertOverlayNotebookPage(target, true);
    refreshAfterNotebookChange();
  });

  addBtn("X", "Delete current page (keeps one empty page minimum)", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    deleteOverlayNotebookPage(target);
    refreshAfterNotebookChange();
  });

  addBtn("D", "Duplicate current page", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    duplicateOverlayNotebookPage(target);
    refreshAfterNotebookChange();
  });

  const penWrap = document.createElement("div");
  penWrap.className = `notebook-pen-wrap${state.notebookPenSubBarOpen && state.notebookPenSubBarOverlayId === overlay.id ? " open" : ""}`;
  penWrap.addEventListener("mouseenter", (ev) => {
    ev.stopPropagation();
    if (!state.notebookPenSubBarOpen || state.notebookPenSubBarOverlayId !== overlay.id) {
      state.notebookPenSubBarOpen = true;
      state.notebookPenSubBarOverlayId = overlay.id;
      // Opening the pen choices must not rebuild the toolbar under the
      // pointer: doing so cancels the subsequent click on the pen toggle.
      penWrap.classList.add("open");
    }
  });

  addBtn("T", "Typing mode", () => {
    const target = findOverlay(overlay.id);
    if (!target) return;
    ensureOverlayNotebookDefaults(target);
    target.notebookMode = "type";
    target.notebookModeExplicit = true;
    refreshAfterNotebookChange();
    queueMicrotask(() => {
      const editor = dom.stage?.querySelector(`.overlay[data-overlay-id="${overlay.id}"] .overlay-notebook-text`);
      editor?.focus?.();
    });
  }, overlay.notebookMode === "type", "overlay-notebook-type-toggle");

  // ── Type size and character formatting ────────────────────────────────
  // The old notebook gave no control at all: its CSS asked for
  // clamp(14px, 1.7cqw, 24px) but nothing declared a container, so every
  // notebook rendered at a flat 24px whatever its size on the slide.
  const stepNotebookSize = (direction) => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    ensureOverlayNotebookDefaults(target);
    target.notebookFontSize = stepTextFontSize(target.notebookFontSize, direction);
    refreshAfterNotebookChange();
  };

  addBtn("A−", "Smaller notebook text (Ctrl+Shift+<)", () => stepNotebookSize(-1), false, "overlay-notebook-size-btn");
  const sizeLabel = document.createElement("span");
  sizeLabel.className = "overlay-notebook-size-label";
  sizeLabel.textContent = String(normalizeTextFontSize(overlay.notebookFontSize, 18));
  sizeLabel.title = "Notebook text size, in slide points";
  bar.appendChild(sizeLabel);
  addBtn("A+", "Larger notebook text (Ctrl+Shift+>)", () => stepNotebookSize(1), false, "overlay-notebook-size-btn");

  const runNotebookTextCommand = (command) => {
    const editor = dom.stage?.querySelector(`.overlay[data-overlay-id="${overlay.id}"] .overlay-notebook-text`);
    if (!(editor instanceof HTMLElement)) {
      return;
    }
    editor.focus({ preventScroll: true });
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(command);
    commitNotebookEditor(overlay.id, editor);
  };

  addBtn("B", "Bold (Ctrl+B)", () => runNotebookTextCommand("bold"), false, "overlay-notebook-fmt-btn");
  addBtn("I", "Italic (Ctrl+I)", () => runNotebookTextCommand("italic"), false, "overlay-notebook-fmt-btn overlay-notebook-fmt-italic");
  addBtn("•", "Bulleted list (Ctrl+Shift+L)", () => runNotebookTextCommand("insertUnorderedList"), false, "overlay-notebook-fmt-btn");

  const penBtn = document.createElement("button");
  penBtn.type = "button";
  penBtn.className = `overlay-write-tool overlay-notebook-tool${overlay.notebookMode === "pen" ? " active" : ""}`;
  penBtn.textContent = "✎";
  penBtn.title = "Pen mode";
  penBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    ensureOverlayNotebookDefaults(target);
    target.notebookMode = "pen";
    target.notebookModeExplicit = true;
    refreshAfterNotebookChange();
  });
  penWrap.appendChild(penBtn);

  const subBar = document.createElement("div");
  subBar.className = "notebook-pen-sub-bar";

  const lineSVG = (w) =>
    `<svg width="16" height="16" viewBox="0 0 16 16"><line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/></svg>`;
  [{ factor: 0.4, svgW: 1.5, title: "Thin line" },
   { factor: 1, svgW: 3, title: "Medium line" },
   { factor: 2.5, svgW: 5, title: "Thick line" }].forEach(({ factor, svgW, title }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `overlay-write-tool notebook-pen-sub-btn${state.annotationLineWidth === factor ? " active" : ""}`;
    btn.innerHTML = lineSVG(svgW);
    btn.title = title;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.annotationLineWidth = factor;
      state.notebookPenSubBarOpen = false;
      state.notebookPenSubBarOverlayId = "";
      renderStage();
      renderOverlayInspector(false);
    });
    subBar.appendChild(btn);
  });

  const colorBtn = document.createElement("button");
  colorBtn.type = "button";
  colorBtn.className = "overlay-write-tool notebook-pen-sub-btn notebook-pen-color-btn";
  colorBtn.title = "Pen color";
  const currentColor = sanitizeHexColor(overlay.annotationColor, "#000000");
  colorBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${currentColor}" stroke="rgba(0,0,0,0.25)" stroke-width="1"/></svg>`;

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = currentColor;
  colorInput.className = "notebook-pen-color-input";
  colorInput.addEventListener("input", (ev) => {
    ev.stopPropagation();
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    target.annotationColor = sanitizeHexColor(colorInput.value, "#000000");
    touch();
    const circle = colorBtn.querySelector("circle");
    if (circle) {
      circle.setAttribute("fill", target.annotationColor);
    }
  });
  colorInput.addEventListener("change", (ev) => {
    ev.stopPropagation();
    state.notebookPenSubBarOpen = false;
    state.notebookPenSubBarOverlayId = "";
    renderStage();
    renderOverlayInspector(false);
  });
  colorBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    colorInput.click();
  });
  subBar.appendChild(colorBtn);
  subBar.appendChild(colorInput);

  penWrap.appendChild(subBar);
  bar.appendChild(penWrap);

  addBtn("↔", "Navigation mode (move the overlay or change pages without writing)", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    ensureOverlayNotebookDefaults(target);
    target.notebookMode = "navigate";
    target.notebookModeExplicit = true;
    refreshAfterNotebookChange();
  }, overlay.notebookMode === "navigate", "overlay-notebook-navigate-toggle");

  addBtn("⌫", "Eraser mode", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    ensureOverlayNotebookDefaults(target);
    target.notebookMode = "eraser";
    target.notebookModeExplicit = true;
    refreshAfterNotebookChange();
  }, overlay.notebookMode === "eraser");

  const bgMode = getNotebookPageBackgroundMode(getOverlayNotebookCurrentPage(overlay));
  const bgLabel = bgMode === "transparent"
    ? "Bg:T"
    : (bgMode === "black" ? "Bg:B" : "Bg:W");
  addBtn(bgLabel, "Cycle notebook background: transparent, black, white", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    ensureOverlayNotebookDefaults(target);
    cycleNotebookPageBackgroundMode(target);
    refreshAfterNotebookChange();
  }, false, "overlay-notebook-bg-toggle");

  addBtn("↶", "Undo the last pen stroke on this page", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    if (undoOverlayNotebookStroke(target)) {
      refreshAfterNotebookChange();
    }
  });

  addBtn("⊠", "Clear drawing on current page", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    clearOverlayNotebookCurrentDrawing(target);
    refreshAfterNotebookChange();
  });

  addBtn("Shadow", "Toggle translucent previous page underlay", () => {
    const target = findOverlay(overlay.id);
    if (!target) {
      return;
    }
    ensureOverlayNotebookDefaults(target);
    target.notebookShadowEnabled = !target.notebookShadowEnabled;
    refreshAfterNotebookChange();
  }, !!overlay.notebookShadowEnabled, "overlay-notebook-shadow-toggle");

  const pageInfo = document.createElement("span");
  pageInfo.className = "overlay-notebook-page-info";
  pageInfo.textContent = `${overlay.notebookPageIndex + 1}/${overlay.notebookPages.length}`;
  bar.appendChild(pageInfo);

  return bar;
}

function bindNotebookOverlayHoverUi(overlayEl) {
  if (!overlayEl) {
    return;
  }

  const setClass = (className, active) => {
    overlayEl.classList.toggle(className, !!active);
  };

  overlayEl.addEventListener("mousemove", (ev) => {
    const rect = overlayEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    setClass("notebook-near-left", x <= NOTEBOOK_EDGE_HIT_PX);
    setClass("notebook-near-right", x >= (rect.width - NOTEBOOK_EDGE_HIT_PX));
    setClass("notebook-near-bottom", y >= (rect.height - NOTEBOOK_BOTTOM_HIT_PX));
  });

  overlayEl.addEventListener("mouseleave", () => {
    setClass("notebook-near-left", false);
    setClass("notebook-near-right", false);
    setClass("notebook-near-bottom", false);
  });
}

function bindOverlayToolbarVisibility(overlayEl) {
  if (!overlayEl) {
    return;
  }
  const overlayId = overlayEl.dataset.overlayId || "";
  if (!overlayId) {
    return;
  }

  const clearHideTimer = () => {
    const t = overlayToolbarTimers.get(overlayId);
    if (t) {
      clearTimeout(t);
      overlayToolbarTimers.delete(overlayId);
    }
  };

  const show = () => {
    clearHideTimer();
    overlayEl.classList.add("annotation-tools-visible");
  };

  const scheduleHide = () => {
    clearHideTimer();
    const t = setTimeout(() => {
      overlayEl.classList.remove("annotation-tools-visible");
      overlayEl.classList.remove("annotation-near-bottom");
      overlayToolbarTimers.delete(overlayId);
    }, OVERLAY_TOOLBAR_LINGER_MS);
    overlayToolbarTimers.set(overlayId, t);
  };

  const setNearBottom = (active) => {
    overlayEl.classList.toggle("annotation-near-bottom", !!active);
  };

  const onMove = (ev) => {
    const rect = overlayEl.getBoundingClientRect();
    const localY = ev.clientY - rect.top;
    const nearBottomPx = 56;
    if (localY >= rect.height - nearBottomPx) {
      setNearBottom(true);
      show();
    } else {
      setNearBottom(false);
      scheduleHide();
    }
  };

  overlayEl.addEventListener("mouseenter", onMove);
  overlayEl.addEventListener("mousemove", onMove);
  overlayEl.addEventListener("mouseleave", scheduleHide);

  const bar = overlayEl.querySelector(".overlay-write-tools");
  if (bar) {
    bar.addEventListener("mouseenter", show);
    bar.addEventListener("mouseleave", scheduleHide);
  }
}

function buildOverlayVideoControls(overlay, videoEl) {
  if (!overlay || !videoEl) {
    return null;
  }

  const bar = document.createElement("div");
  bar.className = "overlay-video-controls";
  bar.dataset.overlayId = overlay.id;

  const makeBtn = (label, title, handler) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      handler();
    });
    bar.appendChild(btn);
    return btn;
  };

  makeBtn("Play", "Play video", async () => {
    try {
      await videoEl.play();
    } catch {
      dom.modeHint.textContent = "Playback blocked by browser policy. Click the video first, then press Play.";
    }
  });

  makeBtn("Pause", "Pause video", () => {
    videoEl.pause();
  });

  makeBtn("Reset", "Reset to beginning", () => {
    videoEl.pause();
    videoEl.currentTime = 0;
  });

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "overlay-video-slider";
  slider.min = "0";
  slider.max = "1000";
  slider.step = "1";
  slider.value = "0";

  const updateSliderFromVideo = () => {
    const duration = Number(videoEl.duration || 0);
    const time = Number(videoEl.currentTime || 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      slider.value = "0";
      return;
    }
    slider.value = String(Math.round((time / duration) * 1000));
  };

  slider.addEventListener("input", (ev) => {
    ev.stopPropagation();
    const duration = Number(videoEl.duration || 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const ratio = safeClampNumber(slider.value, 0, 1000, 0) / 1000;
    videoEl.currentTime = ratio * duration;
  });

  videoEl.addEventListener("timeupdate", updateSliderFromVideo);
  videoEl.addEventListener("loadedmetadata", updateSliderFromVideo);
  videoEl.addEventListener("durationchange", updateSliderFromVideo);

  bar.appendChild(slider);

  for (const eventName of ["mousedown", "click", "dblclick", "pointerdown", "pointerup", "wheel"]) {
    bar.addEventListener(eventName, (ev) => {
      ev.stopPropagation();
    });
  }

  return bar;
}

function bindOverlayVideoControlsVisibility(overlayEl, controlsEl) {
  if (!overlayEl || !controlsEl) {
    return;
  }

  let hideTimer = null;
  const clearHideTimer = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const showControls = () => {
    clearHideTimer();
    overlayEl.classList.add("video-controls-visible");
  };

  const scheduleHide = () => {
    clearHideTimer();
    hideTimer = setTimeout(() => {
      overlayEl.classList.remove("video-controls-visible");
      hideTimer = null;
    }, 900);
  };

  overlayEl.addEventListener("mousemove", (ev) => {
    const rect = overlayEl.getBoundingClientRect();
    const localY = ev.clientY - rect.top;
    const nearBottomPx = 58;
    if (localY >= rect.height - nearBottomPx) {
      showControls();
    } else {
      scheduleHide();
    }
  });

  overlayEl.addEventListener("mouseleave", () => {
    overlayEl.classList.remove("video-controls-visible");
    clearHideTimer();
  });

  controlsEl.addEventListener("mouseenter", showControls);
  controlsEl.addEventListener("mouseleave", scheduleHide);
}

function openZoomForOverlay(overlay) {
  const source = resolveAssetByAnyId(overlay.sourceId);
  if (!source) {
    return;
  }
  dom.zoomViewport.innerHTML = "";

  if (source.kind === "overlay-image") {
    const img = document.createElement("img");
    img.src = getImageDisplayUrl(source);
      img.style.objectFit = "contain";
      img.style.width = "100%";
      img.style.height = "100%";
    dom.zoomViewport.appendChild(img);
  } else if (source.kind === "overlay-sequence") {
    ensureOverlaySequenceSourceDefaults(source);
    const frameIndex = normalizeOverlaySequenceIndex(overlay.sequenceIndex, source.frames.length);
    const frame = source.frames[frameIndex] || source.frames[0] || null;
    if (frame?.dataUrl) {
      const img = document.createElement("img");
      img.src = getImageDisplayUrl(frame);
      img.style.objectFit = "contain";
      img.style.width = "100%";
      img.style.height = "100%";
      dom.zoomViewport.appendChild(img);
    }
  } else if (source.kind === "overlay-video") {
    const video = document.createElement("video");
    video.src = source.dataUrl;
    video.controls = true;
    video.loop = false;
    video.muted = false;
    video.autoplay = false;
    video.playsInline = true;
    dom.zoomViewport.appendChild(video);
  } else if (source.kind === "overlay-text") {
    ensureOverlayTextSourceDefaults(source);
    const text = document.createElement("div");
    text.className = "zoom-text-preview";
    text.innerHTML = source.html || "";
    text.style.fontFamily = source.font || "Arial, sans-serif";
    text.style.setProperty("--tx-size", `${slidePointsToPx(source.fontSize) * 2}px`);
    text.style.setProperty("--tx-line", String(safeClampNumber(source.lineHeight, 0.8, 3, 1.25)));
    text.style.fontWeight = source.bold ? "700" : "400";
    text.style.fontStyle = source.italic ? "italic" : "normal";
    text.style.textDecoration = source.underline ? "underline" : "none";
    text.style.color = sanitizeHexColor(source.color, "#000000");
    text.style.textAlign = source.align;
    text.classList.toggle("has-shade", !!source.shaded);
    if (source.shaded) {
      text.style.backgroundColor = hexToRgba(source.fillColor, source.fillOpacity);
    }
    dom.zoomViewport.appendChild(text);
  } else if (source.kind === "overlay-pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = getPdfDisplayUrl(source);
    iframe.removeAttribute("sandbox");
    dom.zoomViewport.appendChild(iframe);
  } else if (source.kind === "overlay-html-file") {
    const iframe = document.createElement("iframe");
    iframe.srcdoc = source.htmlText;
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-pointer-lock");
    dom.zoomViewport.appendChild(iframe);
  } else if (source.kind === "overlay-html-external" || source.kind === "overlay-html-filelink") {
    const iframe = document.createElement("iframe");
    if (source.kind === "overlay-html-filelink") {
      const filelinkUrl = resolveHtmlFileLinkUrl(source);
      if (filelinkUrl) {
        // Always load from the live file URL so edits to the file are reflected.
        // Only cache-bust for http(s) — file:// URLs never cache and don't support query strings.
        const isHttp = /^https?:/i.test(filelinkUrl);
        iframe.src = isHttp
          ? (filelinkUrl.includes("?") ? `${filelinkUrl}&_t=${Date.now()}` : `${filelinkUrl}?_t=${Date.now()}`)
          : filelinkUrl;
        iframe.removeAttribute("sandbox");
        iframe.referrerPolicy = "no-referrer-when-downgrade";
      } else if (source.htmlText) {
        // Fallback: URL could not be resolved — show stored snapshot.
        iframe.srcdoc = source.htmlText;
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-pointer-lock");
      }
    } else {
      iframe.src = source.url;
      iframe.removeAttribute("sandbox");
      iframe.referrerPolicy = "no-referrer-when-downgrade";
    }
    dom.zoomViewport.appendChild(iframe);
  }

  dom.zoomModal.classList.remove("hidden");
}

function closeZoom() {
  dom.zoomModal.classList.add("hidden");
  dom.zoomViewport.innerHTML = "";
}

function initManualWindow() {
  if (!dom.manualScroller || !dom.manualDialog) {
    return;
  }
  dom.manualScroller.innerHTML = getManualHtml();
  applyManualWindowRect();
}

function initAboutWindow() {
  if (!dom.aboutScroller) {
    return;
  }
  dom.aboutScroller.innerHTML = getAboutHtml();
}

function buildEmptyOverlaySourceQuickAccess(overlay) {
  const panel = document.createElement("div");
  panel.className = "overlay-empty-quick-access";

  panel.addEventListener("mousedown", (e) => e.stopPropagation());
  panel.addEventListener("click", (e) => e.stopPropagation());

  const title = document.createElement("div");
  title.className = "overlay-empty-quick-access-title";
  title.textContent = "Empty overlay";

  const help = document.createElement("div");
  help.className = "overlay-empty-quick-access-help";
  help.textContent = "Assign an existing source or add a new one directly here.";

  const select = document.createElement("select");
  select.className = "overlay-empty-source-select";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Assign existing source...";
  select.appendChild(placeholder);
  getOverlayAssetEntries().forEach(({ key, asset }) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${asset.name} [${sourceTypeLabel(asset.kind)}]`;
    select.appendChild(option);
  });
  select.addEventListener("change", () => {
    if (!select.value) {
      return;
    }
    assignSourceToOverlayById(overlay.id, select.value);
    renderSources();
    renderOverlayInspector();
    renderStage();
  });

  const quickRow = document.createElement("div");
  quickRow.className = "overlay-empty-quick-buttons";

  const buttons = [
    { label: "Add images", action: () => { setPendingOverlaySourceTarget(overlay.id); dom.importOverlayImageInput.click(); } },
    { label: "Add sequence", action: () => { setPendingOverlaySourceTarget(overlay.id); dom.importOverlaySequenceInput.click(); } },
    { label: "Add video", action: () => { setPendingOverlaySourceTarget(overlay.id); dom.importOverlayVideoInput.click(); } },
    { label: "Add PDF", action: () => { setPendingOverlaySourceTarget(overlay.id); dom.importOverlayPdfInput.click(); } },
    { label: "Add HTML file", action: () => { setPendingOverlaySourceTarget(overlay.id); dom.importOverlayHtmlInput.click(); } },
    { label: "Add HTML link", action: () => { setPendingOverlaySourceTarget(overlay.id); dom.addHtmlFileLinkInput.click(); } },
    {
      label: "Notebook Panel",
      action: () => {
        if (!state.deckSessionReady) { return; }
        setPendingOverlaySourceTarget(overlay.id);
        addNotebookPanelSource();
      },
    },
    {
      label: "Notes Board",
      action: () => {
        if (!state.deckSessionReady) { return; }
        setPendingOverlaySourceTarget(overlay.id);
        addNotesBoardSource();
      },
    },
  ];

  buttons.forEach(({ label, action }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overlay-empty-quick-btn";
    button.textContent = label;
    button.addEventListener("click", action);
    quickRow.appendChild(button);
  });

  panel.append(title, help, select, quickRow);
  return panel;
}

function openManual() {
  if (!dom.manualModal) {
    return;
  }
  applyManualWindowRect();
  dom.manualModal.classList.remove("hidden");
}

function closeManual() {
  if (!dom.manualModal) {
    return;
  }
  dom.manualModal.classList.add("hidden");
  state.manualDragCtx = null;
  state.manualResizeCtx = null;
}

function openAbout() {
  if (!dom.aboutModal) {
    return;
  }
  dom.aboutModal.classList.remove("hidden");
}

function closeAbout() {
  if (!dom.aboutModal) {
    return;
  }
  dom.aboutModal.classList.add("hidden");
}

function startManualDrag(e) {
  if (!dom.manualModal || dom.manualModal.classList.contains("hidden")) {
    return;
  }
  if (e.button !== 0) {
    return;
  }
  if (e.target instanceof Element && e.target.closest("#manualCloseBtn")) {
    return;
  }
  state.manualDragCtx = {
    startX: e.clientX,
    startY: e.clientY,
    baseX: state.manualWindowRect.x,
    baseY: state.manualWindowRect.y,
  };
  e.preventDefault();
}

function startManualResize(e) {
  if (!dom.manualModal || dom.manualModal.classList.contains("hidden")) {
    return;
  }
  if (e.button !== 0) {
    return;
  }
  state.manualResizeCtx = {
    startX: e.clientX,
    startY: e.clientY,
    baseW: state.manualWindowRect.w,
    baseH: state.manualWindowRect.h,
  };
  e.preventDefault();
}

function onManualPointerMove(e) {
  if (!state.manualDragCtx && !state.manualResizeCtx) {
    return;
  }

  if (state.manualDragCtx) {
    const dx = e.clientX - state.manualDragCtx.startX;
    const dy = e.clientY - state.manualDragCtx.startY;
    const maxX = Math.max(0, window.innerWidth - state.manualWindowRect.w);
    const maxY = Math.max(0, window.innerHeight - state.manualWindowRect.h);
    state.manualWindowRect.x = clamp(state.manualDragCtx.baseX + dx, 0, maxX);
    state.manualWindowRect.y = clamp(state.manualDragCtx.baseY + dy, 0, maxY);
    applyManualWindowRect();
    e.preventDefault();
    return;
  }

  if (state.manualResizeCtx) {
    const dw = e.clientX - state.manualResizeCtx.startX;
    const dh = e.clientY - state.manualResizeCtx.startY;
    const maxW = Math.max(MANUAL_MIN_WIDTH, window.innerWidth - state.manualWindowRect.x);
    const maxH = Math.max(MANUAL_MIN_HEIGHT, window.innerHeight - state.manualWindowRect.y);
    state.manualWindowRect.w = clamp(state.manualResizeCtx.baseW + dw, MANUAL_MIN_WIDTH, maxW);
    state.manualWindowRect.h = clamp(state.manualResizeCtx.baseH + dh, MANUAL_MIN_HEIGHT, maxH);
    applyManualWindowRect();
    e.preventDefault();
  }
}

function onManualPointerUp() {
  state.manualDragCtx = null;
  state.manualResizeCtx = null;
}

function applyManualWindowRect() {
  if (!dom.manualDialog) {
    return;
  }
  const minW = Math.min(MANUAL_MIN_WIDTH, Math.max(320, window.innerWidth - 20));
  const minH = Math.min(MANUAL_MIN_HEIGHT, Math.max(260, window.innerHeight - 20));
  state.manualWindowRect.w = clamp(state.manualWindowRect.w, minW, Math.max(minW, window.innerWidth));
  state.manualWindowRect.h = clamp(state.manualWindowRect.h, minH, Math.max(minH, window.innerHeight));
  state.manualWindowRect.x = clamp(state.manualWindowRect.x, 0, Math.max(0, window.innerWidth - state.manualWindowRect.w));
  state.manualWindowRect.y = clamp(state.manualWindowRect.y, 0, Math.max(0, window.innerHeight - state.manualWindowRect.h));
  dom.manualDialog.style.left = `${Math.round(state.manualWindowRect.x)}px`;
  dom.manualDialog.style.top = `${Math.round(state.manualWindowRect.y)}px`;
  dom.manualDialog.style.width = `${Math.round(state.manualWindowRect.w)}px`;
  dom.manualDialog.style.height = `${Math.round(state.manualWindowRect.h)}px`;
}

function getManualHtml() {
  return `
    <section class="manual-section">
      <h3>1. Purpose of the app</h3>
      <p>Interactive Presenter v4 is designed to turn static slide decks into interactive teaching and presentation scenes. You can place simulations, videos, image overlays, and HTML tools on top of normal slides, then present everything in one controlled flow.</p>
      <p>The core idea is simple: slides are the background, overlays are the dynamic layer. This lets you teach from structured slides while live content stays responsive.</p>
    </section>

    <section class="manual-section">
      <h3>2. Getting started quickly</h3>
      <ol>
        <li>Open v4 and set a deck title in the Deck panel.</li>
        <li>Import slide images in the Slides panel.</li>
        <li>Select a slide from the list.</li>
        <li>Import overlay sources (images, video, HTML).</li>
        <li>Click Draw overlay and drag on the slide.</li>
        <li>Assign a Source to the new overlay in Overlay Editor.</li>
        <li>Switch to Present mode and test navigation and interactions.</li>
        <li>Save your deck (.ipe) when the layout works.</li>
      </ol>
    </section>

    <section class="manual-section">
      <h3>3. Exporting slides from PowerPoint (SVG-first)</h3>
      <p>Best quality comes from SVG exports because text and line art remain sharp at any zoom level.</p>
      <ol>
        <li>In PowerPoint, choose Save As and select SVG for each slide, or use export workflows that produce SVG pages.</li>
        <li>If SVG is not practical, export high-resolution PNG (for example 1920x1080 or higher).</li>
        <li>Avoid low-resolution JPG for text-heavy slides because compression artifacts become visible.</li>
        <li>Use stable slide names (for example 01_intro, 02_model) so remap can match slides reliably later.</li>
      </ol>
      <p>Tip: keep all exported slide assets in one folder per lecture version to reduce accidental remap mismatches.</p>
    </section>

    <section class="manual-section">
      <h3>4. Adding, deleting, reordering, and overwriting slides</h3>
      <p>The Slides list is your control center for deck structure.</p>
      <ul>
        <li><strong>Add:</strong> use Import slide images in the Slides panel.</li>
        <li><strong>Delete:</strong> use the delete control on a slide row.</li>
        <li><strong>Reorder:</strong> drag slide rows to new positions.</li>
        <li><strong>Overwrite:</strong> use overwrite on a slide row to replace background image while preserving overlays.</li>
        <li><strong>Duplicate:</strong> duplicate a slide when you need a variant.</li>
      </ul>
      <p>Overwrite is especially useful when revising lecture visuals while keeping carefully placed interactive overlays.</p>
    </section>

    <section class="manual-section">
      <h3>5. Adding overlays</h3>
      <ol>
        <li>Import one or more overlay sources in Overlay Sources.</li>
        <li>Click Draw overlay.</li>
        <li>Drag a rectangle on the stage where content should appear.</li>
        <li>Select that overlay and assign a source in Overlay Editor.</li>
        <li>Fine-tune X, Y, W, H or drag/resize directly.</li>
      </ol>
      <p>You can stack multiple overlays and control their depth with Move forward and Move backward.</p>
      <p>If an overlay is empty, v4 now shows a quick-access panel directly inside it. From there you can assign an existing source immediately or add images, video, HTML files, and HTML file links without going back to the sidebar first.</p>
    </section>

    <section class="manual-section">
      <h3>6. Overlay source types and when to use them</h3>
      <ul>
        <li><strong>Images:</strong> static figures, schematics, legends, logos.</li>
        <li><strong>Video:</strong> demonstrations, experiments, time-series clips.</li>
        <li><strong>HTML file:</strong> packaged interactive tools embedded with the deck.</li>
        <li><strong>HTML file link:</strong> points to a live file path so edits update immediately.</li>
        <li><strong>Notes board:</strong> embedded rich-text panel for lecture notes. Its size and theme are stored in the deck, so the same board looks the same on any machine.</li>
        <li><strong>Notebook panel:</strong> paged notes with typing and pen ink. Ink is stored as vector strokes, so it stays sharp when the panel or the screen is resized.</li>
        <li><strong>Text box:</strong> free text placed straight on the slide with the Text tool.</li>
      </ul>
      <p>For frequently updated simulations, HTML file link is convenient during development.</p>
      <p>The Overlay Sources panel also includes Clear sources. This removes all overlay-source assets from the source library and clears source assignments from overlays. Use it carefully when resetting a deck structure.</p>
    </section>

    <section class="manual-section">
      <h3>6b. Text on the slide</h3>
      <p><strong>Text boxes.</strong> Press <em>Text</em>, then click the slide to drop a box or drag to set its width. Click straight into any existing box to put the caret where you clicked; drag the grip above the box, its border, or Ctrl-drag anywhere to move it. Esc leaves the box and keeps it selected; an empty box is discarded when you leave it.</p>
      <p><strong>Sizes are slide points.</strong> Text is authored against a 960-point reference slide and rendered as a fraction of the live stage, so a box reads the same while editing, while presenting, and on a projector of any resolution. Sizes run from 6 to 240, not the old 9&ndash;24.</p>
      <p><strong>Formatting follows the selection.</strong> With text selected, Bold/Italic/Underline, colour, size, sub- and superscript apply to that run only. With nothing selected they apply to the whole box, and conflicting inline runs are cleared so the box-level change actually shows. Either way the choice becomes the default for the next box you create.</p>
      <p><strong>Shortcuts inside a box:</strong> Ctrl+B / Ctrl+I / Ctrl+U, Ctrl+Shift+&gt; and Ctrl+Shift+&lt; to grow and shrink, Ctrl+, and Ctrl+. for sub- and superscript, Ctrl+Shift+L for bullets, Ctrl+A to select the box contents only, Tab to indent. Arrow keys, Delete and Space edit text and no longer move the deck.</p>
      <p><strong>Bullet styles.</strong> The • ≡ button toggles a list on/off as before; the picker next to it sets the marker for the box: ● circle, – dash, › chevron, ◆ diamond, ◉ glow (halo dot), ▬ bar (accent bar), // slash, ✦ spark or 01 numbers (editorial 01 02 03). The choice follows the text colour and size, is saved per box, and also becomes the default for the next box.</p>
      <p><strong>Autofit</strong> has three settings: <em>Grow</em> resizes the box to its text, <em>Shrink</em> scales the text down to fit, <em>Off</em> lets the box scroll. Vertical anchor places the text at the top, middle or bottom of the box.</p>
      <p><strong>While presenting,</strong> press T then click to drop a note; the text toolbar floats over the stage. Ctrl+wheel resizes the note, a plain wheel scrolls it. Esc leaves the note, and an empty one is discarded.</p>
      <p><strong>Pasting</strong> keeps bold, italics and lists but drops fonts, images and layout markup that would fight the slide design. Shift+paste inserts plain text.</p>
    </section>

    <section class="manual-section">
      <h3>7. Overlay editing controls</h3>
      <ul>
        <li><strong>Framed/Shaded:</strong> controls visual treatment of overlay container.</li>
        <li><strong>Locked:</strong> prevents accidental movement in presenter mode.</li>
        <li><strong>Key control:</strong> reserves keyboard handling for one selected interactive overlay.</li>
        <li><strong>Pen:</strong> enables drawing annotations on top of an overlay.</li>
        <li><strong>Opacity:</strong> fade overlay in or out relative to slide.</li>
        <li><strong>Local zoom:</strong> zoom only that overlay, independent of global scale.</li>
      </ul>
    </section>

    <section class="manual-section">
      <h3>8. Scale workflow: global vs local</h3>
      <p>Use Global embedded content scale to set a deck-wide baseline. Then use Local zoom for exceptions where one overlay needs tighter focus.</p>
      <p>Scale lock modes help keep content visually consistent across projector, laptop, and classroom displays.</p>
    </section>

    <section class="manual-section">
      <h3>9. Animation events</h3>
      <p>Animation Events let overlays appear/disappear by click steps or with previous events.</p>
      <ol>
        <li>Select an overlay.</li>
        <li>Add event type (appear/remove, after click/with previous).</li>
        <li>Use Prev step, Next step, Reset to test sequence.</li>
        <li>Enable autoplay and set delay when desired.</li>
      </ol>
    </section>

    <section class="manual-section">
      <h3>10. Presenter mode workflow</h3>
      <ul>
        <li>Enter Presenter mode from top bar.</li>
        <li>Use arrow keys, PageUp/PageDown, or navigation controls.</li>
        <li>Space advances animation steps (Shift+Space reverses step).</li>
        <li>F5 enters fullscreen quickly.</li>
        <li>Escape exits fullscreen/presenter and returns to edit workflow.</li>
      </ul>
    </section>

    <section class="manual-section">
      <h3>11. Saving, loading, and deck portability</h3>
      <ul>
        <li><strong>Save:</strong> writes to the current .ipe file when there is one; a deck opened from an older .zip is saved as a new .ipe next to it.</li>
        <li><strong>Save As:</strong> choose a new .ipe file name and location.</li>
        <li><strong>Load:</strong> opens an .ipe deck with its complete state (older .zip decks: pick "Older deck (.zip)" as the file type).</li>
      </ul>
      <p>Recommended habit: keep milestone .ipe files per lecture date/version for rollback safety.</p>
    </section>

    <section class="manual-section">
      <h3>12. Troubleshooting</h3>
      <ul>
        <li><strong>External pages fail to embed:</strong> many sites block iframe embedding via security headers. Use local HTML files or the Open action fallback.</li>
        <li><strong>Equation rendering fails:</strong> check whether math libraries are loaded from allowed paths and prefer local dependencies for portability.</li>
        <li><strong>Overlay looks blurry:</strong> use SVG or higher-resolution slide assets and adjust scale lock mode.</li>
        <li><strong>Wrong overlay positions after slide update:</strong> use remap carefully and verify each critical slide.</li>
      </ul>
    </section>

    <section class="manual-section">
      <h3>13. Recommended teaching workflow</h3>
      <ol>
        <li>Prepare slides and export consistently.</li>
        <li>Build overlays on key slides only first.</li>
        <li>Add animations after layout stabilizes.</li>
        <li>Run a full presenter rehearsal.</li>
        <li>Save the production .ipe and a backup .ipe.</li>
      </ol>
      <p>This sequence minimizes late-stage breakage and keeps lecture delivery smooth.</p>
    </section>

    <section class="manual-section">
      <h3>14. Floating toolbar (edit mode)</h3>
      <p>In edit mode, a floating quick-command toolbar is available for the most common actions: Save, Save As, Draw Overlay, Move Forward, Move Backward, style submenu, local zoom slider, and Appear after click.</p>
      <ul>
        <li>Use the top-bar <strong>Tools</strong> button to show or hide the floating toolbar.</li>
        <li>Use the <strong>&times;</strong> button on the toolbar to remove it quickly from the stage area.</li>
        <li>The style submenu includes Framed, Pen, Key control, Shaded, and Locked toggles for the selected overlay.</li>
        <li>The zoom slider controls local zoom for the selected overlay only.</li>
      </ul>
      <p>Overlay-dependent controls are enabled only when an overlay is selected.</p>
    </section>
  `;
}

function getAboutHtml() {
  return `
    <section class="manual-section">
      <h3>People credits, acknowledgements and references</h3>
      <p>Put portrait photos in a <b>People</b> folder next to the presenter file, named <b>Full Name (Affiliation).png</b> or <b>.jpg</b> (e.g. "Nini Pryds (DTU Energy).jpg"). Portraits are always loaded by relative path, so the presenter keeps working when moved together with the folder.</p>
      <ol>
        <li>In the People &amp; Credits panel, click <b>Scan People folder</b> once and pick the People folder. The list is cached and restores automatically on every startup; re-scan after adding new photos (browsers cannot list a local folder without this one click).</li>
        <li>On any slide, tick <b>Credits on this slide</b> (corner strip, in checked order) or <b>Acknowledgements on this slide</b> (centered columns grouped by affiliation), then check people in the movable picker window. Untick to start the order over.</li>
        <li>Format is deck-global so every slide matches: corner position, full/last name, affiliation line, and separate zooms for credits, acknowledgement portraits and the acknowledgement area. <b>Invert</b> is per-slide and turns the text white for dark slides.</li>
        <li>The <b>References</b> field types a per-slide reference line shown at the very bottom of the slide, with a global zoom and per-slide invert.</li>
      </ol>
      <p>Which people appear on which slide is stored in the deck, so a saved .ipe shows the right credits on any machine that has the People folder next to the presenter.</p>
    </section>

    <section class="manual-section">
      <h3>Prototype notice</h3>
      <p>${PROTOTYPE_NOTICE[0]}</p>
      <p>${PROTOTYPE_NOTICE[1]}</p>
      <p>${PROTOTYPE_NOTICE[2]}</p>
      <p>${PROTOTYPE_NOTICE[3]}</p>
    </section>
  `;
}

// ── Autosave ────────────────────────────────────────────────────────────────

const AUTOSAVE_INTERVAL_MS = 300_000;

// The deck's own file type. .ipe is the native format (a renamed zip): Save, Save As and the autosave
// backup write it; Load shows it first and older .zip decks under a second file type.
const IPE_FILE_TYPE = { description: "Interactive Presenter deck (.ipe)", accept: { "application/zip": [".ipe"] } };
const LEGACY_ZIP_FILE_TYPE = { description: "Older deck (.zip)", accept: { "application/zip": [".zip"] } };

function getAutosaveSuggestedName() {
  return `${deckFileBase(state.deck.meta.title)}.bak.ipe`;
}

async function enableAutosave(options = {}) {
  const forcePick = !!options.forcePick;

  if (state.autosaveFileHandle && !forcePick) {
    state.autosaveEnabled = true;
    if (dom.autosaveEnabledCheckbox) dom.autosaveEnabledCheckbox.checked = true;
    startAutosaveTimer();
    setAutosaveHint(`Autosave active -> ${state.autosaveFileHandle.name}`);
    return;
  }

  if (typeof window.showSaveFilePicker !== "function") {
    setAutosaveHint("File System Access API not available in this browser. Autosave unavailable.");
    if (dom.autosaveEnabledCheckbox) dom.autosaveEnabledCheckbox.checked = false;
    state.autosaveEnabled = false;
    return;
  }

  try {
    const pickerOpts = {
      suggestedName: getAutosaveSuggestedName(),
      types: [IPE_FILE_TYPE],
    };
    if (state.currentZipFileHandle) {
      pickerOpts.startIn = state.currentZipFileHandle;
    }
    const handle = await window.showSaveFilePicker(pickerOpts);
    state.autosaveFileHandle = handle;
    state.autosaveEnabled = true;
    if (dom.autosaveEnabledCheckbox) dom.autosaveEnabledCheckbox.checked = true;
    setAutosaveHint(`Autosave active -> ${handle.name}`);
    startAutosaveTimer();
    await doAutosave(); // save immediately
  } catch (err) {
    state.autosaveEnabled = false;
    if (dom.autosaveEnabledCheckbox) dom.autosaveEnabledCheckbox.checked = false;
    if (err && err.name === "AbortError") {
      setAutosaveHint("Autosave cancelled.");
    } else {
      // Real failure (SecurityError, NotAllowedError, etc.) — surface it so
      // the user knows why the backup dialog never appeared, instead of the
      // old bare "catch {}" that silently unchecked the box.
      console.warn("Autosave file picker failed:", err);
      setAutosaveHint(`Autosave unavailable: ${err?.message || err?.name || "picker refused"}. Re-tick the Autosave box to retry.`);
    }
  }
}

function clearAutosaveTimerOnly() {
  if (state.autosaveTimer) {
    clearInterval(state.autosaveTimer);
    state.autosaveTimer = null;
  }
}

function resetAutosaveTargetKeepSelection() {
  clearAutosaveTimerOnly();
  state.autosaveFileHandle = null;
  const selected = !!dom.autosaveEnabledCheckbox?.checked;
  state.autosaveEnabled = selected;
  if (selected) {
    setAutosaveHint(`Autosave ON. Backup file defaults to ${getAutosaveSuggestedName()}.`);
  } else {
    setAutosaveHint("Autosave inactive.");
  }
}

function startAutosaveTimer() {
  clearAutosaveTimerOnly();
  state.autosaveTimer = setInterval(async () => {
    if (state.autosaveEnabled && state.autosaveFileHandle) {
      await doAutosave();
    }
  }, AUTOSAVE_INTERVAL_MS);
}

function stopAutosaveTimer() {
  clearAutosaveTimerOnly();
  state.autosaveEnabled = false;
  state.autosaveFileHandle = null;
  if (dom.autosaveEnabledCheckbox) dom.autosaveEnabledCheckbox.checked = false;
  setAutosaveHint("Autosave inactive.");
}

/* ─── Unpacked asset storage (separate files in the zip) ──────────────────────
 * When deck.settings.unpackedAssets is on, binary payloads (image/video dataUrls,
 * sim htmlText, sequence frames) are written as separate files under assets/… and
 * the manifest keeps only a small `bundlePath` reference. Mirrors deck_tool.py. */
const BUNDLE_MIME_EXT = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/gif": ".gif",
  "image/svg+xml": ".svg", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm",
  "video/ogg": ".ogv", "video/quicktime": ".mov", "text/html": ".html", "application/pdf": ".pdf",
};
const BUNDLE_KIND_DIR = {
  "slide-image": "assets/images", "overlay-image": "assets/images",
  "overlay-video": "assets/video",
  "overlay-html-file": "assets/sims", "overlay-html-filelink": "assets/sims",
};

function parseBase64DataUrl(dataUrl) {
  const m = /^data:([^;,]*);base64,(.*)$/s.exec(String(dataUrl || ""));
  if (!m) return null;
  return { mime: m[1], b64: m[2] };
}

// Filesystem-safe name that PRESERVES dots (so extensions survive) — mirrors
// deck_tool.py, unlike sanitizeFileName() which collapses dots to underscores.
function bundleSanitizeName(name) {
  return String(name || "asset")
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 80) || "asset";
}

function bundleFileName(asset) {
  const id = bundleSanitizeName(asset.id || "asset");
  let name = bundleSanitizeName(asset.name || asset.kind || "asset");
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    name += BUNDLE_MIME_EXT[String(asset.mime || "").toLowerCase()] || "";
  }
  return `${id}__${name}`;
}

// Externalize inline payloads into files inside `zip`, mutating the (cloned) deck
// manifest to carry bundlePath references instead. Returns the number of files.
function externalizeDeckAssetsIntoZip(deck, zip) {
  const assets = deck.assets || {};
  let count = 0;
  for (const asset of Object.values(assets)) {
    if (!asset || typeof asset !== "object") continue;
    const kind = asset.kind;
    if (asset.dataUrl && kind !== "overlay-sequence") {
      const parsed = parseBase64DataUrl(asset.dataUrl);
      const dir = BUNDLE_KIND_DIR[kind] || "assets/images";
      if (parsed) {
        const path = `${dir}/${bundleFileName(asset)}`;
        zip.file(path, parsed.b64, { base64: true });
        asset.bundlePath = path;
        delete asset.dataUrl;
        count++;
      }
    }
    if (asset.htmlText && (kind === "overlay-html-file" || kind === "overlay-html-filelink")) {
      let fname = bundleFileName(asset);
      if (!/\.html$/i.test(fname)) fname += ".html";
      const path = `assets/sims/${fname}`;
      zip.file(path, asset.htmlText);
      asset.bundlePath = path;
      delete asset.htmlText;
      count++;
    }
    if (kind === "overlay-sequence" && Array.isArray(asset.frames)) {
      asset.frames.forEach((frame, i) => {
        if (!frame || !frame.dataUrl) return;
        const parsed = parseBase64DataUrl(frame.dataUrl);
        if (!parsed) return;
        let fname = bundleSanitizeName(frame.name || `frame_${i}`);
        if (!/\.[A-Za-z0-9]{1,8}$/.test(fname)) {
          fname += BUNDLE_MIME_EXT[String(asset.mime || "").toLowerCase()] || ".png";
        }
        const path = `assets/sequences/${bundleSanitizeName(asset.id || "seq")}/${String(i).padStart(3, "0")}__${fname}`;
        zip.file(path, parsed.b64, { base64: true });
        frame.bundlePath = path;
        delete frame.dataUrl;
        count++;
      });
    }
  }
  return count;
}

// Remove any stale bundlePath references (used when saving inline).
function stripDeckAssetBundlePaths(deck) {
  for (const asset of Object.values(deck.assets || {})) {
    if (!asset || typeof asset !== "object") continue;
    delete asset.bundlePath;
    for (const frame of asset.frames || []) {
      if (frame && typeof frame === "object") delete frame.bundlePath;
    }
  }
}

// Rehydrate an unpacked deck: read each asset's bundle file from the zip and
// restore dataUrl/htmlText. Returns true if the deck used the unpacked layout.
async function hydrateUnpackedAssets(deck, zip) {
  const assets = deck?.assets;
  if (!assets || typeof assets !== "object" || !zip) return false;
  let unpacked = false;
  for (const asset of Object.values(assets)) {
    if (!asset || typeof asset !== "object") continue;
    const isHtml = asset.kind === "overlay-html-file" || asset.kind === "overlay-html-filelink";
    if (asset.bundlePath && !asset.dataUrl && !asset.htmlText) {
      unpacked = true;
      const entry = zip.file(asset.bundlePath);
      if (entry) {
        if (isHtml) {
          asset.htmlText = await entry.async("string");
        } else {
          const b64 = await entry.async("base64");
          asset.dataUrl = `data:${asset.mime || "application/octet-stream"};base64,${b64}`;
        }
      } else {
        console.warn("Unpacked asset file missing from zip:", asset.bundlePath);
      }
    }
    delete asset.bundlePath;
    if (asset.kind === "overlay-sequence" && Array.isArray(asset.frames)) {
      for (const frame of asset.frames) {
        if (!frame || typeof frame !== "object") continue;
        if (frame.bundlePath && !frame.dataUrl) {
          unpacked = true;
          const entry = zip.file(frame.bundlePath);
          if (entry) {
            const b64 = await entry.async("base64");
            frame.dataUrl = `data:${asset.mime || "application/octet-stream"};base64,${b64}`;
          } else {
            console.warn("Unpacked sequence frame missing from zip:", frame.bundlePath);
          }
        }
        delete frame.bundlePath;
      }
    }
  }
  return unpacked;
}

// Build the deck .zip Blob, honouring the unpacked-assets setting. Shared by
// manual save and autosave.
async function buildDeckZipBlob() {
  // DTUwrite boards that are running hand over their newest board and page pictures first.
  if (window.DtuwriteBoards) await window.DtuwriteBoards.collectAll();
  const packaged = await buildPackagedDeckForSave();
  const zip = new JSZip();
  if (window.DtuwriteBoards) window.DtuwriteBoards.packIntoZip(packaged, zip);
  packaged.packaging = packaged.packaging || {};
  if (state.deck.settings?.unpackedAssets) {
    externalizeDeckAssetsIntoZip(packaged, zip);
    packaged.packaging.assetStorage = "unpacked";
  } else {
    stripDeckAssetBundlePaths(packaged);
    packaged.packaging.assetStorage = "inline";
  }
  zip.file("deck.json", JSON.stringify(packaged, null, 2));
  return zip.generateAsync({ type: "blob" });
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function doAutosave() {
  if (!state.autosaveFileHandle) return;
  // Reentrancy guard: a large deck can take longer than the autosave interval to
  // build and write. Without this, a second tick (or the immediate save on
  // enable) opens a second writable on the same handle while the first is still
  // writing — the overlapping createWritable() truncates the file and can leave
  // a 0-byte backup. Skip this tick if one is already running.
  if (state.autosaveInProgress) return;
  state.autosaveInProgress = true;
  try {
    if (!window.JSZip) {
      setAutosaveHint("Autosave failed: JSZip not available.");
      return;
    }
    const blob = await buildDeckZipBlob();
    // Never truncate the existing good backup to write an empty/failed blob.
    if (!blob || blob.size === 0) {
      setAutosaveHint("Autosave skipped: produced an empty archive (previous backup kept).");
      return;
    }
    const writable = await state.autosaveFileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (writeErr) {
      // Abort so the browser discards the swap file instead of committing a
      // partial/empty write over the previous backup.
      try { await writable.abort(); } catch { /* already closed */ }
      throw writeErr;
    }
    // Verify the bytes actually landed (Dropbox/OneDrive sync folders can grab a
    // file mid-swap and leave it truncated). Warn loudly if the size looks wrong.
    let writtenSize = blob.size;
    try {
      const check = await state.autosaveFileHandle.getFile();
      writtenSize = check.size;
    } catch { /* size check is best-effort */ }
    const now = new Date();
    const ts = now.toLocaleTimeString();
    state.autosaveLastAt = Date.now();
    if (writtenSize === 0) {
      setAutosaveHint(`⚠ Autosave wrote 0 bytes to ${state.autosaveFileHandle.name}. Use manual Save; pick a backup outside synced (Dropbox) folders.`);
    } else {
      setAutosaveHint(`Last autosaved: ${ts} → ${state.autosaveFileHandle.name} (${formatBytes(writtenSize)})`);
    }
  } catch (err) {
    setAutosaveHint(`Autosave failed: ${String(err?.message || err)} — previous backup kept.`);
  } finally {
    state.autosaveInProgress = false;
  }
}

function setAutosaveHint(msg) {
  if (dom.autosaveHint) dom.autosaveHint.textContent = msg;
}

// ─────────────────────────────────────────────────────────────────────────────

async function saveDeckZip(forceSaveAs = false) {
  const fileBase = deckFileBase(state.deck.meta.title);
  const usingJsZip = !!window.JSZip;
  const defaultName = `${fileBase}${usingJsZip ? ".ipe" : ".json"}`;
  const canPick = typeof window.showSaveFilePicker === "function";

  // ── 1. Pick the file handle FIRST, while the user gesture is still fresh.
  //
  // Building the payload takes real time (JSZip walks every asset; for a
  // 60+ MB deck that is easily several seconds). Chrome consumes the
  // transient user activation as soon as we `await` anything, and then
  // rejects a later `showSaveFilePicker()` with a SecurityError — which we
  // used to silently swallow and fall through to a browser download +
  // prompt() dialog. Order matters: pick handle first, THEN build blob.
  let fileHandle = state.currentZipFileHandle;
  const hadExistingHandle = !!fileHandle;
  // .ipe is the native format: a deck that came from an older .zip is saved as a new .ipe next to
  // it (the .zip stays as it was) instead of being written back into the .zip.
  const fromOlderZip = usingJsZip && !forceSaveAs && hadExistingHandle && !/\.ipe$/i.test(String(fileHandle.name || ""));
  // The title is the file name: a title changed since the file was opened or saved means a new name, so
  // Save asks where to save it (in the same folder, the new name filled in). The old file stays.
  const fileBaseOfHandle = hadExistingHandle ? String(fileHandle.name || "").replace(/\.(ipe|zip|json)$/i, "") : "";
  const renamed = usingJsZip && !forceSaveAs && hadExistingHandle && !fromOlderZip && fileBaseOfHandle !== fileBase;
  // A deck opened by double-clicking its .ipe has no file handle: Save suggests that file's name.
  let openedName = "";
  try { openedName = decodeURIComponent(String(state.deckFileUrl || "").split(/[\\/]/).pop() || ""); } catch { /* odd URL */ }
  const suggestedName = fromOlderZip
    ? `${String(fileHandle.name).replace(/\.[^.]*$/, "")}.ipe`
    : renamed ? defaultName
    : (usingJsZip && !forceSaveAs && !hadExistingHandle && /\.ipe$/i.test(openedName) ? openedName : defaultName);
  let pickerWasBlocked = false;
  if (canPick && (!fileHandle || forceSaveAs || fromOlderZip || renamed)) {
    try {
      const pickerOpts = {
        suggestedName,
        types: [usingJsZip ? IPE_FILE_TYPE : { description: "Deck JSON (.json)", accept: { "application/json": [".json"] } }],
      };
      if (fileHandle) pickerOpts.startIn = fileHandle; // the folder of the current file
      fileHandle = await window.showSaveFilePicker(pickerOpts);
    } catch (err) {
      if (err && err.name === "AbortError") {
        // User cancelled the Save/Save As dialog — abort quietly. Do NOT
        // fall through to the download fallback (which would dump a stray
        // ZIP into the Downloads folder).
        dom.modeHint.textContent = "Save cancelled.";
        return;
      }
      // Genuine failure (e.g. transient user activation expired, or the
      // picker is not permitted from this origin). Log and fall through to
      // the browser-download fallback with a prompt() for the filename.
      console.warn("Save file picker unavailable; falling back to download:", err);
      pickerWasBlocked = true;
      fileHandle = null;
    }
  }

  // ── 2. Build the payload. (Slow — but the picker is already done.)
  let blob;
  if (usingJsZip) {
    blob = await buildDeckZipBlob();
  } else {
    if (!pickerWasBlocked) alert("JSZip not available. Saving deck.json instead.");
    const packaged = await buildPackagedDeckForSave();
    stripDeckAssetBundlePaths(packaged);
    blob = new Blob([JSON.stringify(packaged, null, 2)], { type: "application/json" });
  }

  // ── 3a. Write via File System Access API if we have a handle.
  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      state.currentZipFileHandle = fileHandle;

      const pickedName = String(fileHandle.name || "").replace(/\.(ipe|zip|json)$/i, "").trim();
      // The title is the file name, always (a changed title already made Save ask for the new name).
      if (pickedName && pickedName !== state.deck.meta.title) {
        state.deck.meta.title = pickedName;
        touch();
        renderDeckMeta();
      }

      // Keep autosaving to the backup that was chosen when Autosave was
      // enabled. Never open a second file dialog here: the backup is picked
      // once (via the Autosave checkbox), so a normal Save shows only its
      // own dialog.
      if (dom.autosaveEnabledCheckbox?.checked && state.autosaveFileHandle) {
        state.autosaveEnabled = true;
        startAutosaveTimer();
      }

      dom.modeHint.textContent = fromOlderZip
        ? `Saved as ${fileHandle.name}, the deck's own format. The older .zip was left as it was.`
        : `Saved ${fileHandle.name || defaultName}.`;
      return;
    } catch (err) {
      console.warn("Write failed; falling back to download:", err);
    }
  }

  // ── 3b. Fallback: browser-download (with prompt() only for Save As).
  let finalName = suggestedName;
  if (forceSaveAs) {
    const typed = prompt("Save As filename:", suggestedName);
    if (typed === null) return;
    const trimmed = typed.trim();
    if (trimmed) {
      finalName = trimmed;
      const pickedTitle = trimmed.replace(/\.(ipe|zip|json)$/i, "").trim();
      if (pickedTitle) {
        state.deck.meta.title = pickedTitle;
        touch();
        renderDeckMeta();
        if (dom.autosaveEnabledCheckbox?.checked) {
          setAutosaveHint(`Autosave ON. Backup filename now defaults to ${getAutosaveSuggestedName()}.`);
        }
      }
    }
  }
  downloadBlob(blob, finalName);
  dom.modeHint.textContent = `Saved via download (${finalName}).`;
}

// Legacy shim: earlier callers passed a pre-built blob. Kept in case future
// code paths want to inject a payload; delegates to saveDeckZip's flow.
async function saveBlobAsZip(blob, defaultName, forceSaveAs = false) {
  // Preserve the pre-built blob path (no rebuild) — used only if some external
  // code still calls this. The picker-first ordering still applies.
  const canPick = typeof window.showSaveFilePicker === "function";
  let fileHandle = state.currentZipFileHandle;
  const hadExistingHandle = !!fileHandle;
  if (canPick && (!fileHandle || forceSaveAs)) {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: defaultName,
        types: [/\.json$/i.test(defaultName) ? { description: "Deck JSON (.json)", accept: { "application/json": [".json"] } } : IPE_FILE_TYPE],
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        dom.modeHint.textContent = "Save cancelled.";
        return;
      }
      console.warn("Save file picker unavailable; falling back to download:", err);
      fileHandle = null;
    }
  }
  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      state.currentZipFileHandle = fileHandle;
      const pickedName = String(fileHandle.name || "").replace(/\.(ipe|zip|json)$/i, "").trim();
      const pickedNewTarget = forceSaveAs || !hadExistingHandle;
      if (pickedName && pickedNewTarget) {
        state.deck.meta.title = pickedName;
        touch();
        renderDeckMeta();
      }
      if (dom.autosaveEnabledCheckbox?.checked && state.autosaveFileHandle) {
        state.autosaveEnabled = true;
        startAutosaveTimer();
      }
      dom.modeHint.textContent = `Saved ${fileHandle.name || defaultName}.`;
      return;
    } catch (err) {
      console.warn("Write failed; falling back to download:", err);
    }
  }
  let finalName = defaultName;
  if (forceSaveAs) {
    const typed = prompt("Save As filename:", defaultName);
    if (typed === null) return;
    finalName = typed.trim() || defaultName;
  }
  downloadBlob(blob, finalName);
  dom.modeHint.textContent = `Saved via download (${finalName}).`;
}

async function buildPackagedDeckForSave() {
  const deck = JSON.parse(JSON.stringify(state.deck));
  // Object URLs are temporary handles owned by the current browser session.
  // Never persist them: after a reload they point to nothing and can mask the
  // durable PDF data that is stored inline or rehydrated from the ZIP bundle.
  for (const asset of Object.values(deck.assets || {})) {
    if (asset && typeof asset === "object") {
      delete asset.runtimePdfUrl;
    }
  }
  // Saving no longer prunes automatically: parked/unused sources are kept so they
  // survive a save/reload. Use the "Prune unused" button to remove them on demand.
  const assets = deck.assets || {};
  const fetchCache = new Map();

  let bundledRefs = 0;
  let failedRefs = 0;

  for (const asset of Object.values(assets)) {
    if (!asset || !(asset.kind === "overlay-html-file" || asset.kind === "overlay-html-filelink") || !asset.htmlText) {
      continue;
    }

    const baseUrls = getDependencyBaseUrlsForSource(asset);
    const result = await inlineRelativeDependenciesInHtml(asset.htmlText, baseUrls, fetchCache);
    asset.htmlText = result.htmlText;
    bundledRefs += result.bundledCount;
    failedRefs += result.failedCount;
  }

  deck.packaging = {
    version: 1,
    generatedAt: new Date().toISOString(),
    prunedAssets: 0,
    prunedOverlayRefs: 0,
    prunedSlideRefs: 0,
    bundledRefs,
    failedRefs,
  };

  if (bundledRefs > 0 || failedRefs > 0) {
    dom.modeHint.textContent = `Packaging: bundled ${bundledRefs} dependency refs; ${failedRefs} unresolved.`;
  }

  return deck;
}

function getDependencyBaseUrlsForSource(source) {
  const urls = [];

  if (source?.url) {
    urls.push(new URL(source.url, window.location.href).href);
  }

  // Reuse existing deck-specific resolver (10031/10321/10855 sims).
  const guessedUrl = resolveHtmlFileSourceExternalUrl(source, source?.htmlText || "");
  if (guessedUrl) {
    urls.push(new URL(guessedUrl, window.location.href).href);
  }

  if (source?.name) {
    urls.push(new URL(source.name, window.location.href).href);
  }

  return [...new Set(urls)];
}

async function inlineRelativeDependenciesInHtml(htmlText, baseUrls, fetchCache) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(htmlText || ""), "text/html");

  const refNodes = [];
  refNodes.push(...Array.from(doc.querySelectorAll("script[src]")));
  refNodes.push(...Array.from(doc.querySelectorAll("link[href]")));
  refNodes.push(...Array.from(doc.querySelectorAll("img[src],source[src],video[src],audio[src],iframe[src]")));

  let bundledCount = 0;
  let failedCount = 0;

  for (const node of refNodes) {
    const attr = node.hasAttribute("src") ? "src" : "href";
    const ref = (node.getAttribute(attr) || "").trim();
    if (!shouldInlineRelativeRef(ref)) {
      continue;
    }

    const dataUrl = await fetchAsDataUrlWithBases(ref, baseUrls, fetchCache);
    if (dataUrl) {
      node.setAttribute(attr, dataUrl);
      bundledCount++;
    } else {
      failedCount++;
    }
  }

  return {
    htmlText: "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
    bundledCount,
    failedCount,
  };
}

function shouldInlineRelativeRef(ref) {
  if (!ref) {
    return false;
  }
  const lower = ref.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("//") ||
    lower.startsWith("#") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  ) {
    return false;
  }
  // Treat same-folder references and ./ ../ as dependencies to bundle.
  return true;
}

async function fetchAsDataUrlWithBases(ref, baseUrls, fetchCache) {
  for (const base of baseUrls) {
    let absUrl = "";
    try {
      absUrl = new URL(ref, base).href;
    } catch {
      continue;
    }

    if (fetchCache.has(absUrl)) {
      return fetchCache.get(absUrl);
    }

    try {
      const resp = await fetch(absUrl);
      if (!resp.ok) {
        continue;
      }
      const blob = await resp.blob();
      const dataUrl = await blobToDataUrl(blob);
      fetchCache.set(absUrl, dataUrl);
      return dataUrl;
    } catch {
      // Try next base URL.
    }
  }
  return "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function openLoadZipDialog() {
  if (typeof window.showOpenFilePicker === "function") {
    try {
      // .ipe decks first (the dialog's default filter); older .zip decks under the second file type
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [IPE_FILE_TYPE, LEGACY_ZIP_FILE_TYPE],
      });
      if (!fileHandle) {
        return;
      }
      const file = await fileHandle.getFile();
      await loadDeckZip(file, { fileHandle });
      return;
    } catch (err) {
      // Cancelled: stop here (it used to open the second, fallback file dialog right after).
      if (err && err.name === "AbortError") return;
      // API unavailable in this runtime: use the file input fallback.
    }
  }

  dom.loadZipInput?.click();
}

async function loadDeckZip(file, options = {}) {
  if (!window.JSZip) {
    alert("JSZip is required to load .zip files.");
    return;
  }

  const zip = await JSZip.loadAsync(file);
  const deckFile = zip.file("deck.json");
  if (!deckFile) {
    alert("Invalid package: deck.json not found.");
    return;
  }
  const txt = await deckFile.async("string");
  const loaded = JSON.parse(txt);

  if (!loaded || !Array.isArray(loaded.slides) || !loaded.assets) {
    alert("Invalid deck format.");
    return;
  }

  // Unpacked layout: rehydrate binary assets stored as separate files in the zip
  // back into dataUrl/htmlText so the rest of the app is unchanged. Inline decks
  // (no bundlePath) pass through untouched. Remember the layout so re-saving keeps it.
  const wasUnpacked = await hydrateUnpackedAssets(loaded, zip);
  // DTUwrite boards (dtuwrite/*.json and their page pictures) back into the deck
  if (window.DtuwriteBoards) await window.DtuwriteBoards.unpackFromZip(loaded, zip);

  loaded.schemaVersion = loaded.schemaVersion || SCHEMA_VERSION;
  loaded.meta = loaded.meta || {};
  loaded.meta.title = loaded.meta.title || "Loaded Deck";
  loaded.meta.updatedAt = new Date().toISOString();
  loaded.orphanedSlides = loaded.orphanedSlides || [];
  loaded.settings = loaded.settings || {};
  loaded.settings.globalContentScale = safeClampNumber(loaded.settings.globalContentScale, 0.5, 2, 1);
  loaded.settings.scaleLockMode = normalizeScaleLockMode(loaded.settings.scaleLockMode, loaded.settings.resolutionLock);
  loaded.settings.previewFullscreenInEditor = false;
  loaded.settings.referenceWidth = safeClampNumber(loaded.settings.referenceWidth, 320, 7680, loaded.settings.scaleLockMode === "notes960" ? 960 : 1920);
  loaded.settings.referenceHeight = safeClampNumber(loaded.settings.referenceHeight, 180, 4320, loaded.settings.scaleLockMode === "notes960" ? 640 : 1080);
  loaded.settings.showSectionProgress = loaded.settings.showSectionProgress !== false;
  loaded.settings.includeFrontEndInProgress = loaded.settings.includeFrontEndInProgress !== false;
  loaded.settings.sectionProgressScale = safeClampNumber(loaded.settings.sectionProgressScale, 0.5, 2.5, 1);
  // Keep the deck's storage layout: an unpacked zip re-saves unpacked by default.
  loaded.settings.unpackedAssets = wasUnpacked || loaded.settings.unpackedAssets === true;
  ensureDeckLogoSettings(loaded);

  normalizeLoadedDeckAssetsAndOverlayLinks(loaded);
  ensureDefaultTextBoardSource(loaded);
  (loaded.slides || []).forEach((slide) => {
    ensureSlideAnimationDefaults(slide);
    normalizeSectionDividerSlide(slide);
    normalizeSummarySlide(slide);
  });
  loaded.schemaVersion = SCHEMA_VERSION;

  revokeRuntimePdfUrlsFromDeck(state.deck);
  revokeRuntimeImageUrls();
  state.deck = loaded;
  state.currentSlideIndex = Math.min(state.currentSlideIndex, Math.max(0, state.deck.slides.length - 1));
  state.selectedOverlayId = null;
  state.animationStepIndex = -1;
  state.remapHistory = [];
  state.currentZipFileHandle = options?.fileHandle || null;
  state.deckFileUrl = String(options?.deckFileUrl || "");
  setPresentationRootFromZipFile(file, options);
  const explicitRoot = String(state.deck.settings.presentationRootPath || "").trim();
  if (explicitRoot) {
    state.presentationRootFileUrl = resolvePresentationRootFromSetting(explicitRoot);
    savePresentationRootToLocalStorage(state.deck.meta.title, explicitRoot, file?.name || state.currentZipFileHandle?.name || "");
  } else {
    const inferredFromZipFolder = String(state.deck.settings.presentationRootPath || "").trim();
    if (inferredFromZipFolder) {
      savePresentationRootToLocalStorage(state.deck.meta.title, inferredFromZipFolder, file?.name || state.currentZipFileHandle?.name || "");
    } else if (!getPresentationRootFileUrl()) {
      const savedPath = loadPresentationRootFromLocalStorage(
        state.deck.meta.title,
        file?.name || state.currentZipFileHandle?.name || "",
      );
      if (savedPath) {
        state.deck.settings.presentationRootPath = savedPath;
        state.presentationRootFileUrl = resolvePresentationRootFromSetting(savedPath);
      }
    }
  }
  resetAutosaveTargetKeepSelection();
  setDeckSessionReady(true);
  renderAll();
  persistLastDeckToStorage();
  // deck-links.js: warn when a double-clicked deck takes its sims from another folder than its own
  if (window.DeckLinks) window.DeckLinks.afterDeckOpened();
}

function enterFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    setMode("edit");
    return;
  }
  setMode("present");
  const el = dom.appRoot;
  if (el.requestFullscreen) {
    el.requestFullscreen();
  }
}

function touch() {
  state.dirty = true;
  state.deck.meta.updatedAt = new Date().toISOString();
  schedulePersistLastDeckToStorage();
}

function ensureDeckSettings() {
  state.deck.settings = state.deck.settings || {};
  if (!Number.isFinite(state.deck.settings.globalContentScale) || state.deck.settings.globalContentScale <= 0) {
    state.deck.settings.globalContentScale = 1;
  }
  state.deck.settings.scaleLockMode = normalizeScaleLockMode(state.deck.settings.scaleLockMode, state.deck.settings.resolutionLock);
  state.deck.settings.previewFullscreenInEditor = false;
  state.deck.settings.presentationRootPath = String(state.deck.settings.presentationRootPath || "").trim();
  if (typeof state.deck.settings.showSectionProgress !== "boolean") {
    state.deck.settings.showSectionProgress = true;
  }
  if (typeof state.deck.settings.includeFrontEndInProgress !== "boolean") {
    state.deck.settings.includeFrontEndInProgress = true;
  }
  state.deck.settings.sectionProgressScale = safeClampNumber(state.deck.settings.sectionProgressScale, 0.5, 2.5, 1);
  if (typeof state.deck.settings.unpackedAssets !== "boolean") {
    state.deck.settings.unpackedAssets = false;
  }
  ensureDeckLogoSettings(state.deck);
  ensureDeckCreditsSettings(state.deck);
  if (state.deck.settings.scaleLockMode === "notes960") {
    state.deck.settings.referenceWidth = 960;
    state.deck.settings.referenceHeight = 640;
  } else if (state.deck.settings.scaleLockMode === "xga1024") {
    state.deck.settings.referenceWidth = 1024;
    state.deck.settings.referenceHeight = 768;
  } else if (state.deck.settings.scaleLockMode === "hd720") {
    state.deck.settings.referenceWidth = 1280;
    state.deck.settings.referenceHeight = 720;
  } else if (state.deck.settings.scaleLockMode === "hd1080") {
    state.deck.settings.referenceWidth = 1920;
    state.deck.settings.referenceHeight = 1080;
  } else if (state.deck.settings.scaleLockMode === "laptop1366") {
    state.deck.settings.referenceWidth = 1366;
    state.deck.settings.referenceHeight = 768;
  } else if (state.deck.settings.scaleLockMode === "qhd1440") {
    state.deck.settings.referenceWidth = 2560;
    state.deck.settings.referenceHeight = 1440;
  } else if (state.deck.settings.scaleLockMode === "uwqhd3440") {
    state.deck.settings.referenceWidth = 3440;
    state.deck.settings.referenceHeight = 1440;
  } else if (state.deck.settings.scaleLockMode === "uhd4k") {
    state.deck.settings.referenceWidth = 3840;
    state.deck.settings.referenceHeight = 2160;
  } else {
    state.deck.settings.referenceWidth = safeClampNumber(state.deck.settings.referenceWidth, 320, 7680, 960);
    state.deck.settings.referenceHeight = safeClampNumber(state.deck.settings.referenceHeight, 180, 4320, 540);
  }
}

function bindEmbedResizeKick(iframe) {
  iframe.addEventListener("load", () => {
    queueResizeKickForFrame(iframe);
  });
}

function queueEmbeddedResizeKick() {
  // Kick one tick later to ensure layout is stable after stage rebuild/navigation.
  requestAnimationFrame(() => {
    const frames = dom.stage.querySelectorAll("iframe.overlay-content");
    frames.forEach((frame) => queueResizeKickForFrame(frame));
  });
}

function queueResizeKickForFrame(iframe) {
  const runKick = () => {
    try {
      const w = iframe.contentWindow;
      if (!w) {
        return;
      }
      w.dispatchEvent(new Event("resize"));
      w.postMessage({ type: "presenter-resize-kick" }, "*");
    } catch {
      // Cross-origin or blocked sandbox: ignore safely.
    }
  };

  requestAnimationFrame(() => {
    runKick();
    setTimeout(runKick, 80);
    setTimeout(runKick, 220);
  });
}

function getOverlayAssetEntries() {
  return Object.entries(state.deck.assets || {})
    .filter(([, a]) => a && typeof a.kind === "string" && a.kind.startsWith("overlay"))
    .map(([key, asset]) => ({ key, asset }));
}

function resolveAssetKey(anyId) {
  if (!anyId) {
    return "";
  }
  if (state.deck.assets && state.deck.assets[anyId]) {
    return anyId;
  }
  for (const [key, asset] of Object.entries(state.deck.assets || {})) {
    if (asset && asset.id === anyId) {
      return key;
    }
  }
  return "";
}

function resolveAssetByAnyId(anyId) {
  const key = resolveAssetKey(anyId);
  return key ? state.deck.assets[key] : null;
}

function resolveHtmlFileSourceExternalUrl(source, htmlText) {
  // srcdoc cannot resolve file-relative dependencies like ../10031main.js.
  // For known deck sims, prefer loading by URL path so relative imports work.
  if (!hasRelativeDependencies(htmlText)) {
    return "";
  }

  const name = encodeURIComponent(source.name || "").replace(/%2F/gi, "/");
  if (!name) {
    return "";
  }

  const lower = String(source.name || "").toLowerCase();
  const text = String(htmlText || "").toLowerCase();

  if (text.includes("10031main.js") || lower.includes("10031") || lower.startsWith("sim-10031-")) {
    return fromWorkspaceRoot(`10031 Notes/sims/${name}`);
  }
  if (text.includes("10321") || lower.startsWith("sim-10321-") || lower.includes("vdw visualizer")) {
    return fromWorkspaceRoot(`10321 Notes/sims/${name}`);
  }
  if (text.includes("10855") || lower.startsWith("sim-10855-")) {
    return fromWorkspaceRoot(`10855 Notes/sims/${name}`);
  }

  // Unknown deck: keep srcdoc fallback to avoid broken links by wrong guess.
  return "";
}

function hasRelativeDependencies(htmlText) {
  const txt = String(htmlText || "");
  // Detect relative asset references that need file path context.
  return /(src|href)\s*=\s*["'](\.\.\/|\.\/)/i.test(txt);
}

function normalizeLoadedDeckAssetsAndOverlayLinks(deck) {
  const assets = deck.assets || {};
  if (!deck.notes || typeof deck.notes !== "object") {
    deck.notes = {};
  }

  // Ensure each asset has a stable id and a canonical key mapping.
  for (const [key, asset] of Object.entries(assets)) {
    if (!asset || typeof asset !== "object") {
      continue;
    }
    // Older project ZIPs may contain a blob: URL created in a previous browser
    // session. Remove it so getPdfDisplayUrl() creates a fresh URL from dataUrl.
    delete asset.runtimePdfUrl;
    if (!asset.id) {
      asset.id = key;
    }
    if (asset.kind === "overlay-text") {
      ensureOverlayTextSourceDefaults(asset);
    } else if (asset.kind === "overlay-notes-board") {
      if (!asset.url || NOTES_BOARD_LEGACY_FILE_NAMES.includes(String(asset.url))) {
        asset.url = NOTES_BOARD_FILE_NAME;
      }
    } else if (asset.kind === "overlay-sequence") {
      ensureOverlaySequenceSourceDefaults(asset);
    }
  }

  // Migrate overlay source links that may use legacy asset.id or names.
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  for (const slide of slides) {
    if (!slide || typeof slide !== "object") {
      continue;
    }
    if (!Array.isArray(slide.overlays)) {
      slide.overlays = [];
    }
    ensureSlideAnimationDefaults(slide);
    if (!Array.isArray(slide.textBoxes)) {
      slide.textBoxes = [];
    }
    for (const textBox of slide.textBoxes) {
      if (!textBox || typeof textBox !== "object") {
        continue;
      }
      textBox.fontSize = normalizeTextBoxFontSize(textBox.fontSize, 16);
    }

    for (const overlay of slide.overlays) {
      if (!overlay || typeof overlay !== "object") {
        continue;
      }

      overlay.localScale = safeClampNumber(overlay.localScale, 0.25, 3, 1);
      if (typeof overlay.shaded !== "boolean") {
        overlay.shaded = false;
      }
      if (typeof overlay.allowKeyControl !== "boolean") {
        overlay.allowKeyControl = false;
      }
      ensureOverlayNotesDefaults(overlay);
      if (isNotesBoardSource(overlay.sourceId) && !overlay.notesKey) {
        overlay.notesKey = uid();
      }
      // Keep compatibility with legacy decks that still carry zoomable.
      if (typeof overlay.zoomable === "boolean") {
        delete overlay.zoomable;
      }
      ensureOverlayAnnotationDefaults(overlay);
      ensureOverlayNotebookDefaults(overlay);
      if (overlay.sequenceIndex !== undefined) {
        overlay.sequenceIndex = normalizeOverlaySequenceIndex(overlay.sequenceIndex, Number.MAX_SAFE_INTEGER);
      }

      const directKey = overlay.sourceId && assets[overlay.sourceId] ? overlay.sourceId : "";
      if (directKey) {
        const directAsset = assets[directKey];
        if (directAsset?.kind === "overlay-sequence") {
          ensureOverlaySequenceSourceDefaults(directAsset);
          overlay.sequenceIndex = normalizeOverlaySequenceIndex(overlay.sequenceIndex, directAsset.frames.length || 1);
        }
        continue;
      }

      let migratedKey = "";
      if (overlay.sourceId) {
        for (const [key, asset] of Object.entries(assets)) {
          if (asset && asset.id === overlay.sourceId) {
            migratedKey = key;
            break;
          }
        }
      }

      if (!migratedKey && overlay.sourceName) {
        for (const [key, asset] of Object.entries(assets)) {
          if (asset && asset.name === overlay.sourceName) {
            migratedKey = key;
            break;
          }
        }
      }

      if (migratedKey) {
        overlay.sourceId = migratedKey;
        const migratedAsset = assets[migratedKey];
        if (migratedAsset?.kind === "overlay-sequence") {
          ensureOverlaySequenceSourceDefaults(migratedAsset);
          overlay.sequenceIndex = normalizeOverlaySequenceIndex(overlay.sequenceIndex, migratedAsset.frames.length || 1);
        }
      }

      const sourceKeyAfter = resolveDeckAssetKeyByAnyId(assets, overlay.sourceId);
      const sourceAfter = sourceKeyAfter ? assets[sourceKeyAfter] : null;
      if (sourceAfter?.kind === "overlay-notebook-panel") {
        overlay.annotationsEnabled = true;
        ensureOverlayNotebookDefaults(overlay);
      }
    }

    if (Array.isArray(slide.animationEvents)) {
      slide.animationEvents = slide.animationEvents.filter((ev) => {
        if (!ev || !ev.overlayId) {
          return false;
        }
        return slide.overlays.some((o) => o.id === ev.overlayId);
      });
    }
  }
}

function applyGlobalContentScale(el, localScale = 1) {
  const scale = safeClampNumber(getEffectiveContentScale() * safeClampNumber(localScale, 0.25, 3, 1), 0.25, 6, 1);

  // For iframe embeds, avoid transform/size compensation because that changes
  // the internal viewport and can collapse canvas-heavy sims.
  if (el.tagName === "IFRAME") {
    el.style.transform = "none";
    el.style.width = "100%";
    el.style.height = "100%";
    // Chromium supports zoom and applies it to embedded content rendering
    // without rewriting the iframe viewport dimensions.
    el.style.zoom = String(scale);
    return;
  }

  el.style.transformOrigin = "top left";
  el.style.transform = `scale(${scale})`;
  el.style.width = `${100 / scale}%`;
  el.style.height = `${100 / scale}%`;
}

function getEffectiveContentScale() {
  return getScaleContext().effective;
}

function getScaleContext() {
  ensureDeckSettings();
  const baseScale = safeClampNumber(state.deck.settings.globalContentScale, 0.5, 2, 1);
  const target = getTargetStageForScale();
  if (state.deck.settings.scaleLockMode === "off") {
    return {
      base: baseScale,
      effective: baseScale,
      stageWidth: target.width,
      stageHeight: target.height,
      refWidth: state.deck.settings.referenceWidth,
      refHeight: state.deck.settings.referenceHeight,
      fitRatio: 1,
      sourceLabel: target.sourceLabel,
    };
  }

  if (!target.width || !target.height) {
    return {
      base: baseScale,
      effective: baseScale,
      stageWidth: 0,
      stageHeight: 0,
      refWidth: state.deck.settings.referenceWidth,
      refHeight: state.deck.settings.referenceHeight,
      fitRatio: 1,
      sourceLabel: target.sourceLabel,
    };
  }

  const refW = state.deck.settings.referenceWidth || 1920;
  const refH = state.deck.settings.referenceHeight || 1080;
  const fitRatio = Math.min(target.width / refW, target.height / refH);
  if (!fitRatio || fitRatio <= 0) {
    return {
      base: baseScale,
      effective: baseScale,
      stageWidth: target.width,
      stageHeight: target.height,
      refWidth: refW,
      refHeight: refH,
      fitRatio: 1,
      sourceLabel: target.sourceLabel,
    };
  }
  return {
    base: baseScale,
    // Keep authored visual size against a reference viewport:
    // larger target viewport -> larger effective scale.
    effective: safeClampNumber(baseScale * fitRatio, 0.25, 4, baseScale),
    stageWidth: target.width,
    stageHeight: target.height,
    refWidth: refW,
    refHeight: refH,
    fitRatio,
    sourceLabel: target.sourceLabel,
  };
}

function getTargetStageForScale() {
  const stageRect = dom.stage.getBoundingClientRect();
  if (state.mode === "present") {
    return {
      width: stageRect.width,
      height: stageRect.height,
      sourceLabel: "live presenter stage",
    };
  }

  return {
    width: stageRect.width,
    height: stageRect.height,
    sourceLabel: "editor stage",
  };
}

function normalizeScaleLockMode(mode, legacyResolutionLock = false) {
  const valid = new Set([
    "off",
    "notes960",
    "xga1024",
    "hd720",
    "hd1080",
    "laptop1366",
    "qhd1440",
    "uwqhd3440",
    "uhd4k",
    "custom",
  ]);
  if (valid.has(mode)) {
    return mode;
  }
  // Backward compatibility with old boolean lock setting.
  return legacyResolutionLock ? "hd1080" : "off";
}

function isPresenterNextKey(e) {
  return NEXT_KEYS.has(e.key) || NEXT_CODES.has(e.code);
}

function isPresenterPrevKey(e) {
  return PREV_KEYS.has(e.key) || PREV_CODES.has(e.code);
}

function isRapidNavRepeat() {
  const now = Date.now();
  if (now - state.lastNavAt < NAV_REPEAT_GUARD_MS) {
    return true;
  }
  state.lastNavAt = now;
  return false;
}

function isRapidNavRepeatForDelta(delta) {
  const now = Date.now();
  const sameDirection = Math.sign(delta) === Math.sign(state.lastNavDelta || 0);
  if (sameDirection && (now - state.lastNavAt < NAV_REPEAT_GUARD_MS)) {
    return true;
  }
  state.lastNavAt = now;
  state.lastNavDelta = Math.sign(delta);
  return false;
}

function isClipboardShortcut(e, key) {
  const pressedKey = String(e.key || "").toLowerCase();
  if (pressedKey !== key) {
    return false;
  }
  const hasPrimaryMod = !!(e.ctrlKey || e.metaKey);
  return hasPrimaryMod && !e.altKey;
}

function getSelectedOverlayContext() {
  const slide = currentSlide();
  if (!slide || !state.selectedOverlayId) {
    return null;
  }
  const overlay = slide.overlays.find((o) => o.id === state.selectedOverlayId);
  if (!overlay) {
    return null;
  }
  return { slide, overlay };
}

function buildOverlayClipboardData(overlay) {
  const sourceKey = resolveAssetKey(overlay.sourceId);
  if (!sourceKey) {
    return null;
  }

  return {
    marker: OVERLAY_CLIPBOARD_MARKER,
    copiedAt: new Date().toISOString(),
    overlay: {
      x: safeClampNumber(overlay.x, 0, 1, 0.1),
      y: safeClampNumber(overlay.y, 0, 1, 0.1),
      w: safeClampNumber(overlay.w, 0.01, 1, 0.2),
      h: safeClampNumber(overlay.h, 0.01, 1, 0.2),
      sourceId: sourceKey,
      notesKey: String(overlay.notesKey || ""),
      noteDoc: isNotesBoardSource(sourceKey) ? String(state.deck.notes?.[overlay.notesKey]?.doc || DEFAULT_NOTES_DOC) : "",
      noteSettings: isNotesBoardSource(sourceKey) ? normalizeNotesSettings(state.deck.notes?.[overlay.notesKey]?.settings) : null,
      framed: !!overlay.framed,
      shaded: !!overlay.shaded,
      locked: !!overlay.locked,
      allowKeyControl: !!overlay.allowKeyControl,
      annotationsEnabled: !!overlay.annotationsEnabled,
      annotationLayer: typeof overlay.annotationLayer === "string" ? overlay.annotationLayer : "",
      annotationColor: sanitizeHexColor(overlay.annotationColor, "#000000"),
      notebookPages: Array.isArray(overlay.notebookPages)
        ? overlay.notebookPages.map((page) => ({
          drawingLayer: String(page?.drawingLayer || ""),
          strokes: Array.isArray(page?.strokes)
            ? page.strokes.map((stroke) => ({ ...stroke, pts: stroke.pts.slice() }))
            : [],
          html: String(page?.html || ""),
          text: String(page?.text || ""),
          backgroundMode: String(page?.backgroundMode || "transparent"),
          createdAt: String(page?.createdAt || ""),
          updatedAt: String(page?.updatedAt || ""),
        }))
        : [],
      notebookPageIndex: safeClampNumber(overlay.notebookPageIndex, 0, Number.MAX_SAFE_INTEGER, 0),
      notebookMode: String(overlay.notebookMode || "type"),
      notebookModeExplicit: overlay.notebookModeExplicit === true,
      notebookInputVersion: 2,
      notebookShadowEnabled: !!overlay.notebookShadowEnabled,
      notebookFontSize: normalizeTextFontSize(overlay.notebookFontSize, 18),
      opacity: safeClampNumber(overlay.opacity, 0, 1, 1),
      localScale: safeClampNumber(overlay.localScale, 0.25, 3, 1),
    },
  };
}

function parseOverlayClipboardText(text) {
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.marker !== OVERLAY_CLIPBOARD_MARKER || !parsed.overlay) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeOverlayClipboardText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    // Clipboard permission may be blocked; in-memory fallback still works.
  }
}

async function readOverlayClipboardData() {
  if (state.overlayClipboard?.overlay) {
    return state.overlayClipboard;
  }

  try {
    if (!navigator.clipboard?.readText) {
      return null;
    }
    const text = await navigator.clipboard.readText();
    const parsed = parseOverlayClipboardText(text);
    if (parsed?.overlay) {
      state.overlayClipboard = parsed;
      return parsed;
    }
  } catch {
    // Clipboard permission may be blocked.
  }

  return null;
}

async function copySelectedOverlayToClipboard() {
  const ctx = getSelectedOverlayContext();
  if (!ctx) {
    return false;
  }

  const payload = buildOverlayClipboardData(ctx.overlay);
  if (!payload) {
    dom.modeHint.textContent = "Copy works for overlays with a valid source. Assign a source first.";
    return false;
  }

  const text = JSON.stringify(payload);
  state.overlayClipboard = payload;
  state.overlayPasteCount = 0;
  await writeOverlayClipboardText(text);
  dom.modeHint.textContent = "Overlay copied. Press Ctrl/Cmd+V to paste.";
  return true;
}

async function cutSelectedOverlayToClipboard() {
  const ctx = getSelectedOverlayContext();
  if (!ctx) {
    return false;
  }

  const copied = await copySelectedOverlayToClipboard();
  if (!copied) {
    return false;
  }

  removeNotesForOverlay(ctx.overlay);
  ctx.slide.overlays = ctx.slide.overlays.filter((o) => o.id !== ctx.overlay.id);
  pruneMissingAnimationOverlayRefs(ctx.slide);
  state.selectedOverlayId = null;
  touch();
  renderAll();
  dom.modeHint.textContent = "Overlay cut. Press Ctrl/Cmd+V to paste.";
  return true;
}

async function pasteOverlayFromClipboard() {
  const slide = currentSlide();
  if (!slide) {
    return false;
  }

  const payload = await readOverlayClipboardData();
  if (!payload?.overlay) {
    return false;
  }

  const sourceKey = resolveAssetKey(payload.overlay.sourceId);
  if (!sourceKey) {
    dom.modeHint.textContent = "Cannot paste: the copied overlay source is missing from this deck.";
    return false;
  }

  const base = payload.overlay;
  state.overlayPasteCount += 1;
  const nudge = 0.02 * state.overlayPasteCount;
  const w = safeClampNumber(base.w, 0.01, 1, 0.2);
  const h = safeClampNumber(base.h, 0.01, 1, 0.2);

  const pasted = {
    id: uid(),
    x: clamp(safeClampNumber(base.x, 0, 1, 0.1) + nudge, 0, 1 - w),
    y: clamp(safeClampNumber(base.y, 0, 1, 0.1) + nudge, 0, 1 - h),
    w,
    h,
    sourceId: sourceKey,
    notesKey: "",
    framed: !!base.framed,
    shaded: !!base.shaded,
    locked: !!base.locked,
    allowKeyControl: !!base.allowKeyControl,
    annotationsEnabled: !!base.annotationsEnabled,
    annotationLayer: typeof base.annotationLayer === "string" ? base.annotationLayer : "",
    annotationColor: sanitizeHexColor(base.annotationColor, "#000000"),
    notebookPages: Array.isArray(base.notebookPages)
      ? base.notebookPages.map((page) => ({
        drawingLayer: String(page?.drawingLayer || ""),
        strokes: Array.isArray(page?.strokes)
          ? page.strokes.map((stroke) => ({ ...stroke, pts: (stroke.pts || []).slice() }))
          : [],
        html: String(page?.html || ""),
        text: String(page?.text || ""),
        backgroundMode: String(page?.backgroundMode || "transparent"),
        createdAt: String(page?.createdAt || ""),
        updatedAt: String(page?.updatedAt || ""),
      }))
      : [],
    notebookPageIndex: safeClampNumber(base.notebookPageIndex, 0, Number.MAX_SAFE_INTEGER, 0),
    notebookMode: String(base.notebookMode || "type"),
    notebookModeExplicit: base.notebookModeExplicit === true,
    notebookInputVersion: 2,
    notebookShadowEnabled: !!base.notebookShadowEnabled,
    notebookFontSize: normalizeTextFontSize(base.notebookFontSize, 18),
    opacity: safeClampNumber(base.opacity, 0, 1, 1),
    localScale: safeClampNumber(base.localScale, 0.25, 3, 1),
    zIndex: slide.overlays.reduce((m, o) => Math.max(m, o.zIndex || 1), 1) + 1,
  };

  applyOverlaySourceBehaviorDefaults(pasted);
  ensureOverlayNotebookDefaults(pasted);
  if (isNotesBoardSource(sourceKey)) {
    ensureDeckNotesStore();
    pasted.notesKey = uid();
    state.deck.notes[pasted.notesKey] = {
      settings: normalizeNotesSettings(base.noteSettings),
      doc: String(base.noteDoc || DEFAULT_NOTES_DOC),
      updatedAt: new Date().toISOString(),
    };
  }

  slide.overlays.push(pasted);
  state.selectedOverlayId = pasted.id;
  touch();
  renderAll();
  dom.modeHint.textContent = "Overlay pasted.";
  return true;
}

async function pasteImageOverlayFromClipboard() {
  const slide = currentSlide();
  if (!slide) {
    return false;
  }

  if (!navigator.clipboard?.read) {
    dom.modeHint.textContent = "Clipboard image paste is not supported in this browser. Use Add images instead.";
    return false;
  }

  const canReadClipboard = window.isSecureContext || window.location.protocol === "file:";
  if (!canReadClipboard) {
    dom.modeHint.textContent = "Clipboard image paste requires a secure context (HTTPS) or local file mode.";
    return false;
  }

  try {
    const items = await navigator.clipboard.read();
    let imageBlob = null;
    let imageType = "";

    for (const item of items) {
      const preferredType = item.types.find((type) => String(type).toLowerCase().startsWith("image/"));
      if (!preferredType) {
        continue;
      }
      imageType = preferredType;
      imageBlob = await item.getType(preferredType);
      break;
    }

    if (!imageBlob) {
      dom.modeHint.textContent = "No image found in clipboard.";
      return false;
    }

    const dataUrl = await fileToDataUrl(imageBlob);
    const sourceId = uid();
    const mime = String(imageBlob.type || imageType || "image/png").toLowerCase();
    state.deck.assets[sourceId] = {
      id: sourceId,
      kind: "overlay-image",
      mime,
      name: `clipboard-image-${new Date().toISOString()}`,
      dataUrl,
    };

    state.overlayPasteCount += 1;
    const rect = await buildClipboardImageOverlayRect(dataUrl, state.overlayPasteCount);
    const overlay = createOverlay(rect);
    overlay.sourceId = sourceId;
    overlay.zIndex = slide.overlays.reduce((m, o) => Math.max(m, o.zIndex || 1), 1) + 1;
    slide.overlays.push(overlay);
    state.selectedOverlayId = overlay.id;

    touch();
    renderAll();
    dom.modeHint.textContent = "Image pasted from clipboard as overlay.";
    return true;
  } catch {
    dom.modeHint.textContent = "Unable to read clipboard image. Allow clipboard access, then try again.";
    return false;
  }
}

async function buildClipboardImageOverlayRect(dataUrl, pasteIndex = 0) {
  const fallback = {
    x: 0.35,
    y: 0.3,
    w: 0.3,
    h: 0.3,
  };

  try {
    const img = await loadImage(dataUrl);
    const iw = Math.max(1, Number(img.naturalWidth || img.width || 1));
    const ih = Math.max(1, Number(img.naturalHeight || img.height || 1));
    const aspect = iw / ih;

    const minSize = 0.02;
    const maxW = 0.9;
    const maxH = 0.9;
    let w = aspect >= 1 ? 0.36 : (0.36 * aspect);
    let h = aspect >= 1 ? (0.36 / aspect) : 0.36;

    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    if (w < minSize) {
      w = minSize;
      h = w / aspect;
    }
    if (h < minSize) {
      h = minSize;
      w = h * aspect;
    }
    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }

    const nudge = 0.015 * Math.min(10, Math.max(0, pasteIndex));
    return {
      x: clamp((1 - w) / 2 + nudge, 0, 1 - w),
      y: clamp((1 - h) / 2 + nudge, 0, 1 - h),
      w,
      h,
    };
  } catch {
    return {
      x: clamp(fallback.x + 0.015 * Math.min(10, Math.max(0, pasteIndex)), 0, 1 - fallback.w),
      y: clamp(fallback.y + 0.015 * Math.min(10, Math.max(0, pasteIndex)), 0, 1 - fallback.h),
      w: fallback.w,
      h: fallback.h,
    };
  }
}

function sourceTypeLabel(kind) {
  if (kind === "overlay-image") return "image";
  if (kind === "overlay-sequence") return "sequence";
  if (kind === "overlay-video") return "video";
  if (kind === "overlay-text") return "text";
  if (kind === "overlay-pdf") return "pdf";
  if (kind === "overlay-html-file") return "html-copy";
  if (kind === "overlay-html-filelink") return "html-link";
  if (kind === "overlay-html-external") return "html-url";
  if (kind === "overlay-notes-board") return "notes";
  if (kind === "overlay-notebook-panel") return "notebook";
  return kind;
}

function isKeyControlEligibleSource(source) {
  if (!source || typeof source !== "object") {
    return false;
  }
  return source.kind === "overlay-html-file"
    || source.kind === "overlay-html-filelink"
    || source.kind === "overlay-html-external"
    || source.kind === "overlay-notes-board";
}

function notesDraftStorageKey(notesKey) {
  const deckId = String(state.deck?.meta?.deckId || "deck");
  return `${NOTES_DRAFT_STORAGE_PREFIX}.${deckId}.${String(notesKey || "")}`;
}

function writeNotesDraftToStorage(notesKey, doc) {
  if (!notesKey) {
    return;
  }
  try {
    localStorage.setItem(notesDraftStorageKey(notesKey), String(doc || DEFAULT_NOTES_DOC));
  } catch {
    // Ignore storage quota/privacy restrictions.
  }
}

function readNotesDraftFromStorage(notesKey) {
  if (!notesKey) {
    return "";
  }
  try {
    return String(localStorage.getItem(notesDraftStorageKey(notesKey)) || "");
  } catch {
    return "";
  }
}

function setDeckSessionReady(ready) {
  state.deckSessionReady = !!ready;
  if (dom.addNotesBoardBtn) {
    dom.addNotesBoardBtn.disabled = !state.deckSessionReady;
  }
  if (dom.addNotebookPanelBtn) {
    dom.addNotebookPanelBtn.disabled = !state.deckSessionReady;
  }
}

function ensureDeckNotesStore() {
  if (!state.deck.notes || typeof state.deck.notes !== "object") {
    state.deck.notes = {};
  }
}

function ensureOverlayNotesDefaults(overlay) {
  if (!overlay || typeof overlay !== "object") {
    return;
  }
  if (typeof overlay.notesKey !== "string") {
    overlay.notesKey = "";
  }
}

function removeNotesForOverlay(overlay) {
  if (!overlay || typeof overlay !== "object") {
    return;
  }
  ensureDeckNotesStore();
  ensureOverlayNotesDefaults(overlay);
  if (overlay.notesKey) {
    delete state.deck.notes[overlay.notesKey];
  }
}

function isNotesBoardSource(sourceId) {
  const source = resolveAssetByAnyId(sourceId);
  if (!source) return false;
  if (source.kind === "overlay-notes-board") return true;
  if (!["overlay-html-filelink", "overlay-html-external", "overlay-html-file"].includes(source.kind)) return false;
  const candidate = `${String(source.name || "")} ${String(source.url || "")}`.toLowerCase();
  // Decks saved before the X build reference notes-board.html; both names map
  // to the same overlay kind so either one keeps opening as a notes board.
  return [NOTES_BOARD_FILE_NAME, ...NOTES_BOARD_LEGACY_FILE_NAMES].some((fileName) => {
    const lower = fileName.toLowerCase();
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[\\\\/])${escaped}(?:$|[?#\\s])`).test(candidate)
      || String(source.name || "").trim().toLowerCase() === lower;
  });
}

function postNotesInitToOverlay(overlayId, targetWindow) {
  const overlay = findOverlay(overlayId);
  if (!overlay || !targetWindow) {
    return;
  }
  ensureDeckNotesStore();
  ensureOverlayNotesDefaults(overlay);
  if (!overlay.notesKey) {
    overlay.notesKey = uid();
    touch();
  }
  const record = state.deck.notes[overlay.notesKey];
  const deckDoc = record?.doc || "";
  const fallbackDoc = readNotesDraftFromStorage(overlay.notesKey);
  const doc = deckDoc || fallbackDoc || DEFAULT_NOTES_DOC;
  targetWindow.postMessage({
    type: "notes:init",
    notesKey: overlay.notesKey,
    doc,
    // Size and theme belong to the board, not to whichever browser last
    // opened it. Previously both lived in localStorage, so a deck looked
    // different on another machine and every board shared one size.
    settings: normalizeNotesSettings(record?.settings),
    pxPerPoint: getStageTextScale(),
  }, "*");
}

function normalizeNotesSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const theme = String(source.theme || "blue");
  return {
    fontSize: normalizeTextFontSize(source.fontSize, 18),
    theme: ["blue", "white", "black"].includes(theme) ? theme : "blue",
  };
}

// Stage geometry changes without the notes iframes reloading, so push the new
// point scale to every live board instead of leaving them at the old size.
function broadcastNotesScale() {
  const pxPerPoint = getStageTextScale();
  for (const [win] of state.notesIframeWindows) {
    try {
      win.postMessage({ type: "notes:scale", pxPerPoint }, "*");
    } catch {
      // Frame already gone; the next render re-initialises it.
    }
  }
}

function onWindowMessage(event) {
  const data = event?.data;
  if (!data || typeof data !== "object" || typeof data.type !== "string") {
    return;
  }

  if (data.type === "presenter:text-arm") {
    const overlayId = state.presenterTextBridgeWindows.get(event.source);
    if (!overlayId) {
      return;
    }
    state.presenterTypeKeyDown = false;
    setPresenterTextInsertArmed(true);
    dom.modeHint.textContent = "Text mode armed from embedded HTML. Click the slide to place or edit text.";
    return;
  }

  if (data.type !== "notes:request-init" && data.type !== "notes:change") {
    return;
  }

  const overlayId = state.notesIframeWindows.get(event.source);
  if (!overlayId) {
    return;
  }

  if (data.type === "notes:request-init") {
    postNotesInitToOverlay(overlayId, event.source);
    return;
  }

  const overlay = findOverlay(overlayId);
  if (!overlay) {
    return;
  }
  ensureDeckNotesStore();
  ensureOverlayNotesDefaults(overlay);
  if (!overlay.notesKey) {
    overlay.notesKey = uid();
  }

  const nextDoc = String(data.doc || DEFAULT_NOTES_DOC);
  const record = state.deck.notes[overlay.notesKey];
  const currentDoc = String(record?.doc || "");
  const nextSettings = normalizeNotesSettings(data.settings ?? record?.settings);
  const currentSettings = normalizeNotesSettings(record?.settings);
  const settingsChanged = nextSettings.fontSize !== currentSettings.fontSize
    || nextSettings.theme !== currentSettings.theme;
  if (nextDoc === currentDoc && !settingsChanged) {
    return;
  }

  state.deck.notes[overlay.notesKey] = {
    doc: nextDoc,
    settings: nextSettings,
    updatedAt: new Date().toISOString(),
  };
  writeNotesDraftToStorage(overlay.notesKey, nextDoc);
  touch();
  dom.modeHint.textContent = "Notes autosaved.";
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isImageFile(f) {
  const n = f.name.toLowerCase();
  return (
    f.type.startsWith("image/") ||
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".png") ||
    n.endsWith(".gif") ||
    n.endsWith(".svg")
  );
}

function isPdfFile(f) {
  const n = f.name.toLowerCase();
  return f.type === "application/pdf" || n.endsWith(".pdf");
}

function dataUrlToBlob(dataUrl, fallbackType = "application/octet-stream") {
  const raw = String(dataUrl || "");
  const commaIdx = raw.indexOf(",");
  if (commaIdx < 0) {
    return null;
  }
  const header = raw.slice(0, commaIdx);
  const payload = raw.slice(commaIdx + 1);
  const mimeMatch = header.match(/^data:([^;,]+)/i);
  const mime = mimeMatch?.[1] || fallbackType;

  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  return new Blob([new TextEncoder().encode(decodeURIComponent(payload))], { type: mime });
}

function isGifImageSource(source) {
  if (!source || typeof source !== "object") {
    return false;
  }
  const mime = String(source.mime || "").toLowerCase();
  const name = String(source.name || "").toLowerCase();
  const raw = String(source.dataUrl || "").trim().toLowerCase();
  return mime === "image/gif" || name.endsWith(".gif") || raw.startsWith("data:image/gif");
}

function getImageDisplayUrl(source) {
  if (!source || typeof source !== "object") {
    return "";
  }
  const raw = String(source.dataUrl || "").trim();
  if (!raw) {
    return "";
  }
  if (/^(blob:|https?:|file:)/i.test(raw)) {
    return raw;
  }
  if (!isGifImageSource(source)) {
    return raw;
  }

  const cacheKey = raw;
  const cached = state.runtimeImageUrls.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const blob = dataUrlToBlob(raw, "image/gif");
    if (!blob) {
      return raw;
    }
    const url = URL.createObjectURL(blob);
    state.runtimeImageUrls.set(cacheKey, url);
    return url;
  } catch {
    return raw;
  }
}

function revokeRuntimeImageUrls() {
  for (const url of state.runtimeImageUrls.values()) {
    if (typeof url === "string" && url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore browser-specific revocation races.
      }
    }
  }
  state.runtimeImageUrls.clear();
}

function getPdfDisplayUrl(source) {
  if (!source || typeof source !== "object") {
    return "";
  }
  const raw = String(source.dataUrl || "").trim();
  if (!raw) {
    return "";
  }
  if (/^(blob:|https?:|file:)/i.test(raw)) {
    return raw;
  }
  if (!/^data:application\/pdf/i.test(raw)) {
    return raw;
  }
  if (typeof source.runtimePdfUrl === "string" && source.runtimePdfUrl) {
    return source.runtimePdfUrl;
  }

  try {
    const blob = dataUrlToBlob(raw, "application/pdf");
    if (!blob) {
      return raw;
    }
    source.runtimePdfUrl = URL.createObjectURL(blob);
    return source.runtimePdfUrl;
  } catch {
    return raw;
  }
}

function revokeRuntimePdfUrlsFromDeck(deck) {
  const assets = deck?.assets;
  if (!assets || typeof assets !== "object") {
    return;
  }
  for (const asset of Object.values(assets)) {
    if (!asset || typeof asset !== "object") {
      continue;
    }
    if (typeof asset.runtimePdfUrl === "string" && asset.runtimePdfUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(asset.runtimePdfUrl);
      } catch {
        // Ignore revoke failures; URL may already be invalidated.
      }
      delete asset.runtimePdfUrl;
    }
  }
}

function isVideoFile(f) {
  const n = f.name.toLowerCase();
  return (
    f.type.startsWith("video/")
    || n.endsWith(".mp4")
    || n.endsWith(".webm")
    || n.endsWith(".ogv")
    || n.endsWith(".mov")
    || n.endsWith(".m4v")
  );
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function safeClampNumber(value, min, max, fallback) {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return clamp(n, min, max);
}

function sanitizeHexColor(value, fallback = "#000000") {
  const txt = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(txt)) {
    return txt.toLowerCase();
  }
  return fallback;
}

function normalizeTextBoxFontSize(value, fallback = 14) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }

  const defaultSize = Number(fallback);
  if (Number.isFinite(defaultSize) && defaultSize > 0) {
    return Math.round(defaultSize);
  }

  return 14;
}

function normalizeSlideName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

// The deck's file name: the title as typed, only the characters Windows does not allow in a name replaced.
// (sanitizeFileName below also turns spaces into "_"; it is still used for asset names.)
function deckFileBase(title) {
  const t = String(title || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 120);
  return t || "Untitled deck";
}

function sanitizeFileName(name) {
  return String(name || "deck").replace(/[^a-z0-9-_]+/gi, "_");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsText(file);
  });
}

function downloadBlob(blob, fileName) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

async function fingerprintFromDataUrl(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement("canvas");
  c.width = 9;
  c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;

  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const iA = (y * 9 + x) * 4;
      const iB = (y * 9 + x + 1) * 4;
      const a = luminance(d[iA], d[iA + 1], d[iA + 2]);
      const b = luminance(d[iB], d[iB + 1], d[iB + 2]);
      bits += a > b ? "1" : "0";
    }
  }

  return bits.padEnd(FINGERPRINT_BITS, "0").slice(0, FINGERPRINT_BITS);
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function fingerprintSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) {
      same++;
    }
  }
  return same / a.length;
}

function getSlideFileSize(slide) {
  const n = safeClampNumber(slide?.fileSize, 0, Number.MAX_SAFE_INTEGER, NaN);
  if (Number.isFinite(n)) {
    return n;
  }
  const asset = state.deck.assets?.[slide?.slideAssetId];
  return estimateDataUrlBytes(asset?.dataUrl || "");
}

function fileSizeSimilarity(a, b) {
  const aN = safeClampNumber(a, 0, Number.MAX_SAFE_INTEGER, 0);
  const bN = safeClampNumber(b, 0, Number.MAX_SAFE_INTEGER, 0);
  const max = Math.max(aN, bN);
  if (max <= 0) {
    return 0;
  }
  const diff = Math.abs(aN - bN);
  return clamp(1 - (diff / max), 0, 1);
}

function estimateDataUrlBytes(dataUrl) {
  const txt = String(dataUrl || "");
  const commaIdx = txt.indexOf(",");
  if (commaIdx < 0) {
    return 0;
  }
  const b64 = txt.slice(commaIdx + 1);
  if (!b64) {
    return 0;
  }
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ─── PowerPoint import ────────────────────────────────────────────────────────
// tools/pptx-export.ps1 has PowerPoint render every slide twice: as it is, and without its text and
// pictures (the words of filled boxes blanked, pictures hidden). The second picture becomes the slide; the
// text (paragraphs and runs with PowerPoint's own sizes, colours, bold/italic, alignment, bullets) and the
// pictures come back on top as editable text and movable image overlays. Rotated shapes, groups, tables,
// charts, SmartArt, equations and theme graphics stay in the picture. Animations and transitions are not
// carried, nor are speaker notes (a deck has no place for them; the count is reported). Slides hidden in
// PowerPoint stay hidden.
// Started by open-ipe.ps1 with ?pptx=<file address of manifest.json>.
// options.insert: the slides go after the current slide of the open deck (no title page, the deck keeps its
// file and settings) instead of becoming a new deck.
async function importPowerPointManifest(manifestUrl, options = {}) {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error("manifest: HTTP " + res.status);
  const m = await res.json();
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []); // PowerShell writes a one-item list as the item
  const load = async (rel) => {
    const r = await fetch(new URL(String(rel).replace(/\\/g, "/"), manifestUrl).href);
    if (!r.ok) throw new Error(rel + ": HTTP " + r.status);
    const blob = await r.blob();
    return { dataUrl: await fileToDataUrl(blob), size: blob.size };
  };

  const deck = createEmptyDeck();
  deck.meta.title = m.title || "PowerPoint import";
  if (Math.abs(m.widthPx / m.heightPx - 16 / 9) < 0.01) {
    Object.assign(deck.settings, { scaleLockMode: "hd1080", referenceWidth: 1920, referenceHeight: 1080 });
  }
  const ptScale = TEXT_REFERENCE_SLIDE_WIDTH / (Number(m.slideWidthPt) || 960); // font sizes: px on the 960-wide reference slide
  let notesCount = 0, animCount = 0, animMerged = 0, animSkipped = 0;

  for (const s of list(m.slides)) {
    const bg = await load(s.bg);
    const assetId = uid();
    deck.assets[assetId] = { id: assetId, kind: "slide-image", mime: "image/png", name: `${deck.meta.title} – slide ${s.n}.png`, dataUrl: bg.dataUrl };
    const name = s.title || `Slide ${s.n}`;
    const slide = createSlide(assetId, name, await fingerprintFromDataUrl(bg.dataUrl), bg.size);
    let z = 1;
    const overlayOf = new Map(); // PowerPoint shape id -> overlay id (for the animations)
    for (const sh of list(s.shapes).sort((a, b) => a.z - b.z)) {
      let x = +sh.x || 0, y = +sh.y || 0, w = +sh.w || 0.1, h = +sh.h || 0.05;
      const id = uid();
      if (sh.kind === "picture") {
        const p = await load(sh.file);
        deck.assets[id] = { id, kind: "overlay-image", mime: "image/png", name: `${sh.name || "Picture"}.png`, dataUrl: p.dataUrl };
      } else if (sh.kind === "text") {
        const src = pptxTextSource(id, sh, ptScale, list);
        deck.assets[id] = src;
        ensureOverlayTextSourceDefaults(src);
        // A text overlay pads its text by 0.25em / 0.4em of its font size; PowerPoint by the shape's own margins.
        // Grow the box by the difference, so the words land where PowerPoint put them.
        const refW = TEXT_REFERENCE_SLIDE_WIDTH, refH = refW * (Number(m.slideHeightPt) || 540) / (Number(m.slideWidthPt) || 960);
        const mg = sh.margins || {}, pt = (v, d) => (Number.isFinite(+v) ? +v : d) * ptScale;
        const dl = 0.4 * src.fontSize - pt(mg.left, 7.2), dr = 0.4 * src.fontSize - pt(mg.right, 7.2);
        const dt = 0.25 * src.fontSize - pt(mg.top, 3.6), db = 0.25 * src.fontSize - pt(mg.bottom, 3.6);
        x -= dl / refW; w += (dl + dr) / refW; y -= dt / refH; h += (dt + db) / refH;
      } else {
        continue;
      }
      // Overlays live inside the slide. The edge the text hangs from keeps its place: a box sticking out on the
      // left is trimmed when its text is right-aligned, otherwise shifted in (its width, and so its line breaks,
      // stay; the words move a few points at most). At the top: trimmed when the text hangs from the bottom or
      // middle (a header at the bottom of a box that starts above the slide), shifted down when it hangs from
      // the top. What then sticks out right / below is trimmed.
      const va = deck.assets[id].valign, ha = deck.assets[id].align;
      if (x < 0) { if (ha === "right") w += x; x = 0; }
      if (y < 0) { if (va === "top") y = 0; else { h += y; y = 0; } }
      if (x + w > 1) w = 1 - x;
      if (y + h > 1) h = 1 - y;
      const ov = createOverlay({ x: clamp(x, 0, 0.99), y: clamp(y, 0, 0.99), w: clamp(w, 0.005, 1), h: clamp(h, 0.005, 1) });
      ov.sourceId = id;
      ov.locked = false;
      ov.zIndex = ++z;
      slide.overlays.push(ov);
      if (sh.id != null) overlayOf.set(Number(sh.id), ov.id);
    }
    // PowerPoint's animations, in their order: entrance -> appear, exit -> remove; On Click -> after a click,
    // With Previous -> with the previous step; After Previous -> with the previous step, once that has played
    // (its length added to the delay). Appear / Disappear instant, other effects fade over PowerPoint's length.
    // Effects on single paragraphs (bullets one by one) stay per paragraph on text; on a box that came in as a
    // picture they become one step for the whole box. Shapes left in the picture cannot move: skipped.
    const seen = new Set();
    let prevLengthMs = 0;
    for (const a of list(s.animations)) {
      const ovId = overlayOf.get(Number(a.shapeId));
      if (!ovId) { animSkipped++; continue; }
      const isText = deck.assets[slide.overlays.find((o) => o.id === ovId)?.sourceId]?.kind === "overlay-text";
      const paragraph = isText ? Math.max(0, Math.round(Number(a.paragraph) || 0)) : 0;
      const key = `${ovId}/${paragraph}/${a.exit ? "out" : "in"}`;
      if (seen.has(key)) { animMerged++; continue; }
      seen.add(key);
      const lengthMs = a.fade ? clamp(Math.round((Number(a.duration) || 0.35) * 1000), 100, 2000) : 0;
      const delayMs = Math.round(Math.max(0, Number(a.delay) || 0) * 1000) + (a.trigger === "after" ? prevLengthMs : 0);
      const ev = {
        id: uid(), overlayId: ovId,
        action: `${a.exit ? "remove" : "appear"}-${a.trigger === "click" ? "after-click" : "with-previous"}`,
        durationMs: lengthMs,
      };
      if (delayMs > 0) ev.delayMs = Math.min(delayMs, 60000);
      if (paragraph > 0) ev.paragraph = paragraph;
      slide.animationEvents.push(ev);
      prevLengthMs = lengthMs;
      animCount++;
    }
    if (s.hidden) slide.hidden = true;
    if (String(s.notes || "").trim()) notesCount++;
    deck.slides.push(slide);
  }

  // The first slide of a deck is always Interactive Presenter's title page (isTitleSlide), which draws its own
  // title over the slide. So a title page goes in front, filled from PowerPoint's first slide (its title and
  // the first other text as subtitle), and every PowerPoint slide follows unchanged.
  if (options.insert && state.deck && Array.isArray(state.deck.slides)) {
    Object.assign(state.deck.assets, deck.assets);
    const at = state.deck.slides.length ? state.currentSlideIndex + 1 : 0;
    state.deck.slides.splice(at, 0, ...deck.slides);
    state.currentSlideIndex = at;
    state.selectedOverlayId = null;
    resetAnimationPlaybackForCurrentSlide();
    setDeckSessionReady(true);
    touch();
    renderAll();
    persistLastDeckToStorage();
    return { slides: deck.slides.length, inserted: true, notes: notesCount, animations: animCount, animMerged, animSkipped };
  }

  const first = list(m.slides)[0];
  const plain = (sh) => list(sh.paragraphs).map((p) => list(p.runs).map((r) => r.text).join("")).join(" ").replace(/[\v\u000b]+/g, " ").replace(/\s+/g, " ").trim();
  // the texts of slide 1, largest font first (not the slide number, not bare numbers)
  const sizeOf = (sh) => Math.max(0, ...list(sh.paragraphs).flatMap((p) => list(p.runs)).map((r) => (+r.size || 0) * (+sh.fontScale || 1)));
  const firstTexts = first ? list(first.shapes).filter((sh) => sh.kind === "text" && !sh.slideNumber && !/^\s*\d+\s*$/.test(plain(sh))).sort((a, b) => sizeOf(b) - sizeOf(a)).map(plain).filter(Boolean) : [];
  const titleAsset = uid();
  deck.assets[titleAsset] = { id: titleAsset, kind: "slide-image", mime: "image/svg+xml", name: "Blank HD slide", dataUrl: createDefaultWhiteHdSlideDataUrl() };
  const titleSlide = createSlide(titleAsset, "Title", "", 0);
  titleSlide.titleMain = (first && first.title) || firstTexts[0] || deck.meta.title;
  titleSlide.titleSubtitle = firstTexts.find((t) => t !== titleSlide.titleMain) || "";
  deck.slides.unshift(titleSlide);

  revokeRuntimePdfUrlsFromDeck(state.deck);
  revokeRuntimeImageUrls();
  state.deck = deck;
  state.currentSlideIndex = 0;
  state.selectedOverlayId = null;
  state.remapHistory = [];
  state.currentZipFileHandle = null;
  state.deckFileUrl = "";
  state.presentationRootFileUrl = "";
  resetAutosaveTargetKeepSelection();
  resetAnimationPlaybackForCurrentSlide();
  setDeckSessionReady(true);
  touch();
  renderAll();
  persistLastDeckToStorage();
  return { slides: deck.slides.length, notes: notesCount, animations: animCount, animMerged, animSkipped };
}

// One PowerPoint text shape -> an overlay-text source. The box gets the most used size/colour/font; runs that
// differ carry their own (size in em of the box size, so they scale with it).
function pptxTextSource(id, sh, ptScale, list) {
  const paras = list(sh.paragraphs);
  const runs = paras.flatMap((p) => list(p.runs));
  const most = (key) => {
    const w = new Map();
    for (const r of runs) w.set(r[key], (w.get(r[key]) || 0) + String(r.text || "").length);
    let best = null, n = -1;
    for (const [k, v] of w) if (v > n) { best = k; n = v; }
    return best;
  };
  const baseSize = (Number(most("size")) || 24) * (Number(sh.fontScale) || 1); // shrink-to-fit as PowerPoint draws it
  const baseColor = String(most("color") || "#000000");
  const baseFont = String(most("font") || "");
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\v\u000b]/g, "<br>");
  const runHtml = (r) => {
    const st = [];
    const size = r.size * (Number(sh.fontScale) || 1);
    if (r.size && Math.abs(size - baseSize) > 0.4) st.push(`font-size: ${Math.round((size / baseSize) * 1000) / 1000}em`);
    if (r.color && r.color !== baseColor) st.push(`color: ${r.color}`);
    if (r.font && r.font !== baseFont) st.push(`font-family: '${String(r.font).replace(/'/g, "")}', sans-serif`);
    if (r.bold) st.push("font-weight: bold");
    if (r.italic) st.push("font-style: italic");
    if (r.underline) st.push("text-decoration: underline");
    let h = esc(r.text);
    if (r.sup) h = `<sup>${h}</sup>`; else if (r.sub) h = `<sub>${h}</sub>`;
    return st.length ? `<span style="${st.join("; ")}">${h}</span>` : h;
  };
  const aligns = new Set(paras.map((p) => p.align || "left"));
  const boxAlign = aligns.size === 1 ? [...aligns][0] : "left";
  let html = "";
  let depth = 0; // open <ul> levels
  for (const p of paras) {
    const inner = list(p.runs).map(runHtml).join("") || "<br>";
    const alignStyle = aligns.size > 1 && p.align && p.align !== "left" ? ` style="text-align: ${p.align}"` : "";
    if (p.bullet) {
      const want = Math.max(1, Number(p.level) || 1);
      while (depth < want) { html += "<ul>"; depth++; }
      while (depth > want) { html += "</ul>"; depth--; }
      html += `<li${alignStyle}>${inner}</li>`;
    } else {
      while (depth > 0) { html += "</ul>"; depth--; }
      html += `<div${alignStyle}>${inner}</div>`;
    }
  }
  while (depth > 0) { html += "</ul>"; depth--; }
  return {
    id, kind: "overlay-text", mime: "text/plain", name: "Text", html, text: "",
    font: baseFont ? `'${baseFont.replace(/'/g, "")}', Arial, sans-serif` : "Arial, sans-serif",
    fontSize: Math.round(baseSize * ptScale * 10) / 10,
    bold: false, italic: false, underline: false,
    color: baseColor, shaded: false, fillColor: "#c8dcf0", fillOpacity: 0,
    align: boxAlign, valign: sh.valign || "top",
    autoFit: "shrink", lineHeight: Math.round(1.2 * (1 - (Number(sh.lineReduction) || 0)) * 100) / 100, // PowerPoint single spacing ~1.2
  };
}
