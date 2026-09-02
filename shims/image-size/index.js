/**
 * Local replacement for the `image-size` npm package.
 *
 * remark-docx depends on `image-size` only to read `{ width, height, type }`
 * from image bytes before embedding them in a .docx. Every published release of
 * `image-size` (<= 2.0.2) carries unfixed denial-of-service advisories in its
 * ICNS, JXL and HEIF parsers (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) and the
 * project has not shipped since April 2025. This module implements the same
 * function for just the formats remark-docx can embed (PNG, JPEG, GIF, BMP,
 * SVG). Every parser reads a fixed set of offsets or runs a loop that strictly
 * advances through the buffer, so crafted input cannot make it spin.
 *
 * Anything else reports `type: "unknown"` with zero dimensions, which
 * remark-docx treats as an unsupported image and skips with a warning.
 *
 * Wiring: npm cannot substitute a local folder for a transitive dependency
 * (a `file:` override is resolved relative to the dependent package and
 * yields a dangling link), so the registry package is replaced by the empty
 * `dry-uninstall` stub via `overrides` in package.json, and the bundler
 * aliases `image-size` to this file in vite.config.ts and vitest.config.ts.
 */

const decoder = new TextDecoder();

/** @param {Uint8Array} bytes @param {number} start @param {number} end */
const ascii = (bytes, start, end) => decoder.decode(bytes.subarray(start, end));

/** @param {Uint8Array} bytes @param {number} needed @param {string} format */
function ensure(bytes, needed, format) {
  if (bytes.length < needed) {
    throw new TypeError(`Invalid ${format}: truncated header`);
  }
}

/** @param {Uint8Array} bytes */
const view = (bytes) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** @param {Uint8Array} bytes */
function isPng(bytes) {
  return (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((b, i) => bytes[i] === b)
  );
}

/** @param {Uint8Array} bytes */
function png(bytes) {
  // Apple's "fried" PNGs from iOS asset catalogs insert a CgBI chunk before
  // IHDR, pushing the header back by 16 bytes.
  ensure(bytes, 16, "PNG");
  const fried = ascii(bytes, 12, 16) === "CgBI";
  const ihdr = fried ? 28 : 12;
  ensure(bytes, ihdr + 12, "PNG");
  if (ascii(bytes, ihdr, ihdr + 4) !== "IHDR") {
    throw new TypeError("Invalid PNG: missing IHDR chunk");
  }
  const dv = view(bytes);
  return {
    width: dv.getUint32(ihdr + 4, false),
    height: dv.getUint32(ihdr + 8, false),
  };
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/** @param {Uint8Array} bytes */
function isJpg(bytes) {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** Start-of-frame markers (SOF0–SOF15) carry the image dimensions. DHT (C4),
 *  JPG (C8) and DAC (CC) share the range but are not frames. */
const isStartOfFrame = (marker) =>
  marker >= 0xc0 &&
  marker <= 0xcf &&
  marker !== 0xc4 &&
  marker !== 0xc8 &&
  marker !== 0xcc;

/** @param {Uint8Array} bytes */
function jpg(bytes) {
  const dv = view(bytes);
  let i = 2;
  // Every branch advances `i`, so the loop always terminates.
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    // 0xFF fill bytes may precede a marker.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Standalone markers with no length field: TEM, RSTn, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    // Start of scan or end of image: no frame header was found before the
    // entropy-coded data, so there is no size to read.
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    if (i + 4 > bytes.length) {
      break;
    }
    const length = dv.getUint16(i + 2, false);
    if (length < 2) {
      throw new TypeError("Invalid JPG: bad segment length");
    }
    if (isStartOfFrame(marker)) {
      // Segment layout: length(2) precision(1) height(2) width(2)
      ensure(bytes, i + 9, "JPG");
      return {
        height: dv.getUint16(i + 5, false),
        width: dv.getUint16(i + 7, false),
      };
    }
    i += 2 + length;
  }
  throw new TypeError("Invalid JPG: no size found");
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

/** @param {Uint8Array} bytes */
function isGif(bytes) {
  return bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6));
}

/** @param {Uint8Array} bytes */
function gif(bytes) {
  ensure(bytes, 10, "GIF");
  const dv = view(bytes);
  return {
    width: dv.getUint16(6, true),
    height: dv.getUint16(8, true),
  };
}

// ---------------------------------------------------------------------------
// BMP
// ---------------------------------------------------------------------------

/** @param {Uint8Array} bytes */
function isBmp(bytes) {
  return bytes.length >= 2 && ascii(bytes, 0, 2) === "BM";
}

/** @param {Uint8Array} bytes */
function bmp(bytes) {
  ensure(bytes, 26, "BMP");
  const dv = view(bytes);
  return {
    width: dv.getUint32(18, true),
    // Negative height means a top-down bitmap; the magnitude is the size.
    height: Math.abs(dv.getInt32(22, true)),
  };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

// The root <svg …> tag. The alternatives are disjoint on their first character,
// so the pattern cannot backtrack catastrophically.
const SVG_ROOT = /<svg\s([^>"']|"[^"]*"|'[^']*')*>/;
// Percentage widths/heights are excluded: they only make sense relative to a
// container, and the viewBox is used instead.
const SVG_WIDTH = /\swidth=(['"])([^%]+?)\1/;
const SVG_HEIGHT = /\sheight=(['"])([^%]+?)\1/;
const SVG_VIEWBOX = /\sviewBox=(['"])(.+?)\1/i;

const INCH_CM = 2.54;
/** CSS absolute units → pixels at 96 dpi, plus em/ex at the browser defaults. */
const SVG_UNITS = {
  in: 96,
  cm: 96 / INCH_CM,
  em: 16,
  ex: 8,
  m: (96 / INCH_CM) * 100,
  mm: 96 / INCH_CM / 10,
  pc: 96 / 72 / 12,
  pt: 96 / 72,
  px: 1,
};
const SVG_LENGTH = new RegExp(
  `^([0-9.]+(?:e\\d+)?)(${Object.keys(SVG_UNITS).join("|")})?$`,
);

/** @param {string | undefined} value */
function svgLength(value) {
  if (value === undefined) return undefined;
  const m = SVG_LENGTH.exec(value.trim());
  if (!m) return undefined;
  const px = Math.round(Number(m[1]) * (SVG_UNITS[m[2]] || 1));
  return px > 0 ? px : undefined;
}

/** @param {Uint8Array} bytes */
function isSvg(bytes) {
  // Only the first few KB are scanned so large non-SVG buffers stay cheap.
  return SVG_ROOT.test(ascii(bytes, 0, Math.min(bytes.length, 4096)));
}

/** @param {Uint8Array} bytes */
function svg(bytes) {
  const root = ascii(bytes, 0, bytes.length).match(SVG_ROOT);
  if (!root) {
    throw new TypeError("Invalid SVG: no root element");
  }
  const tag = root[0];
  const width = svgLength(tag.match(SVG_WIDTH)?.[2]);
  const height = svgLength(tag.match(SVG_HEIGHT)?.[2]);
  if (width && height) {
    return { width, height };
  }

  const viewBox = tag.match(SVG_VIEWBOX)?.[2].trim().split(/[\s,]+/);
  const vbWidth = svgLength(viewBox?.[2]);
  const vbHeight = svgLength(viewBox?.[3]);
  if (!vbWidth || !vbHeight) {
    throw new TypeError("Invalid SVG: no usable width/height or viewBox");
  }

  const ratio = vbWidth / vbHeight;
  if (width) return { width, height: Math.floor(width / ratio) };
  if (height) return { width: Math.floor(height * ratio), height };
  return { width: vbWidth, height: vbHeight };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const FORMATS = [
  { type: "png", test: isPng, size: png },
  { type: "jpg", test: isJpg, size: jpg },
  { type: "gif", test: isGif, size: gif },
  { type: "bmp", test: isBmp, size: bmp },
  { type: "svg", test: isSvg, size: svg },
];

/**
 * @param {Uint8Array | ArrayBuffer} input
 * @returns {{ width: number, height: number, type: string }}
 */
export function imageSize(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  for (const format of FORMATS) {
    if (format.test(bytes)) {
      return { type: format.type, ...format.size(bytes) };
    }
  }
  return { type: "unknown", width: 0, height: 0 };
}

export default imageSize;
