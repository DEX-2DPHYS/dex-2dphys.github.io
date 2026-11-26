/* Runs the bundled Typst compiler. One working folder per app session; media files are written once. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(process.env.LOCALAPPDATA || os.homedir(), 'dtu-science-writer-build');

function resolveTool(app) {
  const res = app.isPackaged ? process.resourcesPath : null;
  const exe = res ? path.join(res, 'typst', 'typst.exe') : path.join(BUILD, 'bin', 'typst.exe');
  const pkgs = res ? path.join(res, 'typst-packages') : path.join(ROOT, 'vendor', 'typst-packages');
  const fonts = res ? path.join(res, 'typst-fonts') : path.join(ROOT, 'assets', 'fonts');
  return { exe, pkgs, fonts };
}

class TypstRunner {
  constructor(app) {
    this.tool = resolveTool(app);
    this.dir = path.join(os.tmpdir(), 'dtu-science-writer', String(process.pid));
    fs.mkdirSync(path.join(this.dir, 'media'), { recursive: true });
    fs.mkdirSync(path.join(this.dir, 'out'), { recursive: true });
  }

  available() { return fs.existsSync(this.tool.exe); }

  writeMedia(media) {
    for (const m of media || []) {
      const safe = m.name.replace(/\\/g, '/');
      if (!/^media\/[A-Za-z0-9._-]+$/.test(safe)) continue;        // never write outside the work folder
      const p = path.join(this.dir, safe);
      if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(m.bytes));
    }
  }

  run(args) {
    return new Promise((resolve) => {
      execFile(this.tool.exe, args, { cwd: this.dir, timeout: 60000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, stderr: String(stderr || '') + (err && !stderr ? String(err.message) : '') });
      });
    });
  }

  common() {
    // system fonts are allowed (Times New Roman / Arial come from the system); math fonts ship in assets/fonts
    return ['--root', this.dir, '--package-path', this.tool.pkgs, '--font-path', this.tool.fonts, '--diagnostic-format', 'short'];
  }

  /** format 'svg' -> { pages: [svg text] }; format 'pdf' with out path -> { path }. */
  async compile({ source, media, format, out }) {
    if (!this.available()) return { error: 'The Typst layout engine was not found at ' + this.tool.exe };
    this.writeMedia(media);
    if (format !== 'query') fs.writeFileSync(path.join(this.dir, 'main.typ'), source, 'utf8');
    if (format === 'query') {
      // where the blocks are: [[index, page, y in pt], …] from the element the writer added (docToTypst positions)
      fs.writeFileSync(path.join(this.dir, 'pos.typ'), source, 'utf8');
      const r = await new Promise((resolve) => {
        execFile(this.tool.exe, ['query', ...this.common(), 'pos.typ', '<dswmap>', '--field', 'value', '--one'], { cwd: this.dir, timeout: 60000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
          (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
      });
      if (!r.ok) return { error: cleanDiag(r.stderr) };
      try { return { positions: JSON.parse(r.stdout) }; } catch (e) { return { error: 'positions could not be read' }; }
    }
    if (format === 'pdf') {
      const tmp = out + '.tmp-' + process.pid + '.pdf';
      const r = await this.run(['compile', ...this.common(), 'main.typ', tmp]);
      if (!r.ok) { try { fs.unlinkSync(tmp); } catch (_) {} return { error: cleanDiag(r.stderr) }; }
      try { fs.renameSync(tmp, out); } catch (e) { return { error: 'Could not write ' + out + ': ' + e.message }; }
      return { path: out };
    }
    const outDir = path.join(this.dir, 'out');
    for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
    const r = await this.run(['compile', ...this.common(), '--format', 'svg', 'main.typ', path.join('out', 'page-{0p}.svg')]);
    if (!r.ok) return { error: cleanDiag(r.stderr) };
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.svg')).sort();
    return { pages: files.map(f => fs.readFileSync(path.join(outDir, f), 'utf8')), warnings: cleanDiag(r.stderr) };
  }

  cleanup() { try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (_) {} }
}

function cleanDiag(s) {
  return String(s || '').split(/\r?\n/).filter(l => l.trim()).map(l => l.replace(/^.*?main\.typ:/, 'line ')).slice(0, 12).join('\n');
}

module.exports = { TypstRunner };
