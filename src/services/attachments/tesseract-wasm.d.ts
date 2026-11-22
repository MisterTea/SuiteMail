declare module "tesseract-wasm" {
  interface OCREngine {
    loadModel(model: ArrayBuffer): void;
    loadImage(image: ImageBitmap): void;
    getText(): string;
    clearImage(): void;
    destroy(): void;
  }

  export function createOCREngine(options?: { wasmBinary?: ArrayBuffer }): Promise<OCREngine>;
}
