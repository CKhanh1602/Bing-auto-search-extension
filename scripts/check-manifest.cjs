const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, EXTENSION_FILES } = require('./extension-files.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version, 'Manifest and package versions must agree');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
for (const file of [...EXTENSION_FILES, manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon || {}), ...(manifest.web_accessible_resources || []).flatMap(r => r.resources),
  ...(manifest.content_scripts || []).flatMap(entry => entry.js || [])]) {
  assert.ok(EXTENSION_FILES.includes(file), `Referenced file omitted from package allowlist: ${file}`);
  const info = fs.lstatSync(path.join(ROOT, file), { throwIfNoEntry: false });
  assert.ok(info?.isFile() && !info.isSymbolicLink(), `Missing or non-regular packaged file: ${file}`);
}
const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/words.json'), 'utf8'));
assert.ok(Array.isArray(words) && words.length > 0 && words.every(word => typeof word === 'string' && word.trim()), 'Search word data must be a nonempty string array');
console.log('MV3 manifest, matching version, runtime allowlist and search data: OK');
