const fs = require('fs');
const path = require('path');
const asarPath = process.argv[2];
const outDir = process.argv[3];
const only = process.argv.slice(4); // optional list of relPaths to extract (others skipped)
const fd = fs.openSync(asarPath, 'r');
const stat = fs.fstatSync(fd);
const head = Buffer.alloc(8);
fs.readSync(fd, head, 0, 8, 0);
const headerPickleSize = head.readUInt32LE(4);
const headerBuf = Buffer.alloc(headerPickleSize);
fs.readSync(fd, headerBuf, 0, headerPickleSize, 8);
const full = headerBuf.toString('utf8');
const a = full.indexOf('{');
const b = full.lastIndexOf('}');
const header = JSON.parse(full.slice(a, b + 1));
const baseOffset = 8 + headerPickleSize;
let count = 0;
function walk(node, rel) {
  for (const name of Object.keys(node.files || {})) {
    const entry = node.files[name];
    const relPath = rel ? rel + '/' + name : name;
    if (entry.files) { walk(entry, relPath); continue; }
    if (only.length && !only.includes(relPath)) continue;
    const off = baseOffset + Number(entry.offset);
    const size = Number(entry.size);
    const dest = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const b = Buffer.alloc(size);
    fs.readSync(fd, b, 0, size, off);
    fs.writeFileSync(dest, b);
    count++;
    console.log('extracted', relPath, size);
  }
}
walk(header, '');
fs.closeSync(fd);
console.log('done', count);
