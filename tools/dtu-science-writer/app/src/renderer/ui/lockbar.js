/* The read-only bar: "Being edited by … since …", with Save a copy. */
import { app, $, onLoad, onReadOnly, runCommand } from '../context.js';

function render() {
  const bar = $('#lockbar');
  if (!app.readOnly) { bar.hidden = true; document.body.classList.remove('read-only'); return; }
  const o = app.lockOwner || {};
  const since = o.opened ? new Date(o.opened).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  $('#locktext').textContent = 'Read-only: ' + (o.user ? o.user + (o.machine ? ' on ' + o.machine : '') : 'someone else') + ' is editing this document' + (since ? ' (since ' + since + ')' : '') + '. You can still comment and reply — they see it within a minute. It becomes editable here as soon as they close it.';
  bar.hidden = false;
  document.body.classList.add('read-only');
}

export function wireLockBar() {
  $('#lockcopy').addEventListener('click', () => runCommand('saveAs'));
  onLoad(render);
  onReadOnly(render);
}
