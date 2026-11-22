let worker: { instance: Worker; ready: boolean } | null = null;

export async function extractAttachmentChunks(bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string[]> {
  const extractor = worker ??= {
    instance: new Worker(new URL("./attachmentExtraction.worker.ts", import.meta.url), { type: "module" }),
    ready: false,
  };
  const { instance } = extractor;
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeout);
      instance.removeEventListener("message", onMessage);
      instance.removeEventListener("error", onError);
    };
    const reset = (message: string) => {
      cleanup();
      instance.terminate();
      if (worker === extractor) worker = null;
      reject(new Error(message));
    };
    const send = () => {
      try {
        instance.postMessage({ bytes, mime }, [bytes.buffer]);
      } catch {
        reset("Attachment couldn’t be read by the extractor");
      }
    };
    const onMessage = (event: MessageEvent<{ ready?: boolean; chunks?: string[]; error?: string }>) => {
      if (event.data.ready) {
        extractor.ready = true;
        send();
        return;
      }
      cleanup();
      if (event.data.chunks) resolve(event.data.chunks);
      else reject(new Error(event.data.error ?? "Attachment extraction failed"));
    };
    const onError = (event: ErrorEvent) => reset(event.message || "Attachment extraction could not start");
    timeout = setTimeout(() => reset("Attachment extraction timed out"), 75_000);
    instance.addEventListener("message", onMessage);
    instance.addEventListener("error", onError, { once: true });
    // The parser initializes WebAssembly before the worker can accept messages.
    if (extractor.ready) send();
  });
}
