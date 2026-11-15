// Builds the Chrome Web Store upload package.
//
// The working folder carries things the store must not receive: editor
// settings, tooling folders, changelogs. This copies only what the extension
// actually needs into dist/, validates it, and zips it.
//
//   node build.js
//
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');

// Everything the extension loads at runtime, and nothing else.
const SHIP = [
  'manifest.json',
  'background.js',
  'config.js',
  'net.js',
  'gsc-api.js',
  'ga-api.js',
  'callrail-api.js',
  'ads-reporting.js',
  'ads-api.js',
  'ads-ui.js',
  'ads-reporting.css',
  'gbp-api.js',
  'gbp-reporting.js',
  'gbp-ui.js',
  'gbp-reporting.css',
  'report-results.css',
  'popup.html',
  'popup.js',
  'panel.html',
  'privacy.html',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'icons/Google G.svg',
  'icons/Callrail.png'
];

const fail = [];
const warn = [];

// panel.html is generated from the popup source so navigation and panel markup
// cannot drift. Only data-mode changes between the two extension surfaces.
const popupPath = path.join(ROOT, 'popup.html');
const panelPath = path.join(ROOT, 'panel.html');
const popupSource = fs.readFileSync(popupPath, 'utf8');
const panelSource = popupSource.replace(
  '<html data-mode="popup">',
  `<!--
  panel.html is GENERATED from popup.html by build.js.
  Edit popup.html; data-mode="panel" activates the side-panel presentation.
-->
<html data-mode="panel">`
);
if (panelSource === popupSource) {
  console.error('BUILD FAILED\n  - popup.html is missing data-mode="popup"');
  process.exit(1);
}
fs.writeFileSync(panelPath, panelSource);

function check(condition, message, list = fail) {
  if (!condition) list.push(message);
  return condition;
}

// ---------- validate before packaging ----------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

check(!('update_url' in manifest), 'manifest has update_url — the store rejects packages containing it');
check(manifest.description.length <= 132, `description is ${manifest.description.length} chars, max is 132`);
check(manifest.name.length <= 75, `name is ${manifest.name.length} chars, max is 75`);
check(!manifest.short_name || manifest.short_name.length <= 12, 'short_name exceeds 12 chars');
check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(/^\d+(\.\d+){0,3}$/.test(manifest.version), `version "${manifest.version}" is not a valid store version`);

if ('key' in manifest) {
  warn.push('manifest has "key": the published item keeps extension ID ' +
    'lpodioiagjlpncibpgiopfbkpfeffjki. Confirm that matches the store item, ' +
    'or OAuth redirects will break after publishing.');
}

// No remote code — the single most common review rejection.
const CODE = ['background.js', 'popup.js', 'config.js', 'net.js', 'gsc-api.js', 'ga-api.js', 'callrail-api.js', 'ads-reporting.js', 'ads-api.js', 'ads-ui.js', 'gbp-api.js', 'gbp-reporting.js', 'gbp-ui.js'];
CODE.forEach(file => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  check(!/\beval\s*\(/.test(src), `${file} calls eval()`);
  check(!/new\s+Function\s*\(/.test(src), `${file} uses new Function()`);
  check(!/\bdebugger\b/.test(src), `${file} contains a debugger statement`);
});
['popup.html', 'panel.html', 'privacy.html'].forEach(file => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  check(!/<script(?![^>]*\ssrc=)[^>]*>/.test(src), `${file} has an inline <script> (blocked by CSP)`);
  check(!/<script[^>]+src=["']https?:/i.test(src), `${file} loads a remote script`);
  check(!/\son[a-z]+=["']/.test(src), `${file} has an inline event handler (blocked by CSP)`);
});

// popup.html and panel.html must not drift apart.
const popupCss = (fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8').match(/<style[\s\S]*?<\/style>/i) || [''])[0];
const panelCss = (fs.readFileSync(path.join(ROOT, 'panel.html'), 'utf8').match(/<style[\s\S]*?<\/style>/i) || [''])[0];
check(popupCss === panelCss, 'popup.html and panel.html stylesheets have drifted apart');

// Every shipped file must exist, and every runtime reference must be shipped.
SHIP.forEach(f => check(fs.existsSync(path.join(ROOT, f)), `missing file: ${f}`));

// A new module that nothing adds to SHIP loads fine unpacked and breaks the
// moment it is packaged, so follow every relative import of the shipped
// scripts and require it to be shipped too.
SHIP.filter(f => f.endsWith('.js')).forEach(file => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const match of src.matchAll(/(?:^|\s)(?:import|export)[^'"]*from\s*['"](\.\/[^'"]+)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1].slice(2)));
    check(SHIP.includes(target), `${file} imports ${match[1]}, which is not in the ship list`);
  }
});

Object.values(manifest.icons).forEach(i => check(SHIP.includes(i), `icon ${i} is not in the ship list`));

if (fail.length) {
  console.error('BUILD FAILED\n' + fail.map(m => '  - ' + m).join('\n'));
  process.exit(1);
}

// ---------- copy ----------
fs.rmSync(OUT, { recursive: true, force: true });
SHIP.forEach(rel => {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dest);
});

// ---------- zip ----------
const zipName = `marketer-companion-${manifest.version}.zip`;
const zipPath = path.join(ROOT, zipName);
fs.rmSync(zipPath, { force: true });

// Compress-Archive on Windows PowerShell writes entry names with backslashes
// (icons\icon16.png), which the ZIP spec does not allow and Chrome does not
// resolve: the manifest's icons then look missing to the store. Build the
// archive entry by entry so every name uses a forward slash.
const zipScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open('${zipPath}', 'Create')
try {
  foreach ($rel in @(${SHIP.map(f => `'${f.replace(/\\/g, '/')}'`).join(',')})) {
    $source = Join-Path '${OUT}' $rel.Replace('/', [IO.Path]::DirectorySeparatorChar)
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $source, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $zip.Dispose() }
`;
execFileSync('powershell', ['-NoProfile', '-Command', zipScript], { stdio: 'inherit' });

// Verify what actually landed in the archive, rather than trusting the writer.
const entryScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath}')
try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }
`;
const entries = execFileSync('powershell', ['-NoProfile', '-Command', entryScript], { encoding: 'utf8' })
  .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const backslashed = entries.filter(name => name.includes('\\'));
const missing = SHIP.filter(f => !entries.includes(f.replace(/\\/g, '/')));
if (backslashed.length || missing.length || entries.length !== SHIP.length) {
  console.error('BUILD FAILED — the archive is not what the store expects');
  backslashed.forEach(name => console.error(`  - entry uses a backslash: ${name}`));
  missing.forEach(name => console.error(`  - missing from the archive: ${name}`));
  if (entries.length !== SHIP.length) console.error(`  - archive holds ${entries.length} entries, expected ${SHIP.length}`);
  process.exit(1);
}

const size = fs.statSync(zipPath).size;
console.log(`\npackaged ${SHIP.length} files -> ${zipName} (${(size / 1024).toFixed(0)} KB)`);
console.log(`unpacked copy for test-loading: dist/`);
if (warn.length) console.log('\nbefore you submit:\n' + warn.map(m => '  ! ' + m).join('\n'));
