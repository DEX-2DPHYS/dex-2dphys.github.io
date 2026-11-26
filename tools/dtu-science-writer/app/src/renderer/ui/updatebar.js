/* Update bar (same behaviour as DTU Planner):
   {} = newer source on disk, {version} = installer downloaded and checked, {version, download} = portable copy. */
import { api, $ } from '../context.js';
import { confirmDiscard } from '../doc/files.js';

export function wireUpdateBar() {
  api.onUpdate((info) => {
    info = info || {};
    $('#uptext').textContent = info.version
      ? (info.download ? 'DTU Science Writer ' + info.version + ' is out.' : 'DTU Science Writer ' + info.version + ' is ready to install.')
      : 'A newer version of DTU Science Writer is ready.';
    $('#upgo').textContent = info.download ? 'Download' : 'Restart now';
    $('#upgo').dataset.download = info.download || '';
    $('#updatebar').hidden = false;
  });
  $('#upgo').addEventListener('click', async () => {
    if ($('#upgo').dataset.download) { window.open($('#upgo').dataset.download); $('#updatebar').hidden = true; return; }
    if (!(await confirmDiscard())) return;          // unsaved changes: save / don't save / cancel first
    $('#upgo').disabled = true;
    api.restart();
  });
  $('#uplater').addEventListener('click', () => { $('#updatebar').hidden = true; });
}
