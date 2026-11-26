/* "Save changes?" before closing or replacing a document with unsaved changes.
   Our own dialog, not the system message box, so the layout is safe against misclicks: "Don't save" stands alone
   on the left, Cancel and Save on the right, Save last and the default (Enter). Escape or a click outside the
   box cancels — nothing is ever discarded without clicking "Don't save" itself.
   Resolves 'save' | 'discard' | 'cancel'. */
import { app } from '../context.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function askSave(name) {
  // test mode: an unattended run must never wait for an answer
  if (app.info && app.info.test) return Promise.resolve('discard');
  return new Promise((resolve) => {
    let dlg = document.querySelector('#savedlg');
    if (!dlg) { dlg = document.createElement('div'); dlg.id = 'savedlg'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    dlg.innerHTML = '<div class="box" role="alertdialog" aria-labelledby="savedlg-title">'
      + '<h3 id="savedlg-title">Save the changes to “' + esc(name) + '”?</h3>'
      + '<p class="msg">Your changes are lost if you don’t save them.</p>'
      + '<div class="buttons"><button data-r="discard" class="quiet-danger">Don’t save</button><span class="grow"></span>'
      + '<button data-r="cancel">Cancel</button><button data-r="save" class="primary">Save</button></div></div>';
    const done = (r) => { dlg.hidden = true; dlg.onclick = dlg.onkeydown = null; if (app.view && r === 'cancel') app.view.focus(); resolve(r); };
    dlg.onclick = (e) => {
      if (e.target === dlg) return done('cancel');
      const r = e.target.dataset && e.target.dataset.r;
      if (r) done(r);
    };
    dlg.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done('cancel'); }
      // Enter acts on the focused button (Save unless the user tabbed elsewhere)
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); done('save'); }
    };
    dlg.hidden = false;
    dlg.querySelector('[data-r="save"]').focus();
  });
}
