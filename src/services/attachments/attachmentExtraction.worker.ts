import * as kreuzberg from "@kreuzberg/wasm/pkg/kreuzberg_wasm.js";
import { initializePdfiumAsync, type WasmModule } from "@kreuzberg/wasm";
import { createOCREngine } from "tesseract-wasm";
import ocrAsset from "../../../node_modules/tesseract-wasm/dist/tesseract-core.wasm?url";
import languageAsset from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url";

const pdfium = initializePdfiumAsync(kreuzberg as WasmModule);
let engine: ReturnType<typeof createOCREngine> | undefined;

async function recognizeImage(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  engine ??= (async () => {
    const instance = await createOCREngine({ wasmBinary: await (await fetch(ocrAsset)).arrayBuffer() });
    try {
      const response = await fetch(languageAsset);
      if (!response.ok || !response.body) throw new Error("Couldn’t load the offline OCR model");
      const model = response.body.pipeThrough(new DecompressionStream("gzip"));
      instance.loadModel(await new Response(model).arrayBuffer());
      return instance;
    } catch (error) {
      instance.destroy();
      throw error;
    }
  })().catch((error) => {
    engine = undefined;
    throw error;
  });
  const ocr = await engine;
  const image = await createImageBitmap(new Blob([bytes]));
  try {
    ocr.loadImage(image);
    return ocr.getText();
  } finally {
    image.close();
    ocr.clearImage();
  }
}

const config = {
  chunking: { max_chars: 950, max_overlap: 140 },
  security_limits: { max_archive_size: 64 * 1024 * 1024, max_content_size: 4 * 1024 * 1024 },
  use_cache: false,
};

function textChunks(result: { content: string; chunks?: { content: string }[] }): string[] {
  return result.chunks?.map((chunk) => chunk.content) ?? [result.content];
}

async function chunkOcrText(text: string): Promise<string[]> {
  if (!text.trim()) return [];
  return textChunks(await kreuzberg.extractBytes(new TextEncoder().encode(text), "text/plain", config));
}

self.onmessage = async ({ data }: MessageEvent<{ bytes: Uint8Array<ArrayBuffer>; mime: string }>) => {
  try {
    await pdfium;
    if (data.mime.startsWith("image/")) {
      self.postMessage({ chunks: await chunkOcrText(await recognizeImage(data.bytes)) });
      return;
    }

    const isPdf = data.mime === "application/pdf";
    const result = await kreuzberg.extractBytes(data.bytes, data.mime, {
      ...config,
      ...(isPdf && { pages: { extract_pages: true } }),
    });
    const chunks = textChunks(result);
    if (isPdf) {
      const pages: { pageNumber: number; content: string }[] = result.pages ?? [];
      const pageCount = Number(result.metadata?.pageCount ?? result.metadata?.page_count ?? pages.length);
      const scannedPages = pages.length
        ? pages.flatMap((page, index) => page.content?.trim() ? [] : [(page.pageNumber || index + 1) - 1])
        : !result.content?.trim() ? Array.from({ length: Math.min(pageCount || 1, 40) }, (_, index) => index) : [];
      const recognized: string[] = [];
      for (const pageIndex of scannedPages.slice(0, 40)) {
        const page = new Uint8Array(kreuzberg.renderPdfPageSync(data.bytes, pageIndex, 150));
        recognized.push(await recognizeImage(page));
      }
      chunks.push(...await chunkOcrText(recognized.join("\n")));
    }
    self.postMessage({ chunks });
  } catch (error) {
    console.debug("Document extraction failed:", error instanceof Error ? error.message : "Unknown parser error");
    self.postMessage({ error: "Unable to extract searchable text from this attachment" });
  }
};

self.postMessage({ ready: true });
