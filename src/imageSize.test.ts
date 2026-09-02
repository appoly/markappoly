import { describe, expect, it } from "vitest";
// Resolves to shims/image-size via the alias in vitest.config.ts — the same
// module remark-docx gets in the production bundle.
import { imageSize } from "image-size";
import { imageSize as shimImageSize } from "../shims/image-size/index.js";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const i32le = (n: number) => [
  n & 0xff,
  (n >> 8) & 0xff,
  (n >> 16) & 0xff,
  (n >> 24) & 0xff,
];
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngChunk = (name: string, data: number[]) => [
  ...u32be(data.length),
  ...ascii(name),
  ...data,
  0,
  0,
  0,
  0, // crc (not checked)
];
const png = (w: number, h: number) =>
  bytes(PNG_SIG, pngChunk("IHDR", [...u32be(w), ...u32be(h), 8, 6, 0, 0, 0]));

/** JPEG segment: FF marker, 2-byte length (incl. itself), payload. */
const seg = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16be(payload.length + 2),
  ...payload,
];
const sof = (marker: number, w: number, h: number) =>
  seg(marker, [8, ...u16be(h), ...u16be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const app0 = seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const dqt = seg(0xdb, new Array(65).fill(1));
const sos = seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
const jpeg = (...segments: number[][]) =>
  bytes([0xff, 0xd8], ...segments, [0xff, 0xd9]);

const gif = (w: number, h: number, ver = "89a") =>
  bytes(ascii(`GIF${ver}`), u16le(w), u16le(h), [0xf7, 0, 0]);

const bmp = (w: number, h: number) =>
  bytes(ascii("BM"), new Array(16).fill(0), i32le(w), i32le(h), [1, 0, 24, 0]);

const svg = (attrs: string, prolog = "") =>
  new TextEncoder().encode(`${prolog}<svg ${attrs}><rect width="1" height="1"/></svg>`);

describe("imageSize shim", () => {
  it("is the module served for the bare `image-size` specifier", () => {
    expect(imageSize).toBe(shimImageSize);
  });

  it("reads PNG dimensions", () => {
    expect(imageSize(png(640, 480))).toEqual({ type: "png", width: 640, height: 480 });
  });

  it("reads Apple CgBI PNG dimensions", () => {
    const fried = bytes(
      PNG_SIG,
      pngChunk("CgBI", [0x50, 0, 0x20, 2]),
      pngChunk("IHDR", [...u32be(120), ...u32be(90), 8, 6, 0, 0, 0]),
    );
    expect(imageSize(fried)).toEqual({ type: "png", width: 120, height: 90 });
  });

  it("rejects a PNG without an IHDR chunk", () => {
    const bad = bytes(PNG_SIG, pngChunk("IDAT", [0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(() => imageSize(bad)).toThrow(/IHDR/);
    expect(() => imageSize(bytes(PNG_SIG, [0, 0]))).toThrow(/truncated/);
  });

  it("reads baseline and progressive JPEG dimensions", () => {
    expect(imageSize(jpeg(app0, dqt, sof(0xc0, 200, 300), sos))).toEqual({
      type: "jpg",
      width: 200,
      height: 300,
    });
    expect(imageSize(jpeg(app0, sof(0xc2, 1024, 768), sos))).toEqual({
      type: "jpg",
      width: 1024,
      height: 768,
    });
  });

  it("skips fill bytes, standalone markers and non-frame Cx segments", () => {
    const dht = seg(0xc4, new Array(20).fill(0));
    const restart = [0xff, 0xd0];
    const fill = [0xff, 0xff, 0xff];
    const data = jpeg(fill, app0, restart, dht, fill, sof(0xc1, 33, 44), sos);
    expect(imageSize(data)).toEqual({ type: "jpg", width: 33, height: 44 });
  });

  it("rejects JPEGs that carry no frame header", () => {
    expect(() => imageSize(jpeg(app0, sos))).toThrow(/no size found/);
    // A segment length pointing past the end of the buffer must not loop.
    const runaway = bytes([0xff, 0xd8], [0xff, 0xe1, 0xff, 0xff, 0, 0]);
    expect(() => imageSize(runaway)).toThrow(/no size found/);
    const zeroLength = bytes([0xff, 0xd8], [0xff, 0xe1, 0, 1, 0, 0]);
    expect(() => imageSize(zeroLength)).toThrow(/segment length/);
    // A start marker followed by nothing but fill bytes.
    const fillOnly = new Uint8Array(4096).fill(0xff);
    fillOnly[1] = 0xd8;
    expect(() => imageSize(fillOnly)).toThrow(/no size found/);
  });

  it("reads GIF dimensions for both versions", () => {
    expect(imageSize(gif(10, 20))).toEqual({ type: "gif", width: 10, height: 20 });
    expect(imageSize(gif(1, 2, "87a"))).toEqual({ type: "gif", width: 1, height: 2 });
  });

  it("reads BMP dimensions, including top-down bitmaps", () => {
    expect(imageSize(bmp(320, 240))).toEqual({ type: "bmp", width: 320, height: 240 });
    expect(imageSize(bmp(320, -240))).toEqual({ type: "bmp", width: 320, height: 240 });
  });

  it("reads SVG width/height attributes with units", () => {
    expect(imageSize(svg('width="300" height="150"'))).toEqual({
      type: "svg",
      width: 300,
      height: 150,
    });
    expect(imageSize(svg("width='10cm' height='5cm'"))).toEqual({
      type: "svg",
      width: 378,
      height: 189,
    });
    expect(imageSize(svg('width="2in" height="72pt"'))).toEqual({
      type: "svg",
      width: 192,
      height: 96,
    });
  });

  it("falls back to the viewBox, as mermaid output needs", () => {
    const mermaid =
      'id="mermaid-1" width="100%" xmlns="http://www.w3.org/2000/svg" ' +
      'style="max-width: 500px;" viewBox="0 0 500 250" role="graphics-document"';
    expect(imageSize(svg(mermaid))).toEqual({ type: "svg", width: 500, height: 250 });
    expect(imageSize(svg('viewBox="0, 0, 80, 40"'))).toEqual({
      type: "svg",
      width: 80,
      height: 40,
    });
    // One explicit dimension plus a viewBox keeps the aspect ratio.
    expect(imageSize(svg('width="200" viewBox="0 0 100 50"'))).toEqual({
      type: "svg",
      width: 200,
      height: 100,
    });
    expect(imageSize(svg('height="25" viewBox="0 0 100 50"'))).toEqual({
      type: "svg",
      width: 50,
      height: 25,
    });
  });

  it("finds the root element after an XML prolog and comments", () => {
    const prolog =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- generated -->\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n';
    expect(imageSize(svg('xmlns="http://www.w3.org/2000/svg" width="8" height="4"', prolog))).toEqual({
      type: "svg",
      width: 8,
      height: 4,
    });
  });

  it("rejects an SVG with no usable size", () => {
    expect(() => imageSize(svg('xmlns="http://www.w3.org/2000/svg"'))).toThrow(/viewBox/);
    expect(() => imageSize(svg('width="100%" height="100%"'))).toThrow(/viewBox/);
  });

  it("reports everything else as unknown without throwing", () => {
    const unknown = { type: "unknown", width: 0, height: 0 };
    const webp = bytes(ascii("RIFF"), [0x24, 0, 0, 0], ascii("WEBPVP8 "), new Array(20).fill(0));
    expect(imageSize(webp)).toEqual(unknown);
    // The formats behind the image-size advisories (ICNS, JXL, HEIF) are
    // simply not parsed here.
    expect(imageSize(bytes(ascii("icns"), [0, 0, 0, 8], new Array(64).fill(0)))).toEqual(unknown);
    expect(imageSize(bytes([0xff, 0x0a], new Array(64).fill(0)))).toEqual(unknown);
    expect(imageSize(bytes([0, 0, 0, 0x18], ascii("ftypheic"), new Array(64).fill(0)))).toEqual(unknown);
    expect(imageSize(new TextEncoder().encode("<html><body>404</body></html>"))).toEqual(unknown);
    expect(imageSize(new Uint8Array(0))).toEqual(unknown);
  });

  it("accepts an ArrayBuffer and views into larger buffers", () => {
    const data = png(7, 9);
    expect(imageSize(data.buffer.slice(0))).toEqual({ type: "png", width: 7, height: 9 });
    const padded = new Uint8Array(data.length + 16);
    padded.set(data, 8);
    expect(imageSize(padded.subarray(8, 8 + data.length))).toEqual({
      type: "png",
      width: 7,
      height: 9,
    });
  });
});
