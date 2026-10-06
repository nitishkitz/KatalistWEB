export type ThingFileType = "image" | "video" | "pdf" | "docx" | "excel" | "other" | "png" | "jpg";

export type ThingFile = {
  id: string;
  name: string;
  type: ThingFileType;
  url?: string;
  sizeLabel?: string;
  mimeType?: string;
  isNew?: boolean;
};

/** Files copied into the system clipboard (some browsers expose both paths). */
export function getClipboardFiles(clipboard: Pick<DataTransfer, "files" | "items">): File[] {
  // `DataTransfer.files` is the canonical file list. Some browsers also expose
  // each same file through `items`; merging both lists can duplicate one paste.
  const files = Array.from(clipboard.files);
  if (files.length) return files;

  const itemFiles: File[] = [];
  for (const item of Array.from(clipboard.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && !itemFiles.includes(file)) itemFiles.push(file);
  }
  return itemFiles;
}

export function detectFileType(fileName: string, mimeType?: string): ThingFileType {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mime = (mimeType || "").toLowerCase();

  // Images
  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif", "heic"].includes(ext)
  ) {
    return "image";
  }

  // Videos
  if (
    mime.startsWith("video/") ||
    ["mp4", "mov", "webm", "avi", "mkv", "wmv", "m4v"].includes(ext)
  ) {
    return "video";
  }

  // PDF
  if (mime === "application/pdf" || ext === "pdf") {
    return "pdf";
  }

  // Documents
  if (
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    ["docx", "doc", "rtf", "odt", "txt"].includes(ext)
  ) {
    return "docx";
  }

  // Spreadsheets / Excel
  if (
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    mime.includes("csv") ||
    ["xlsx", "xls", "csv", "numbers", "tsv"].includes(ext)
  ) {
    return "excel";
  }

  return "other";
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getSafeFileUrl(file: File): string {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      return URL.createObjectURL(file);
    } catch {
      // ignore
    }
  }
  return "";
}

// H01: the same 50MB cap already enforced client-side for Hub Files
// (HubFilesPanel.tsx) and List chat (ListChatPanel.tsx) attachments --
// Thing attachments (Magic Box, comment composer) had no size boundary
// at all before this, unlike those other two upload paths.
export const MAX_THING_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export async function processFileForUpload(file: File): Promise<ThingFile> {
  if (file.size > MAX_THING_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 50 MB.`);
  }
  const type = detectFileType(file.name, file.type);
  const sizeLabel = formatFileSize(file.size);
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // For video, PDF, docx, excel, or files >= 1MB:
  // Immediately create an object URL. This is instantaneous (0ms), avoids massive
  // base64 encoding memory bottlenecks, prevents network payload limit crashes in RPC calls,
  // and enables native browser streaming in <video> and <iframe src="blob:...#page=1">.
  if (type === "video" || type === "pdf" || type === "docx" || type === "excel" || file.size >= 1024 * 1024) {
    return {
      id,
      name: file.name,
      type,
      url: getSafeFileUrl(file),
      sizeLabel,
      mimeType: file.type || undefined,
      isNew: true,
    };
  }

  // For small images (< 1MB), read as data URL for persistent thumbnail preview
  const url = await new Promise<string>((resolve) => {
    const fallback = () => resolve(getSafeFileUrl(file));
    if (typeof FileReader === "undefined") {
      return fallback();
    }
    // Safety timer so the promise never hangs indefinitely
    const timer = setTimeout(fallback, 1200);
    try {
      const reader = new FileReader();
      reader.onload = () => {
        clearTimeout(timer);
        if (typeof reader.result === "string" && reader.result) {
          resolve(reader.result);
        } else {
          fallback();
        }
      };
      reader.onerror = () => {
        clearTimeout(timer);
        fallback();
      };
      reader.onabort = () => {
        clearTimeout(timer);
        fallback();
      };
      reader.readAsDataURL(file);
    } catch {
      clearTimeout(timer);
      fallback();
    }
  });

  return {
    id,
    name: file.name,
    type,
    url,
    sizeLabel,
    mimeType: file.type || undefined,
    isNew: true,
  };
}

function clickAnchor(href: string, downloadName: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = downloadName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * H03: a bare anchor click reports nothing -- a dead/expired URL, a CORS
 * failure, or a network error all looked identical to "download started" to
 * the caller. `blob:`/`data:` URLs are already local content with nothing to
 * fetch, so those still go straight to the anchor; a real network fetch is
 * only meaningful (and only where failure can actually be observed) for a
 * remote URL.
 */
export async function downloadFile(file: { name: string; url?: string }): Promise<void> {
  if (!file.url) throw new Error("No file URL available.");
  if (file.url.startsWith("blob:") || file.url.startsWith("data:")) {
    clickAnchor(file.url, file.name);
    return;
  }
  const response = await fetch(file.url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    clickAnchor(objectUrl, file.name);
  } finally {
    // Give the browser a moment to pick up the download before revoking --
    // revoking synchronously can race the anchor's own navigation in some
    // browsers.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
