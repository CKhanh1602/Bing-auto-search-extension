const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// Runtime allowlist. Test fixtures, browser profiles, docs and developer tools
// must never be copied into the installable extension artifact.
const EXTENSION_FILES = Object.freeze([
  'manifest.json', 'background.js', 'quest-api.js', 'quest-ui.js',
  'popup.html', 'popup.css', 'popup.js', 'data/words.json',
  'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png', 'LICENSE'
]);

module.exports = { ROOT, EXTENSION_FILES };
