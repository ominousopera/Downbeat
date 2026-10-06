"use strict";
// Reads an excerpt of a WAV or AIFF file straight from disk, as mono 44100 Hz
// float samples, for the Library scan. SFX libraries are mostly WAV, often
// long 96 kHz / 24-bit recordings hundreds of MB big, which can exhaust the
// panel's memory if decoded there. Here only the bytes of the excerpt are
// read (fs.readSync at an offset), in the worker process, so the panel never
// holds the file at all.
// Extra chunks (bext, LIST, iXML, MARK...) are skipped. Anything else (RF64,
// compressed WAV such as ADPCM or MP3-in-WAV, compressed AIFF-C) throws
// UnsupportedWav; for a WAV the panel then falls back to decoding the file
// itself.
// Resampling is linear interpolation. That is enough for what reads these
// samples, tempo and key, which look at energy and pitch well below the band
// where interpolation errors live.
const fs = require("fs");

const TARGET_RATE = 44100;

class UnsupportedWav extends Error {}
// 80-bit IEEE 754 extended (big-endian), AIFF's sample-rate field.
function readExtended(b, o) {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  const mant = b.readUInt32BE(o + 2) * 4294967296 + b.readUInt32BE(o + 6);
  if (exp === 0 && mant === 0) {
    return 0;
  }
  return (b[o] & 0x80 ? -1 : 1) * mant * Math.pow(2, exp - 16383 - 63);
}

function readAiffHeader(fd, fileSize, isAifc) {
  let pos = 12;
  let fmt = null;
  const chunkHead = Buffer.alloc(8);
  while (pos + 8 <= fileSize) {
    fs.readSync(fd, chunkHead, 0, 8, pos);
    const id = chunkHead.toString("ascii", 0, 4);
    const size = chunkHead.readUInt32BE(4);
    if (id === "COMM") {
      const b = Buffer.alloc(Math.min(size, 26));
      fs.readSync(fd, b, 0, b.length, pos + 8);
      const channels = b.readInt16BE(0), bits = b.readInt16BE(6), rate = readExtended(b, 8);
      let format = 1, bigEndian = true;
      if (isAifc && b.length >= 22) {
        const comp = b.toString("ascii", 18, 22);
        if (comp === "sowt") { bigEndian = false; }
        else if (comp === "fl32" || comp === "FL32" || comp === "fl64" || comp === "FL64") { format = 3; }
        else if (comp !== "NONE") { throw new UnsupportedWav("compressed AIFF-C (" + comp + ")"); }
      }
      fmt = { format: format, channels: channels, rate: Math.round(rate), bits: bits,
              blockAlign: channels * Math.ceil(bits / 8), bigEndian: bigEndian, signed8: true };
    } else if (id === "SSND") {
      if (!fmt) {
        throw new UnsupportedWav("SSND chunk before COMM chunk");
      }
      const off = Buffer.alloc(8);
      fs.readSync(fd, off, 0, 8, pos + 8);
      const dataOffset = pos + 16 + off.readUInt32BE(0);
      const dataSize = Math.min(size - 8 - off.readUInt32BE(0), fileSize - dataOffset);
      return { fmt: fmt, dataOffset: dataOffset, dataSize: dataSize };
    }
    pos += 8 + size + (size % 2);
  }
  throw new UnsupportedWav("no SSND chunk");
}

function readHeader(fd, fileSize) {
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  const kind = head.toString("ascii", 8, 12);
  if (head.toString("ascii", 0, 4) === "FORM" && (kind === "AIFF" || kind === "AIFC")) {
    return readAiffHeader(fd, fileSize, kind === "AIFC");
  }
  if (head.toString("ascii", 0, 4) !== "RIFF" || kind !== "WAVE") {
    throw new UnsupportedWav("not a RIFF/WAVE or AIFF file (" + head.toString("ascii", 0, 4) + ")");
  }
  let pos = 12;
  let fmt = null;
  const chunkHead = Buffer.alloc(8);
  while (pos + 8 <= fileSize) {
    fs.readSync(fd, chunkHead, 0, 8, pos);
    const id = chunkHead.toString("ascii", 0, 4);
    const size = chunkHead.readUInt32LE(4);
    if (id === "fmt ") {
      const b = Buffer.alloc(Math.min(size, 40));
      fs.readSync(fd, b, 0, b.length, pos + 8);
      let format = b.readUInt16LE(0);
      if (format === 0xfffe && b.length >= 26) {
        format = b.readUInt16LE(24); // WAVE_FORMAT_EXTENSIBLE: the subformat GUID starts with the real tag
      }
      fmt = { format: format, channels: b.readUInt16LE(2), rate: b.readUInt32LE(4), blockAlign: b.readUInt16LE(12), bits: b.readUInt16LE(14) };
    } else if (id === "data") {
      if (!fmt) {
        throw new UnsupportedWav("data chunk before fmt chunk");
      }
      // A data size of 0 or past the end (streamed recorders) means "to the
      // end".
      const dataSize = (size === 0 || pos + 8 + size > fileSize) ? fileSize - pos - 8 : size;
      return { fmt: fmt, dataOffset: pos + 8, dataSize: dataSize };
    }
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  throw new UnsupportedWav("no data chunk");
}

function sampleReader(fmt) {
  const f = fmt.format, bits = fmt.bits;
  if (fmt.bigEndian) {
    if (f === 1 && bits === 16) { return function (b, o) { return b.readInt16BE(o) / 32768; }; }
    if (f === 1 && bits === 24) { return function (b, o) { return b.readIntBE(o, 3) / 8388608; }; }
    if (f === 1 && bits === 32) { return function (b, o) { return b.readInt32BE(o) / 2147483648; }; }
    if (f === 1 && bits === 8) { return function (b, o) { return b.readInt8(o) / 128; }; } // AIFF 8-bit is signed
    if (f === 3 && bits === 32) { return function (b, o) { return b.readFloatBE(o); }; }
    if (f === 3 && bits === 64) { return function (b, o) { return b.readDoubleBE(o); }; }
    throw new UnsupportedWav("unsupported AIFF sample format (" + bits + " bit)");
  }
  if (fmt.signed8 && f === 1 && bits === 8) { return function (b, o) { return b.readInt8(o) / 128; }; } // AIFF-C "sowt" 8-bit
  if (f === 1 && bits === 16) { return function (b, o) { return b.readInt16LE(o) / 32768; }; }
  if (f === 1 && bits === 24) { return function (b, o) { return b.readIntLE(o, 3) / 8388608; }; }
  if (f === 1 && bits === 32) { return function (b, o) { return b.readInt32LE(o) / 2147483648; }; }
  if (f === 1 && bits === 8) { return function (b, o) { return (b.readUInt8(o) - 128) / 128; }; }
  if (f === 3 && bits === 32) { return function (b, o) { return b.readFloatLE(o); }; }
  if (f === 3 && bits === 64) { return function (b, o) { return b.readDoubleLE(o); }; }
  throw new UnsupportedWav("unsupported sample format (tag " + f + ", " + bits + " bit)");
}
// Duration of the whole file, and the header, without reading audio.
function probe(path) {
  const fd = fs.openSync(path, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const h = readHeader(fd, size);
    const frameBytes = h.fmt.blockAlign || (h.fmt.channels * h.fmt.bits / 8);
    if (!frameBytes || !h.fmt.rate || !h.fmt.channels) {
      throw new UnsupportedWav("invalid fmt chunk");
    }
    sampleReader(h.fmt); // throws early for formats this cannot read
    return { header: h, frameBytes: frameBytes, durationSec: Math.floor(h.dataSize / frameBytes) / h.fmt.rate };
  } finally {
    fs.closeSync(fd);
  }
}
// Mono 44100 Hz samples of [startSec, startSec + lengthSec).
function readExcerpt(path, info, startSec, lengthSec) {
  const h = info.header, fmt = h.fmt, frameBytes = info.frameBytes;
  const totalFrames = Math.floor(h.dataSize / frameBytes);
  const first = Math.max(0, Math.min(totalFrames, Math.floor(startSec * fmt.rate)));
  const last = Math.max(first, Math.min(totalFrames, Math.ceil((startSec + lengthSec) * fmt.rate)));
  const frames = last - first;
  const raw = Buffer.alloc(frames * frameBytes);
  const fd = fs.openSync(path, "r");
  try {
    fs.readSync(fd, raw, 0, raw.length, h.dataOffset + first * frameBytes);
  } finally {
    fs.closeSync(fd);
  }
  const read = sampleReader(fmt);
  const bytesPerSample = fmt.bits / 8;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = i * frameBytes;
    for (let c = 0; c < fmt.channels; c++) {
      sum += read(raw, base + c * bytesPerSample);
    }
    mono[i] = sum / fmt.channels;
  }
  if (fmt.rate === TARGET_RATE) {
    return mono;
  }
  const outLength = Math.floor(frames * TARGET_RATE / fmt.rate);
  const out = new Float32Array(outLength);
  const step = fmt.rate / TARGET_RATE;
  for (let j = 0; j < outLength; j++) {
    const x = j * step;
    const k = Math.floor(x);
    const frac = x - k;
    const a = mono[k];
    const b = k + 1 < frames ? mono[k + 1] : a;
    out[j] = a + (b - a) * frac;
  }
  return out;
}
// The whole file, every channel, at its own rate - for the Library's preview
// pane, which plays it in stereo and draws its waveform. The caller checks
// the size first (probe's durationSec).
function readChannels(path, info) {
  const h = info.header, fmt = h.fmt, frameBytes = info.frameBytes;
  const frames = Math.floor(h.dataSize / frameBytes);
  const raw = Buffer.alloc(frames * frameBytes);
  const fd = fs.openSync(path, "r");
  try {
    fs.readSync(fd, raw, 0, raw.length, h.dataOffset);
  } finally {
    fs.closeSync(fd);
  }
  const read = sampleReader(fmt);
  const bytesPerSample = fmt.bits / 8;
  const channels = [];
  for (let c = 0; c < fmt.channels; c++) {
    channels.push(new Float32Array(frames));
  }
  for (let i = 0; i < frames; i++) {
    const base = i * frameBytes;
    for (let c = 0; c < fmt.channels; c++) {
      channels[c][i] = read(raw, base + c * bytesPerSample);
    }
  }
  return { channels: channels, sampleRate: fmt.rate };
}
// Reads bytes at an offset (a short read at end of file returns what is there).
function _readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n === len ? b : b.subarray(0, n);
}
function _skipId3(fd) {
  const h = _readAt(fd, 0, 10);
  if (h.length === 10 && h.toString("latin1", 0, 3) === "ID3") {
    const size = ((h[6] & 0x7f) << 21) | ((h[7] & 0x7f) << 14) | ((h[8] & 0x7f) << 7) | (h[9] & 0x7f);
    return 10 + size + ((h[5] & 0x10) ? 10 : 0);
  }
  return 0;
}
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
function _mp4Rate(fd, fileSize) {
  // top-level boxes: find moov
  let pos = 0;
  let moov = null;
  while (pos + 8 <= fileSize) {
    const h = _readAt(fd, pos, 16);
    let size = h.readUInt32BE(0);
    const type = h.toString("latin1", 4, 8);
    let head = 8;
    if (size === 1) { size = Number(h.readBigUInt64BE(8)); head = 16; }
    if (size === 0) { size = fileSize - pos; }
    if (size < head) { return null; }
    if (type === "moov") { moov = _readAt(fd, pos + head, Math.min(size - head, 64 * 1024 * 1024)); break; }
    pos += size;
  }
  if (!moov) { return null; }
  // walk moov > trak > mdia: a "soun" handler's mdhd timescale
  function boxes(buf, from, to, fn) {
    let p = from;
    while (p + 8 <= to) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString("latin1", p + 4, p + 8);
      if (size < 8 || p + size > to) { return; }
      fn(type, p + 8, p + size);
      p += size;
    }
  }
  let rate = null;
  boxes(moov, 0, moov.length, function (t, s0, e0) {
    if (t !== "trak" || rate) { return; }
    boxes(moov, s0, e0, function (t2, s1, e1) {
      if (t2 !== "mdia") { return; }
      let isSound = false, timescale = null;
      boxes(moov, s1, e1, function (t3, s2) {
        if (t3 === "hdlr") { isSound = moov.toString("latin1", s2 + 8, s2 + 12) === "soun"; }
        if (t3 === "mdhd") { timescale = moov[s2] === 1 ? moov.readUInt32BE(s2 + 20) : moov.readUInt32BE(s2 + 12); }
      });
      if (isSound && timescale >= 8000 && timescale <= 384000) { rate = timescale; }
    });
  });
  return rate;
}
// The sample rate a compressed file is stored at, read from its first bytes.
// The panel then decodes the file at exactly this rate, so nothing is
// resampled.
function nativeRate(path) {
  const fd = fs.openSync(path, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const head = _readAt(fd, 0, 12);
    const tag4 = head.toString("latin1", 0, 4);
    if (tag4 === "RIFF" && head.toString("latin1", 8, 12) === "WAVE") {
      try { return readHeader(fd, size).fmt.rate || null; } catch (e) { return null; }
    }
    if (head.toString("latin1", 4, 8) === "ftyp") {
      return _mp4Rate(fd, size);
    }
    if (tag4 === "OggS") {
      const page = _readAt(fd, 0, 512);
      const v = page.indexOf("\x01vorbis", 0, "latin1");
      if (v !== -1) { return page.readUInt32LE(v + 12) || null; }
      if (page.indexOf("OpusHead", 0, "latin1") !== -1) { return 48000; }
      return null;
    }
    const start = _skipId3(fd);
    const buf = _readAt(fd, start, 64 * 1024);
    if (buf.toString("latin1", 0, 4) === "fLaC") {
      // STREAMINFO is the first metadata block; its sample rate is 20 bits at byte 10.
      return ((buf[18] << 12) | (buf[19] << 4) | (buf[20] >> 4)) || null;
    }
    for (let i = 0; i + 4 < buf.length; i++) {
      if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { continue; }
      const b1 = buf[i + 1], b2 = buf[i + 2];
      if ((b1 & 0xf6) === 0xf0) { // ADTS: 12-bit sync, layer 00
        const idx = (b2 >> 2) & 0x0f;
        if (idx < ADTS_RATES.length) { return ADTS_RATES[idx]; }
        continue;
      }
      const version = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, bitrate = b2 >> 4, srIdx = (b2 >> 2) & 3;
      if (version === 1 || layer === 0 || bitrate === 0 || bitrate === 15 || srIdx === 3) { continue; }
      return MP3_RATES[version][srIdx];
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { probe, readExcerpt, readChannels, nativeRate, UnsupportedWav, TARGET_RATE };
