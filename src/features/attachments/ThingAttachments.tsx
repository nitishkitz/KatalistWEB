import { format } from "date-fns";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { mimeCategory } from "@/features/court/magic-box/analytics";
import { requestAttachmentDownload, useThingAttachments } from "./queries";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ThingAttachments({ thingId }: { thingId: string }) {
  const { session } = useSession();
  const query = useThingAttachments(thingId);
  const rows = query.data ?? [];
  if (!rows.length) return null;

  return (
    <section className="mt-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Attachments</h3>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-[12px] outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={async () => {
                try {
                  const token = session?.access_token;
                  if (!token) throw new Error("Sign in to continue.");
                  const url = await requestAttachmentDownload(thingId, row.id, token);
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "That file isn’t available.");
                }
              }}
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{row.file_name}</span>
              <span className="text-[10px] text-muted-foreground">
                {mimeCategory(row.mime_type)} · {formatSize(row.byte_size)} · {format(new Date(row.created_at), "d MMM")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
