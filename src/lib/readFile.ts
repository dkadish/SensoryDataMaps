// Robust file reading. Some browsers/OSes (notably macOS with iCloud/Dropbox
// "online-only" placeholder files, or a file that moved after selection) throw
// NotReadableError from Blob.text()/arrayBuffer(). We try the modern Blob API
// first, then fall back to FileReader, with a short retry, and surface a
// human-friendly message.

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readViaFileReader(file: File, kind: "text" | "arraybuffer"): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string | ArrayBuffer);
    fr.onerror = () => reject(fr.error ?? new Error("FileReader failed"));
    if (kind === "text") fr.readAsText(file);
    else fr.readAsArrayBuffer(file);
  });
}

function friendlyError(err: unknown, file: File): Error {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotReadableError" || name === "NotFoundError") {
    return new Error(
      `Couldn't read "${file.name}". If it lives in iCloud/Dropbox/OneDrive, ` +
        `make sure it's downloaded (not "online-only"), or copy it to your ` +
        `Desktop and try again. Re-selecting the file usually fixes it.`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function readWithFallback(
  file: File,
  kind: "text" | "arraybuffer",
): Promise<string | ArrayBuffer> {
  const attempts: Array<() => Promise<string | ArrayBuffer>> = [
    () => (kind === "text" ? file.text() : file.arrayBuffer()),
    () => readViaFileReader(file, kind),
    () => readViaFileReader(file, kind),
  ];
  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    try {
      return await attempts[i]();
    } catch (e) {
      lastErr = e;
      if (i < attempts.length - 1) await delay(150);
    }
  }
  throw friendlyError(lastErr, file);
}

export async function readTextFile(file: File): Promise<string> {
  return (await readWithFallback(file, "text")) as string;
}

export async function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  return (await readWithFallback(file, "arraybuffer")) as ArrayBuffer;
}
