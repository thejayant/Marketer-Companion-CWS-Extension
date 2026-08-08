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
const CODE = ['background.js', 'popup.js', 'config.js'];
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
execFileSync('powershell', ['-NoProfile', '-Command',
  `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' });

const size = fs.statSync(zipPath).size;
console.log(`\npackaged ${SHIP.length} files -> ${zipName} (${(size / 1024).toFixed(0)} KB)`);
console.log(`unpacked copy for test-loading: dist/`);
if (warn.length) console.log('\nbefore you submit:\n' + warn.map(m => '  ! ' + m).join('\n'));
