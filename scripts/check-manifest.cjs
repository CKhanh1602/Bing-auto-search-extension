const fs = require('node:fs');
const assert = require('node:assert/strict');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
for (const file of [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...manifest.web_accessible_resources.flatMap(r => r.resources)]) {
  assert.ok(fs.existsSync(file), `Missing packaged file: ${file}`);
}
console.log('MV3 manifest and packaged entry points: OK (browser load still requires manual QA)');
