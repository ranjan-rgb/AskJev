import { createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

// Minimal zip writer (store + deflate) without external zip binary
import { Buffer } from "node:buffer";

async function walk(dir, base = dir, files = []) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, base, files);
    else if (!name.endsWith(".map") && name !== ".DS_Store") files.push(p);
  }
  return files;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const files = await walk("extension");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
mkdirSync("store", { recursive: true });
const outPath = `store/askjev-${version}.zip`;

const local = [];
const central = [];
let offset = 0;
for (const file of files) {
  const data = readFileSync(file);
  const name = relative("extension", file).replaceAll("\\", "/");
  const nameBuf = Buffer.from(name);
  const compressed = deflateRawSync(data);
  const crc = crc32(data);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x8, 6); // deflate
  localHeader.writeUInt16LE(20, 8);
  localHeader.writeUInt32LE(0, 10);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  const localRec = Buffer.concat([localHeader, nameBuf, compressed]);
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x8, 8);
  centralHeader.writeUInt16LE(20, 10);
  centralHeader.writeUInt32LE(0, 12);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(offset, 42);
  const centralRec = Buffer.concat([centralHeader, nameBuf]);
  local.push(localRec);
  central.push(centralRec);
  offset += localRec.length;
}
const centralDir = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDir.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);
writeFileSync(outPath, Buffer.concat([...local, centralDir, end]));
console.log("wrote", outPath);
