export interface ImageSizeResult {
  /** Pixel width, or 0 when `type` is "unknown". */
  width: number;
  /** Pixel height, or 0 when `type` is "unknown". */
  height: number;
  /** "png" | "jpg" | "gif" | "bmp" | "svg", or "unknown" for anything else. */
  type: "png" | "jpg" | "gif" | "bmp" | "svg" | "unknown";
}

/**
 * Read the pixel dimensions and format of an in-memory image.
 *
 * Throws a `TypeError` when the bytes are recognised as one of the supported
 * formats but are too short or malformed to carry a size.
 */
export function imageSize(input: Uint8Array | ArrayBuffer): ImageSizeResult;
export default imageSize;
