/* DTU Science Writer — renderer entry. Wires the modules together and opens the first document.
   Structure (see context.js): editor/ = editing surface, ui/ = toolbar, dialogs, status; doc/ = files, preview, export. */
import { app, api, onLoad } from './context.js';
import { NEW_DOC } from './editor/editor.js';
import { loadDocument, openPath } from './doc/files.js';
import { togglePreview } from './doc/preview.js';
import { wireZoom } from './ui/zoom.js';
import { wireSplitter } from './ui/splitter.js';
import { wirePartTabs } from './ui/parttabs.js';
import './ui/review.js';
import { togglePageBreaks } from './ui/toolbar.js';
import './ui/eqtools.js';
import './ui/figviewer.js';
import './ui/status.js';
import './ui/limits.js';
import './ui/commentspane.js';
import { wireToolbar } from './ui/toolbar.js';
import { wireUpdateBar } from './ui/updatebar.js';
import { loadSettings } from './ui/settings.js';
import { wireLockBar } from './ui/lockbar.js';
import { offerRecovery } from './ui/restore.js';
import './doc/safety.js';
import './testhook.js';

(async function boot() {
  app.info = await api.boot();
  await loadSettings();
  wireToolbar();
  wireZoom();
  wireSplitter();
  wirePartTabs();
  wireUpdateBar();
  wireLockBar();
  togglePreview(app.settings.preview !== false, false);     // as the user left it
  onLoad(() => togglePageBreaks(!!app.settings.pageBreaks, false));      // View → Page breaks in the text, as left
  // a file given on start (double-click), else the document open last time, else a new one
  const first = app.info.openPath || app.info.lastPath;
  if (!(first && await openPath(first))) loadDocument(NEW_DOC, null);
  app.view.focus();
  if (!app.info.test) await offerRecovery();         // unsaved work from a session that crashed
})();
