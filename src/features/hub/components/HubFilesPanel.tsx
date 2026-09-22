import { useRef, useState } from "react";
import {
  Folder,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileArchive,
  File as FileIcon,
  Upload,
  FolderPlus,
  LayoutList,
  LayoutGrid,
  MoreVertical,
  Download,
  Pencil,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileListSkeleton } from "@/components/katalist/ScreenSkeletons";
import { formatFileSize } from "@/lib/file-utils";
import { detectFileType } from "@/lib/file-utils";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { useHubFiles, getHubFileUrl, type HubFile } from "@/features/hub/use-hub-files";
import type { ChatAttachment } from "@/features/lists/use-list-messages";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type ChatFileEntry = { id: string; attachment: ChatAttachment; author: string; at: string };

type ImagePreview = { name: string; url: string; sizeLabel?: string };

function fileVisual(f: HubFile): { label: string; Icon: typeof FileIcon; tint: string } {
  if (f.isFolder) return { label: "Folder", Icon: Folder, tint: "text-[#f2b70a]" };
  const t = detectFileType(f.name, f.mime ?? undefined);
  switch (t) {
    case "image":
      return { label: (f.name.split(".").pop() || "IMG").toUpperCase(), Icon: FileImage, tint: "text-[#12a15f]" };
    case "pdf":
      return { label: "PDF", Icon: FileText, tint: "text-[#e5484d]" };
    case "docx":
      return { label: "DOCX", Icon: FileText, tint: "text-[#2874f4]" };
    case "excel":
      return { label: "XLSX", Icon: FileSpreadsheet, tint: "text-[#12a15f]" };
    default: {
      const ext = (f.name.split(".").pop() || "FILE").toUpperCase();
      if (["zip", "rar", "7Z", "7z", "gz", "tar"].includes(ext.toLowerCase()))
        return { label: ext, Icon: FileArchive, tint: "text-[#8b5cf6]" };
      return { label: ext.length <= 5 ? ext : "FILE", Icon: FileIcon, tint: "text-[#6a769c]" };
    }
  }
}

export function HubFilesPanel({
  listId,
  conversationTitle,
  chatAttachments = [],
}: {
  listId: string;
  conversationTitle: string;
  chatAttachments?: ChatFileEntry[];
}) {
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const parentId = path.length ? path[path.length - 1].id : null;
  const { files, isLoading, createFolder, upload, rename, remove } = useHubFiles(listId, parentId);
  const [view, setView] = useState<"list" | "grid">("list");
  const [query, setQuery] = useState("");
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImagePreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const q = query.trim().toLowerCase();
  const shown = q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files;

  const handleUpload = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Files must be 50 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      await upload.mutateAsync(file);
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    try {
      await createFolder.mutateAsync(name);
      setFolderName("");
      setNewFolder(false);
    } catch (err) {
      toast.error(domainErrorMessage(err));
    }
  };

  const openItem = async (f: HubFile) => {
    if (f.isFolder) {
      setPath((p) => [...p, { id: f.id, name: f.name }]);
      return;
    }
    if (!f.storagePath) return;
    const url = await getHubFileUrl(f.storagePath);
    if (!url) return;
    // Images open in-place in a large preview dialog; everything else (PDF,
    // docs, etc.) still opens in a new tab — there's no in-app viewer for those.
    if (detectFileType(f.name, f.mime ?? undefined) === "image") {
      setPreview({ name: f.name, url, sizeLabel: f.size ? formatFileSize(f.size) : undefined });
      return;
    }
    window.open(url, "_blank", "noopener");
  };

  const download = async (f: HubFile) => {
    if (!f.storagePath) return;
    const url = await getHubFileUrl(f.storagePath);
    if (url) window.open(url, "_blank", "noopener");
  };

  const doRename = async (f: HubFile) => {
    const next = window.prompt("Rename to", f.name);
    if (!next || next.trim() === f.name) return;
    try {
      await rename.mutateAsync({ id: f.id, name: next });
    } catch (err) {
      toast.error(domainErrorMessage(err));
    }
  };

  const doRemove = async (f: HubFile) => {
    if (!window.confirm(`Delete "${f.name}"? ${f.isFolder ? "Everything inside is removed too." : ""}`)) return;
    try {
      await remove.mutateAsync(f);
    } catch (err) {
      toast.error(domainErrorMessage(err));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white px-5 py-4">
      {/* Header: breadcrumb + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 text-[14px] font-medium text-[#000533]">
          <button type="button" onClick={() => setPath([])} className="hover:text-[#975ee2]">
            {conversationTitle} / Files
          </button>
          {path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-[#c5cae0]" />
              <button
                type="button"
                onClick={() => setPath((prev) => prev.slice(0, i + 1))}
                className="hover:text-[#975ee2]"
              >
                {p.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNewFolder((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#ebecf7] px-3 text-[12.5px] font-medium text-[#3d3f74] hover:border-[#975ee2]"
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#975ee2] px-3 text-[12.5px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {busy ? "Uploading…" : "Upload"}
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => void handleUpload(e.target.files?.[0])} />
        </div>
      </div>

      {newFolder && (
        <div className="mt-3 flex items-center gap-2">
          <input
            autoFocus
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitFolder();
              if (e.key === "Escape") {
                setNewFolder(false);
                setFolderName("");
              }
            }}
            placeholder="Folder name"
            className="h-9 w-56 rounded-[9px] border border-[#ebecf7] bg-[#f9f9fe] px-3 text-[12.5px] outline-none focus:border-[#975ee2]"
          />
          <button
            type="button"
            onClick={() => void submitFolder()}
            className="inline-flex h-9 items-center rounded-[9px] bg-[#975ee2] px-3 text-[12.5px] font-semibold text-white"
          >
            Create
          </button>
        </div>
      )}

      {/* Search + view toggle */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files and folders..."
          className="h-9 w-full max-w-[360px] rounded-[9px] border border-[#ebecf7] bg-[#f9f9fe] px-3 text-[12.5px] outline-none focus:border-[#975ee2]"
        />
        <div className="flex items-center rounded-[9px] border border-[#ebecf7] p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn("inline-flex h-8 items-center gap-1 rounded-[7px] px-2 text-[12px]", view === "list" ? "bg-[#f0e9fb] text-[#6638ec]" : "text-[#8487a7]")}
          >
            <LayoutList className="h-4 w-4" /> List
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            className={cn("inline-flex h-8 items-center gap-1 rounded-[7px] px-2 text-[12px]", view === "grid" ? "bg-[#f0e9fb] text-[#6638ec]" : "text-[#8487a7]")}
          >
            <LayoutGrid className="h-4 w-4" /> Grid
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {path.length === 0 && chatAttachments.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">Shared in chat</p>
            <div className="space-y-2">
              {chatAttachments
                .slice()
                .reverse()
                .map((entry) => {
                  const a = entry.attachment;
                  const isImage = (a.mime ?? "").startsWith("image/");
                  return (
                    <a
                      key={entry.id}
                      href={a.url}
                      target={isImage ? undefined : "_blank"}
                      rel="noreferrer"
                      onClick={(e) => {
                        if (!isImage || !a.url) return;
                        e.preventDefault();
                        setPreview({ name: a.name, url: a.url, sizeLabel: a.size ? formatFileSize(a.size) : undefined });
                      }}
                      className="flex items-center gap-3 rounded-[10px] border border-[#eef0f6] px-3 py-2.5 hover:border-[#975ee2]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eef0f6] text-[#6a769c]">
                        {isImage ? <FileImage className="h-4.5 w-4.5" /> : <FileText className="h-4.5 w-4.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-[#000533]">{a.name}</span>
                        <span className="block text-[11px] text-[#8487a7]">
                          {entry.author} · {new Date(entry.at).toLocaleDateString([], { day: "numeric", month: "short" })}
                          {a.size ? ` · ${formatFileSize(a.size)}` : ""}
                        </span>
                      </span>
                      <Download className="h-4 w-4 shrink-0 text-[#8487a7]" />
                    </a>
                  );
                })}
            </div>
          </div>
        )}
        {isLoading ? (
          <FileListSkeleton />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Folder className="h-9 w-9 text-[#c5cae0]" />
            <p className="mt-2 text-[13px] font-semibold text-[#000533]">This folder is empty</p>
            <p className="mt-1 text-[11.5px] text-[#6a769c]">Upload a file or create a folder to get started.</p>
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((f) => {
              const v = fileVisual(f);
              return (
                <button
                  key={f.id}
                  type="button"
                  onDoubleClick={() => void openItem(f)}
                  onClick={() => (f.isFolder ? void openItem(f) : void download(f))}
                  className="flex flex-col items-center gap-2 rounded-[12px] border border-[#eef0f6] p-4 text-center hover:border-[#975ee2]"
                >
                  <v.Icon className={cn("h-9 w-9", v.tint)} />
                  <span className="w-full truncate text-[12.5px] font-medium text-[#000533]">{f.name}</span>
                  <span className="text-[11px] text-[#8487a7]">{f.isFolder ? "Folder" : f.size ? formatFileSize(f.size) : ""}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-[#eef0f6] text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Owner</th>
                <th className="px-3 py-2.5">Modified</th>
                <th className="px-3 py-2.5">Size</th>
                <th className="py-2.5 pr-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => {
                const v = fileVisual(f);
                return (
                  <tr key={f.id} className="border-b border-[#f2f3f9] last:border-0 hover:bg-[#faf9fe]">
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => void openItem(f)}
                        className="flex items-center gap-2.5 text-left"
                      >
                        <v.Icon className={cn("h-5 w-5 shrink-0", v.tint)} />
                        <span className="truncate text-[13px] font-medium text-[#000533]">{f.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#3d3f74]">{v.label}</td>
                    <td className="px-3 py-3 text-[12.5px] text-[#3d3f74]">{f.ownerName}</td>
                    <td className="px-3 py-3 text-[12.5px] text-[#3d3f74]">
                      {new Date(f.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#3d3f74]">{f.isFolder ? "—" : f.size ? formatFileSize(f.size) : "—"}</td>
                    <td className="py-3 pr-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8487a7] hover:bg-muted hover:text-foreground"
                            aria-label="File actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 bg-white">
                          {!f.isFolder ? (
                            <DropdownMenuItem className="cursor-pointer text-[12.5px]" onClick={() => void download(f)}>
                              <Download className="mr-2 h-3.5 w-3.5" />
                              Download
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem className="cursor-pointer text-[12.5px]" onClick={() => void doRename(f)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="cursor-pointer text-[12.5px] text-[#e5484d] focus:text-[#e5484d]"
                            onClick={() => void doRemove(f)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Giant in-app image preview — replaces navigating to a new tab. */}
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-[92vw] w-fit gap-0 border-none bg-transparent p-0 shadow-none sm:rounded-none">
          {preview ? (
            <div className="flex max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-[#eef0f6] px-4 py-2.5">
                <DialogTitle className="min-w-0 truncate text-[13px] font-medium text-[#000533]">
                  {preview.name}
                </DialogTitle>
                <div className="flex shrink-0 items-center gap-3">
                  {preview.sizeLabel ? <span className="text-[11px] text-[#8487a7]">{preview.sizeLabel}</span> : null}
                  <a
                    href={preview.url}
                    download={preview.name}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#975ee2] hover:opacity-80"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-[#0b0c29] p-2">
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="mx-auto max-h-[80vh] w-auto max-w-full object-contain"
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
