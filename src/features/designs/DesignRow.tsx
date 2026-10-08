import { format } from "date-fns";
import { Archive, ArchiveRestore, Eye, Pencil, Star } from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import { KIND_LABELS } from "./design-library-model";
import type { DesignMemberOption } from "./DesignFormDialog";
import type { DesignFolder, DesignResource } from "./records";

const iconButton =
  "inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-[#6a769c] outline-none hover:bg-[#f4f5fb] hover:text-[#000533] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:w-9";

function katalistDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown date" : format(d, "MMM d, yyyy");
}

/** One saved design. Timestamps are Katalist's own; nothing here claims a Figma change time. */
export function DesignRow({
  resource,
  folder,
  members,
  coverUrl,
  favorite,
  favoriteAvailable,
  favoritePending,
  canManage,
  busy,
  highlighted,
  viewing,
  onView,
  onToggleFavorite,
  onEdit,
  onToggleArchive,
}: {
  resource: DesignResource;
  folder: DesignFolder | null;
  members: readonly DesignMemberOption[];
  /** Signed URL for the manual cover, when one exists and has been signed. */
  coverUrl: string | null;
  favorite: boolean;
  favoriteAvailable: boolean;
  favoritePending: boolean;
  canManage: boolean;
  busy: boolean;
  highlighted: boolean;
  viewing: boolean;
  onView: (resource: DesignResource, opener: HTMLElement) => void;
  onToggleFavorite: (resource: DesignResource) => void;
  onEdit: (resource: DesignResource, opener: HTMLElement) => void;
  onToggleArchive: (resource: DesignResource) => void;
}) {
  const owner = resource.ownerProfileId ? members.find((m) => m.profileId === resource.ownerProfileId) : null;
  const creator = resource.createdBy ? members.find((m) => m.profileId === resource.createdBy) : null;
  const archived = resource.archivedAt !== null;
  const edited = resource.updatedAt !== resource.createdAt;
  const target = resource.nodeId ? `Frame ${resource.nodeId}` : resource.pageId ? `Page ${resource.pageId}` : null;

  return (
    <li
      id={`design-${resource.id}`}
      data-testid="design-row"
      className={cn(
        "rounded-[10px] border bg-white p-3 sm:p-4",
        highlighted ? "border-[#975ee2] ring-2 ring-[#975ee2]/30" : "border-[#eaeffa]",
        archived && "opacity-80",
      )}
    >
      <div className="flex items-start gap-2">
        {resource.coverStorageKey && (
          // Decorative: the title beside it carries the meaning.
          coverUrl ? (
            <img src={coverUrl} alt="" loading="lazy" className="hidden h-16 w-24 shrink-0 rounded-md border border-[#eaeffa] object-cover sm:block" />
          ) : (
            <div aria-hidden="true" className="hidden h-16 w-24 shrink-0 rounded-md bg-[#f4f5fb] sm:block" />
          )
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 break-words text-[14.5px] font-semibold text-[#000533]">{resource.title}</h3>
            <span className="rounded-full bg-[#f4f0ff] px-2 py-0.5 text-[11.5px] font-medium text-[#5b2fb0]">{KIND_LABELS[resource.kind]}</span>
            {target && <span className="text-[11.5px] text-[#6a769c]">{target}</span>}
            {archived && <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[11.5px] font-medium text-[#475467]">Archived</span>}
          </div>
          {resource.notes && <p className="mt-1 line-clamp-2 whitespace-pre-line text-[13px] text-[#4a5578]">{resource.notes}</p>}
          {resource.tags.length > 0 && (
            <ul aria-label="Tags" className="mt-2 flex flex-wrap gap-1.5">
              {resource.tags.map((tag) => (
                <li key={tag} className="rounded-md bg-[#f4f5fb] px-2 py-0.5 text-[12px] text-[#4a5578]">{tag}</li>
              ))}
            </ul>
          )}
          <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#6a769c]">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Owner</dt>
              <dd className="flex items-center gap-1.5">
                {owner ? (
                  <>
                    <PersonAvatar name={owner.name} initials={owner.initials} src={owner.avatarUrl} size={20} />
                    <span>Owner: {owner.name}</span>
                  </>
                ) : (
                  <span>{resource.ownerProfileId ? "Owner: former member" : "No owner"}</span>
                )}
              </dd>
            </div>
            {folder && (
              <div>
                <dt className="sr-only">Folder</dt>
                <dd>Folder: {folder.name}</dd>
              </div>
            )}
            <div>
              <dt className="sr-only">Added</dt>
              <dd>
                Added <time dateTime={resource.createdAt}>{katalistDate(resource.createdAt)}</time>
                {creator ? ` by ${creator.name}` : ""}
              </dd>
            </div>
            {edited && (
              <div>
                <dt className="sr-only">Updated</dt>
                <dd>
                  Updated in Katalist <time dateTime={resource.updatedAt}>{katalistDate(resource.updatedAt)}</time>
                </dd>
              </div>
            )}
            {archived && resource.archivedAt && (
              <div>
                <dt className="sr-only">Archived</dt>
                <dd>
                  Archived <time dateTime={resource.archivedAt}>{katalistDate(resource.archivedAt)}</time>
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-pressed={viewing}
            aria-label={`View ${resource.title}`}
            onClick={(e) => onView(resource, e.currentTarget)}
            className={cn(iconButton, viewing && "bg-[#f4f0ff] text-[#5b2fb0]")}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
          </button>
          {!archived && (
            <button
              type="button"
              aria-pressed={favorite}
              aria-label={favorite ? `Remove ${resource.title} from favorites` : `Add ${resource.title} to favorites`}
              title={favoriteAvailable ? undefined : "Favorites could not be loaded"}
              disabled={favoritePending || !favoriteAvailable}
              onClick={() => onToggleFavorite(resource)}
              className={iconButton}
            >
              <Star className={cn("h-4 w-4", favorite && "fill-[#f5a524] text-[#f5a524]")} aria-hidden="true" />
            </button>
          )}
          {canManage && !archived && (
            <button type="button" aria-label={`Edit ${resource.title}`} disabled={busy} onClick={(e) => onEdit(resource, e.currentTarget)} className={iconButton}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {canManage && (
            <button
              type="button"
              aria-label={archived ? `Restore ${resource.title}` : `Archive ${resource.title}`}
              disabled={busy}
              onClick={() => onToggleArchive(resource)}
              className={iconButton}
            >
              {archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
