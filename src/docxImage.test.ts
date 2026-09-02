import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDocx from "remark-docx";
import { imagePlugin } from "remark-docx/plugins/image";

// A 1x1 transparent PNG.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * remark-docx's image plugin measures images with `image-size`, which the
 * build aliases to shims/image-size. This drives that plugin end to end so a
 * regression in the shim's return shape or the alias wiring shows up here.
 */
describe("remark-docx image plugin with the image-size shim", () => {
  it("embeds a PNG in the generated .docx", async () => {
    const file = await unified()
      .use(remarkParse)
      .use(remarkDocx, { plugins: [imagePlugin()] })
      .process(`# Title\n\n![dot](${PNG_DATA_URL})\n`);

    const result = await (file.result as Promise<ArrayBuffer>);
    const zip = Buffer.from(result).toString("latin1");
    // Zip entry names are stored uncompressed, so the media file is greppable.
    expect(zip).toMatch(/word\/media\/[^\s]+\.png/);
  });
});
