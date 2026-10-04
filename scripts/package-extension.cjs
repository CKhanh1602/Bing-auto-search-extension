// Reproducible ZIP using only Node built-ins. Files are stored without
// compression; fixed timestamps and the allowlist make output deterministic.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ROOT, EXTENSION_FILES } = require('./extension-files.cjs');
require('./check-manifest.cjs');

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const local = [], central = [];
let offset = 0;
for (const file of EXTENSION_FILES) {
  const name = Buffer.from(file, 'utf8');
  const data = fs.readFileSync(path.join(ROOT, file));
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6); // UTF-8 paths
  header.writeUInt16LE(33, 12); // January 1, 1980
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, data);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(0x800, 8);
  directory.writeUInt16LE(33, 14);
  directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(data.length, 20);
  directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(name.length, 28);
  directory.writeUInt32LE(offset, 42);
  central.push(directory, name);
  offset += header.length + name.length + data.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(EXTENSION_FILES.length, 8);
end.writeUInt16LE(EXTENSION_FILES.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...local, directory, end]);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const outputDir = path.join(ROOT, 'dist');
if (fs.existsSync(outputDir)) assert.ok(fs.lstatSync(outputDir).isDirectory() && !fs.lstatSync(outputDir).isSymbolicLink(), 'dist must be a real directory');
fs.mkdirSync(outputDir, { recursive: true });
const filename = `bing-search-automator-${manifest.version}.zip`;
const target = path.join(outputDir, filename);
if (fs.existsSync(target)) assert.ok(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(), 'ZIP output must be a regular file');
fs.writeFileSync(target, archive);
console.log(`Packaged dist/${filename}: ${EXTENSION_FILES.length} files, ${archive.length} bytes`);
console.log('SHA-256: ' + crypto.createHash('sha256').update(archive).digest('hex'));
