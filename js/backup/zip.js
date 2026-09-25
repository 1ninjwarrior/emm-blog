// Em&m Blog: a small zip writer + random-access reader for backups (no ZIP64, like the app).
// Writer: builds the archive as a Blob made of parts, so STORED media are never copied into memory
// (only read once for their CRC-32). Reader: parses the central directory with Blob.slice, so a big
// backup's photos come out as zero-copy Blob slices; DEFLATEd entries are inflated with fflate.
import { deflateSync, inflateSync } from '../vendor/fflate.js';

// ---------- CRC-32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export class ZipWriter {
  constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; }

  /** Add an entry. data: Uint8Array | string | Blob. deflate: compress it (JSON); media stay STORED. */
  async add(name, data, { deflate = false, mtime = new Date() } = {}) {
    let raw, blob = null;
    if (typeof data === 'string') raw = enc.encode(data);
    else if (data instanceof Uint8Array) raw = data;
    else blob = data;
    let crc, size, payload, method = 0, csize;
    if (blob) {
      // Read in chunks for the CRC so a big video never sits in memory twice.
      crc = 0; size = blob.size;
      const CH = 4 * 1024 * 1024;
      for (let o = 0; o < size; o += CH) crc = crc32(new Uint8Array(await blob.slice(o, o + CH).arrayBuffer()), crc);
      payload = blob; csize = size;
    } else {
      crc = crc32(raw); size = raw.length;
      if (deflate) { payload = deflateSync(raw, { level: 6 }); method = 8; } else payload = raw;
      csize = payload.length ?? payload.size;
    }
    if (this.offset + csize > 0xfffffff0) throw Object.assign(new Error('too big'), { code: 'too_big' });
    const nameB = enc.encode(name);
    const { time, date } = dosTime(mtime);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, csize, true);
    lh.setUint32(22, size, true); lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
    this.parts.push(lh.buffer, nameB, payload);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, csize, true); ch.setUint32(24, size, true); ch.setUint16(28, nameB.length, true);
    ch.setUint32(42, this.offset, true);
    this.central.push(ch.buffer, nameB);
    this.offset += 30 + nameB.length + csize;
    this.count++;
  }

  /** The finished archive. */
  finish(type = 'application/zip') {
    const cdSize = this.central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.count, true); end.setUint16(10, this.count, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end.buffer], { type });
  }
}

/** Open a zip Blob/File. Resolves {entries: Map<name, entry>, text(name), bytes(name), blob(name, type)}. */
export async function openZip(file) {
  const size = file.size;
  if (size < 22) throw Object.assign(new Error('not a zip'), { code: 'not_zip' });
  const tailLen = Math.min(size, 65557);
  const tail = new Uint8Array(await file.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error('not a zip'), { code: 'not_zip' });
  const dv = new DataView(tail.buffer, eocd);
  const count = dv.getUint16(10, true), cdSize = dv.getUint32(12, true), cdOff = dv.getUint32(16, true);
  if (count === 0xffff || cdOff === 0xffffffff) throw Object.assign(new Error('zip64'), { code: 'too_big' });
  if (cdOff + cdSize > size) throw Object.assign(new Error('damaged'), { code: 'damaged' });
  const cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const cv = new DataView(cd.buffer);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cv.getUint32(p, true) !== 0x02014b50) throw Object.assign(new Error('damaged'), { code: 'damaged' });
    const method = cv.getUint16(p + 10, true), crc = cv.getUint32(p + 16, true);
    const csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
    const nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true);
    const lho = cv.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
    if (!name.endsWith('/')) entries.set(name, { name, method, crc, csize, usize, lho });
    p += 46 + nl + xl + cl;
  }
  async function dataRange(e) {
    const lh = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer());
    if (lh.getUint32(0, true) !== 0x04034b50) throw Object.assign(new Error('damaged'), { code: 'damaged' });
    const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (start + e.csize > size) throw Object.assign(new Error('damaged'), { code: 'damaged' });
    return start;
  }
  async function bytes(name, { verify = true, max = 512 * 1024 * 1024 } = {}) {
    const e = entries.get(name);
    if (!e) return null;
    if (e.usize > max) throw Object.assign(new Error('too big'), { code: 'too_big' });
    const start = await dataRange(e);
    const comp = new Uint8Array(await file.slice(start, start + e.csize).arrayBuffer());
    let out;
    if (e.method === 0) out = comp;
    else if (e.method === 8) out = inflateSync(comp, { out: new Uint8Array(e.usize) });
    else throw Object.assign(new Error('method'), { code: 'damaged' });
    if (out.length !== e.usize || (verify && crc32(out) !== e.crc)) throw Object.assign(new Error('crc'), { code: 'damaged' });
    return out;
  }
  return {
    entries,
    bytes,
    async text(name) { const b = await bytes(name); return b ? dec.decode(b) : null; },
    /** A Blob for an entry: STORED entries are zero-copy slices; others are inflated. */
    async blob(name, type = '') {
      const e = entries.get(name);
      if (!e) return null;
      if (e.method === 0) { const s = await dataRange(e); return file.slice(s, s + e.csize, type); }
      return new Blob([await bytes(name)], { type });
    },
  };
}

export const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm' };
export const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
