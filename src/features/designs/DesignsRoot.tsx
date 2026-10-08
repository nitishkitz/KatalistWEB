import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { FolderPlus, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/katalist/EmptyState";
import { cn } from "@/lib/utils";
import {
  EMPTY_CRITERIA,
  EMPTY_DRAFT,
  KIND_OPTIONS,
  draftFromResource,
  filterDesigns,
  hasClientCriteria,
  parseTagInput,
  resolveLibraryState,
  type DesignCriteria,
  type DesignDraft,
} from "./design-library-model";
import { DesignOperationError, type DesignResourceFilter } from "./design-queries";
import { DesignFormDialog, type DesignMemberOption } from "./DesignFormDialog";
import { DesignRow } from "./DesignRow";
import { DesignViewer } from "./DesignViewer";
import { DesignThingLinksPanel, type LinkableThing } from "./DesignThingLinksPanel";
import { readFileHead } from "./covers";
import { DeleteFolderDialog, FolderNameDialog } from "./FolderDialogs";
import type { DesignFolder, DesignResource } from "./records";
import { useDesignCoverUrls, useDesignFavorites, useDesignFolders, useDesignMutations, useDesignResources } from "./use-designs";
import { useOnlineStatus } from "./use-online";

export type DesignsListRole = "owner" | "collaborator" | "view_only";

const secondaryButton =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#eaeffa] bg-white px-3 text-[13.5px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] bg-[#975ee2] px-4 text-[13.5px] font-medium text-white outline-none hover:bg-[#8650d1] focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const selectClass =
  "h-10 w-full rounded-lg border border-[#dfe3f0] bg-white px-2.5 text-[13.5px] text-[#000533] outline-none focus:border-[#975ee2] focus-visible:ring-2 focus-visible:ring-[#975ee2]/40";

function asDesignError(error: unknown): DesignOperationError {
  return error instanceof DesignOperationError ? error : new DesignOperationError("unknown", error instanceof Error ? error.message : "Something went wrong.");
}

/**
 * Designs tab: a Katalist-authored library of Figma links for one List. Owners and
 * collaborators manage shared records; view-only members can browse and favorite.
 */
export default function DesignsRoot({
  listId,
  listRole,
  members,
  things = [],
  onOpenThing,
  initialDesignId = null,
}: {
  listId: string;
  listRole: DesignsListRole;
  members: readonly DesignMemberOption[];
  /** Things of this List that can be linked to a design. */
  things?: readonly LinkableThing[];
  /** Routes to a Thing's own detail and discussion. */
  onOpenThing?: (thingId: string) => void;
  /** Design to open in the viewer once loaded (deep link from a Thing). */
  initialDesignId?: string | null;
}) {
  const canManage = listRole === "owner" || listRole === "collaborator";
  const online = useOnlineStatus();

  // Dialogs here are opened by plain buttons, not Radix triggers, so focus is returned explicitly.
  const openerRef = useRef<HTMLElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const rememberOpener = (event: MouseEvent<HTMLElement>) => {
    openerRef.current = event.currentTarget;
  };
  const restoreFocus = () => {
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
    else sectionRef.current?.focus();
  };

  // Server-backed view: Active/Archived and folder are query filters, so they are complete.
  const [filter, setFilter] = useState<DesignResourceFilter>({ archived: false, folder: "all" });
  // Loaded-pages-only criteria: search, type, owner, favorites.
  const [criteria, setCriteria] = useState<DesignCriteria>(EMPTY_CRITERIA);

  const library = useDesignResources(listId, filter);
  const folderQuery = useDesignFolders(listId);
  const favorites = useDesignFavorites(listId);
  const mutations = useDesignMutations(listId);
  const folders = folderQuery.folders;
  const { urls: coverUrls } = useDesignCoverUrls(listId, library.resources);

  // A selected folder that no longer exists (deleted elsewhere) falls back to All.
  useEffect(() => {
    if (folderQuery.hasFetchedOnce && filter.folder !== "all" && filter.folder !== "unfiled" && !folders.some((f) => f.id === filter.folder)) {
      setFilter((f) => ({ ...f, folder: "all" }));
    }
  }, [folderQuery.hasFetchedOnce, folders, filter.folder]);

  const { state, refreshFailed } = resolveLibraryState({
    preview: library.unavailable,
    online,
    isPaused: library.isPaused,
    isLoading: library.isLoading,
    hasFetchedOnce: library.hasFetchedOnce,
    error: library.error,
    itemCount: library.resources.length,
  });

  const favoriteIds = favorites.favoriteIds;
  const favoritesAvailable = favorites.hasFetchedOnce && !favorites.error;
  const visible = useMemo(
    () => filterDesigns(library.resources, criteria, favoriteIds),
    [library.resources, criteria, favoriteIds],
  );
  const criteriaActive = hasClientCriteria(criteria);
  const viewFiltered = filter.folder !== "all" || filter.archived;
  const loadedCount = library.resources.length;

  // ---- add / edit ----------------------------------------------------------
  const draftsRef = useRef(new Map<string, DesignDraft>()); // unsaved drafts kept after a failed save
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; resource: DesignResource } | null>(null);
  const [draft, setDraft] = useState<DesignDraft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);
  const [formError, setFormError] = useState<DesignOperationError | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const dialogKey = dialog ? (dialog.mode === "add" ? "add" : dialog.resource.id) : null;
  const openDialog = (next: NonNullable<typeof dialog>) => {
    const key = next.mode === "add" ? "add" : next.resource.id;
    const saved = draftsRef.current.get(key);
    setDraft(saved ?? (next.mode === "add" ? EMPTY_DRAFT : draftFromResource(next.resource)));
    setRestored(Boolean(saved));
    setFormError(null);
    setDialog(next);
  };
  const closeDialog = () => setDialog(null);
  const discardDraft = () => {
    if (!dialog || !dialogKey) return;
    draftsRef.current.delete(dialogKey);
    setDraft(dialog.mode === "add" ? EMPTY_DRAFT : draftFromResource(dialog.resource));
    setRestored(false);
  };

  // ---- covers (applied immediately, independent of Save) ----
  const [coverStatus, setCoverStatus] = useState<{ error: string | null; notice: string | null }>({ error: null, notice: null });
  const coverTarget = dialog?.mode === "edit" ? library.resources.find((r) => r.id === dialog.resource.id) ?? dialog.resource : null;
  useEffect(() => setCoverStatus({ error: null, notice: null }), [dialogKey]);
  const pickCover = async (file: File) => {
    if (!coverTarget) return;
    setCoverStatus({ error: null, notice: null });
    try {
      const head = await readFileHead(file);
      const outcome = await mutations.replaceCover.mutateAsync({ resourceId: coverTarget.id, file, head });
      setCoverStatus({
        error: null,
        notice: outcome.orphanedKey ? "Cover updated. The old image could not be deleted from storage." : "Cover updated.",
      });
    } catch (error) {
      setCoverStatus({ error: `${asDesignError(error).message} Your current cover is unchanged.`, notice: null });
    }
  };
  const dropCover = async () => {
    if (!coverTarget) return;
    setCoverStatus({ error: null, notice: null });
    try {
      const outcome = await mutations.removeCover.mutateAsync(coverTarget.id);
      setCoverStatus({
        error: null,
        notice: outcome.orphanedKey ? "Cover removed. The image could not be deleted from storage." : "Cover removed.",
      });
    } catch (error) {
      setCoverStatus({ error: `${asDesignError(error).message} Your current cover is unchanged.`, notice: null });
    }
  };

  const saving = mutations.addResource.isPending || mutations.updateResource.isPending;
  const submitDraft = async (value: DesignDraft) => {
    if (!dialog || !dialogKey) return;
    setFormError(null);
    // Keep the draft up front so closing mid-request or after a failure never loses it.
    draftsRef.current.set(dialogKey, value);
    try {
      const common = {
        title: value.title.trim(),
        notes: value.notes.trim() || null,
        tags: parseTagInput(value.tags),
        ownerProfileId: value.ownerProfileId || null,
        folderId: value.folderId || null,
      };
      if (dialog.mode === "add") {
        await mutations.addResource.mutateAsync({ ...common, url: value.url.trim() });
        toast.success("Design added.");
      } else {
        const urlChanged = value.url.trim() !== dialog.resource.originalUrl;
        await mutations.updateResource.mutateAsync({
          ...common,
          resourceId: dialog.resource.id,
          url: urlChanged ? value.url.trim() : null,
        });
        toast.success("Design updated.");
      }
      draftsRef.current.delete(dialogKey);
      setDialog(null);
    } catch (error) {
      setFormError(asDesignError(error));
    }
  };

  const clearAll = () => {
    setCriteria(EMPTY_CRITERIA);
    setFilter({ archived: false, folder: "all" });
  };

  const showExisting = (existingId: string | null) => {
    setDialog(null);
    setCriteria(EMPTY_CRITERIA);
    setFilter({ archived: false, folder: "all" });
    setHighlightId(existingId);
    if (!existingId) toast.message("That design is already saved in this List.");
  };
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`design-${highlightId}`);
    el?.scrollIntoView?.({ block: "center" });
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightId, loadedCount]);

  // ---- viewer (only the selected design is mounted) ----
  const [viewerId, setViewerId] = useState<string | null>(null);
  const viewerResource = viewerId ? library.resources.find((r) => r.id === viewerId) ?? null : null;
  // The viewer closes if its design leaves the loaded view (archived, deleted, filtered by view).
  useEffect(() => {
    if (viewerId && library.hasFetchedOnce && !viewerResource) setViewerId(null);
  }, [viewerId, viewerResource, library.hasFetchedOnce]);
  // Deep link from a Thing: open that design once it has loaded, paging forward a bounded number of times.
  const deepLinkRef = useRef({ target: initialDesignId, pages: 0, done: false });
  const [deepLinkMissing, setDeepLinkMissing] = useState(false);
  useEffect(() => {
    const dl = deepLinkRef.current;
    if (dl.target !== initialDesignId) Object.assign(dl, { target: initialDesignId, pages: 0, done: false });
    if (!dl.target || dl.done || !library.hasFetchedOnce) return;
    const found = library.resources.find((r) => r.id === dl.target);
    if (found) {
      dl.done = true;
      setViewerId(found.id);
      setDeepLinkMissing(false);
    } else if (library.hasNextPage && !library.isFetchingNextPage && dl.pages < 10) {
      dl.pages += 1;
      void library.fetchNextPage();
    } else if (!library.hasNextPage && !library.isFetchingNextPage) {
      dl.done = true;
      setDeepLinkMissing(true);
    }
  }, [initialDesignId, library.hasFetchedOnce, library.resources, library.hasNextPage, library.isFetchingNextPage, library]);
  const closeViewer = () => {
    setViewerId(null);
    restoreFocus();
  };

  // ---- row actions ---------------------------------------------------------
  const toggleFavorite = async (resource: DesignResource) => {
    setActionError(null);
    try {
      await mutations.setFavorite.mutateAsync({ resourceId: resource.id, favorite: !favoriteIds.has(resource.id) });
    } catch (error) {
      setActionError(`Could not update favorite: ${asDesignError(error).message}`);
    }
  };
  const toggleArchive = async (resource: DesignResource) => {
    setActionError(null);
    const archiving = resource.archivedAt === null;
    try {
      await mutations.setArchived.mutateAsync({ resourceId: resource.id, archived: archiving });
      toast.success(archiving ? "Design archived." : "Design restored.");
    } catch (error) {
      const err = asDesignError(error);
      setActionError(
        err.code === "duplicate_design"
          ? `“${resource.title}” was not restored: an active design with the same link already exists in this List. Archive or edit that one first.`
          : `Could not ${archiving ? "archive" : "restore"} “${resource.title}”: ${err.message}`,
      );
    }
  };

  // ---- folders -------------------------------------------------------------
  const [folderDialog, setFolderDialog] = useState<{ folder: DesignFolder | null } | null>(null);
  const [folderError, setFolderError] = useState<DesignOperationError | null>(null);
  const [deleting, setDeleting] = useState<DesignFolder | null>(null);
  const [deleteError, setDeleteError] = useState<DesignOperationError | null>(null);
  const selectedFolder = folders.find((f) => f.id === filter.folder) ?? null;

  const submitFolder = async (name: string) => {
    if (!folderDialog) return;
    setFolderError(null);
    try {
      if (folderDialog.folder) await mutations.renameFolder.mutateAsync({ folderId: folderDialog.folder.id, name });
      else {
        const created = await mutations.createFolder.mutateAsync(name);
        setFilter((f) => ({ ...f, folder: created.id }));
      }
      setFolderDialog(null);
    } catch (error) {
      setFolderError(asDesignError(error));
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await mutations.deleteFolder.mutateAsync(deleting.id);
      setFilter((f) => (f.folder === deleting.id ? { ...f, folder: "all" } : f));
      setDeleting(null);
      toast.success("Folder deleted. Its designs are now unfiled.");
    } catch (error) {
      setDeleteError(asDesignError(error));
    }
  };

  // ---- non-ready states ----------------------------------------------------
  if (state === "preview-unavailable") {
    return (
      <EmptyState
        title="Designs are not available in preview"
        description="Designs are saved to your List, so they need a signed-in account. Nothing here is stored in preview."
      />
    );
  }
  if (state === "migration-missing") {
    return (
      <EmptyState
        title="Designs are not set up yet"
        description="This database has not had the Designs migration applied, so designs cannot be loaded or saved. Ask an administrator to apply it, then retry."
        action={<button type="button" onClick={() => void library.refetch()} className={secondaryButton}>Retry</button>}
      />
    );
  }
  if (state === "access-lost") {
    return <EmptyState title="You don't have access to this List's designs" description="Your access may have changed. Reload, or ask the List owner." />;
  }
  // The toolbar stays mounted while a view loads, fails or is offline, so changing the folder or
  // Active/Archived never blanks the controls or drops keyboard focus.
  const retryButton = (label: string) => (
    <button type="button" onClick={() => void library.refetch()} className={secondaryButton}>{label}</button>
  );
  const notReady = state === "loading" || state === "error" || state === "offline";

  return (
    <section ref={sectionRef} tabIndex={-1} aria-label="Designs" className="space-y-3 pb-8 pt-1 outline-none">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-semibold text-[#000533]">Designs</h2>
          <p className="text-[12.5px] text-[#6a769c]">
            {canManage ? "Saved Figma links for this List." : "View only: you can browse and favorite designs."}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button type="button" disabled={notReady} onClick={(e) => { rememberOpener(e); setFolderError(null); setFolderDialog({ folder: null }); }} className={secondaryButton}>
              <FolderPlus className="h-4 w-4" aria-hidden="true" /> New folder
            </button>
            <button type="button" disabled={notReady} onClick={(e) => { rememberOpener(e); openDialog({ mode: "add" }); }} className={primaryButton}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add design
            </button>
          </div>
        )}
      </div>

      {/* Notices */}
      {!online && library.hasFetchedOnce && (
        <p role="status" className="rounded-lg bg-[#fffaeb] px-3 py-2 text-[12.5px] text-[#93370d]">
          You're offline. Showing designs already loaded; changes will not save until you reconnect.
        </p>
      )}
      {refreshFailed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#fffaeb] px-3 py-2 text-[12.5px] text-[#93370d]">
          <span>Designs could not be refreshed, so what you see may be out of date.</span>
          <button type="button" onClick={() => void library.refetch()} className="cursor-pointer font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]">Retry</button>
        </div>
      )}
      {folderQuery.error && (
        <p role="alert" className="rounded-lg bg-[#fffaeb] px-3 py-2 text-[12.5px] text-[#93370d]">
          Folders could not be loaded. Designs are shown without folder names.{" "}
          <button type="button" onClick={() => void folderQuery.refetch()} className="cursor-pointer font-medium underline">Retry</button>
        </p>
      )}
      {favorites.error && (
        <p role="alert" className="rounded-lg bg-[#fffaeb] px-3 py-2 text-[12.5px] text-[#93370d]">
          Favorites could not be loaded, so favorite stars and the favorites filter are unavailable.{" "}
          <button type="button" onClick={() => void favorites.refetch()} className="cursor-pointer font-medium underline">Retry</button>
        </p>
      )}
      {actionError && (
        <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-[#f4c7c3] bg-[#fef3f2] px-3 py-2 text-[12.5px] text-[#912018]">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="shrink-0 cursor-pointer font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]">Dismiss</button>
        </div>
      )}

      {/* View: Active / Archived and folders (server-backed, complete) */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="inline-flex overflow-hidden rounded-lg border border-[#dfe3f0]">
          {([["Active", false], ["Archived", true]] as const).map(([label, archived]) => (
            <button
              key={label}
              type="button"
              aria-pressed={filter.archived === archived}
              onClick={() => setFilter((f) => ({ ...f, archived }))}
              className={cn(
                "h-10 cursor-pointer px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#975ee2]",
                filter.archived === archived ? "bg-[#f4f0ff] font-medium text-[#5b2fb0]" : "bg-white text-[#4a5578] hover:bg-[#fafaff]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label htmlFor="design-folder-filter" className="sr-only">Folder</label>
          <select
            id="design-folder-filter"
            value={filter.folder}
            onChange={(e) => setFilter((f) => ({ ...f, folder: e.target.value }))}
            className={cn(selectClass, "max-w-[260px]")}
          >
            <option value="all">All folders</option>
            <option value="unfiled">Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          {canManage && selectedFolder && (
            <>
              <button type="button" aria-label={`Rename folder ${selectedFolder.name}`} onClick={(e) => { rememberOpener(e); setFolderError(null); setFolderDialog({ folder: selectedFolder }); }} className={secondaryButton}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" aria-label={`Delete folder ${selectedFolder.name}`} onClick={(e) => { rememberOpener(e); setDeleteError(null); setDeleting(selectedFolder); }} className={secondaryButton}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search & filters over the loaded pages */}
      <form role="search" aria-label="Search designs" onSubmit={(e) => e.preventDefault()} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_auto_auto]">
        <div>
          <label htmlFor="design-search" className="sr-only">Search titles, tags and notes</label>
          <input
            id="design-search"
            type="search"
            value={criteria.search}
            onChange={(e) => setCriteria((c) => ({ ...c, search: e.target.value }))}
            placeholder="Search titles, tags and notes"
            className={cn(selectClass, "px-3")}
          />
        </div>
        <div>
          <label htmlFor="design-kind-filter" className="sr-only">Type</label>
          <select id="design-kind-filter" value={criteria.kind} onChange={(e) => setCriteria((c) => ({ ...c, kind: e.target.value as DesignCriteria["kind"] }))} className={selectClass}>
            <option value="all">All types</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="design-owner-filter" className="sr-only">Owner</label>
          <select id="design-owner-filter" value={criteria.owner} onChange={(e) => setCriteria((c) => ({ ...c, owner: e.target.value }))} className={selectClass}>
            <option value="all">Any owner</option>
            <option value="unowned">No owner</option>
            {members.map((m) => (
              <option key={m.profileId} value={m.profileId}>{m.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          aria-pressed={criteria.favoritesOnly}
          disabled={!favoritesAvailable}
          onClick={() => setCriteria((c) => ({ ...c, favoritesOnly: !c.favoritesOnly }))}
          className={cn(secondaryButton, criteria.favoritesOnly && "border-[#975ee2] bg-[#f4f0ff] text-[#5b2fb0]")}
        >
          Favorites
        </button>
        <button type="button" onClick={clearAll} disabled={!criteriaActive && !viewFiltered} className={secondaryButton}>
          Clear filters
        </button>
      </form>

      {/* Never imply complete results when only loaded pages were searched. */}
      {criteriaActive && !notReady && (
        <p role="status" data-testid="design-scope-note" className={cn("rounded-lg px-3 py-2 text-[12.5px]", library.hasNextPage ? "bg-[#fffaeb] text-[#93370d]" : "bg-[#f4f5fb] text-[#4a5578]")}>
          {library.hasNextPage
            ? `Search and filters apply only to the ${loadedCount} design${loadedCount === 1 ? "" : "s"} loaded so far. More designs exist; load more to include them.`
            : `Searched all ${loadedCount} design${loadedCount === 1 ? "" : "s"} in this view.`}
        </p>
      )}

      {deepLinkMissing && !viewerResource && (
        <p role="status" className="rounded-lg bg-[#fffaeb] px-3 py-2 text-[12.5px] text-[#93370d]">
          The linked design is not in the active list. It may have been archived; check the Archived view.
        </p>
      )}
      {viewerResource && (
        <DesignViewer key={viewerResource.id} resource={viewerResource} onClose={closeViewer}>
          <DesignThingLinksPanel
            listId={listId}
            resourceId={viewerResource.id}
            archived={viewerResource.archivedAt !== null}
            things={things}
            canManage={canManage}
            onOpenThing={onOpenThing}
          />
        </DesignViewer>
      )}

      {/* Results */}
      {state === "loading" ? (
        <div role="status" aria-label="Loading designs" className="space-y-2 rounded-[10px] bg-white p-4">
          <p className="text-[13px] text-[#6a769c]">Loading designs…</p>
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden="true" className="h-[84px] animate-pulse rounded-lg bg-[#f4f5fb] motion-reduce:animate-none" />
          ))}
        </div>
      ) : state === "error" ? (
        <div role="alert">
          <EmptyState
            title="Designs could not be loaded"
            description={`${library.error?.message || "Something went wrong while loading designs."} This is not an empty library.`}
            action={retryButton("Retry")}
          />
        </div>
      ) : state === "offline" ? (
        <EmptyState
          title="You're offline"
          description="Reconnect to load designs. Nothing is cached yet, so this is not an empty library."
          action={retryButton("Try again")}
        />
      ) : state === "empty" ? (
        <EmptyState
          title={filter.archived ? "No archived designs" : viewFiltered ? "No designs in this view" : "No designs yet"}
          description={
            filter.archived
              ? "Archived designs appear here and can be restored."
              : canManage
                ? "Add a Figma link to start this List's design library."
                : "Owners and collaborators can add designs to this List."
          }
          action={
            canManage && !filter.archived && !viewFiltered ? (
              <button type="button" onClick={(e) => { rememberOpener(e); openDialog({ mode: "add" }); }} className={primaryButton}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Add design
              </button>
            ) : viewFiltered ? (
              <button type="button" onClick={clearAll} className={secondaryButton}>Clear filters</button>
            ) : undefined
          }
        />
      ) : (
        <>
          {criteriaActive && (
            <p aria-live="polite" className="text-[12.5px] text-[#6a769c]">
              {visible.length} of {loadedCount} loaded design{loadedCount === 1 ? "" : "s"} match{visible.length === 1 ? "es" : ""}.
            </p>
          )}
          {visible.length === 0 ? (
            <div data-testid="design-no-matches" className="rounded-[10px] border border-dashed border-[#dfe3f0] bg-white px-4 py-8 text-center">
              <p className="text-[14px] font-medium text-[#000533]">
                {library.hasNextPage ? `No matches among the ${loadedCount} loaded designs` : "No designs match your filters"}
              </p>
              <p className="mt-1 text-[12.5px] text-[#6a769c]">
                {library.hasNextPage ? "More designs have not been loaded yet, so a match may still exist." : "Try different words or clear the filters."}
              </p>
              <button type="button" onClick={clearAll} className={cn(secondaryButton, "mt-3")}>Clear filters</button>
            </div>
          ) : (
            <ul aria-label="Designs" className="space-y-2">
              {visible.map((resource) => (
                <DesignRow
                  key={resource.id}
                  resource={resource}
                  folder={folders.find((f) => f.id === resource.folderId) ?? null}
                  members={members}
                  coverUrl={resource.coverStorageKey ? coverUrls.get(resource.coverStorageKey) ?? null : null}
                  favorite={favoriteIds.has(resource.id)}
                  favoriteAvailable={favoritesAvailable}
                  favoritePending={mutations.setFavorite.isPending && mutations.setFavorite.variables?.resourceId === resource.id}
                  canManage={canManage}
                  busy={mutations.setArchived.isPending && mutations.setArchived.variables?.resourceId === resource.id}
                  highlighted={highlightId === resource.id}
                  viewing={viewerId === resource.id}
                  onView={(r, opener) => {
                    openerRef.current = opener;
                    setViewerId(r.id);
                  }}
                  onToggleFavorite={toggleFavorite}
                  onEdit={(r, opener) => { openerRef.current = opener; openDialog({ mode: "edit", resource: r }); }}
                  onToggleArchive={toggleArchive}
                />
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {library.hasNextPage ? (
              <button type="button" disabled={library.isFetchingNextPage} onClick={() => void library.fetchNextPage()} className={secondaryButton}>
                {library.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            ) : (
              <p className="text-[12.5px] text-[#6a769c]">All {loadedCount} design{loadedCount === 1 ? "" : "s"} in this view {loadedCount === 1 ? "is" : "are"} loaded.</p>
            )}
            {library.isFetchNextPageError && (
              <p role="alert" className="text-[12.5px] text-[#b42318]">The next page could not be loaded. Try again.</p>
            )}
          </div>
        </>
      )}

      <DesignFormDialog
        open={dialog !== null}
        mode={dialog?.mode ?? "add"}
        draft={draft}
        onDraftChange={(next) => {
          setDraft(next);
          if (dialogKey) draftsRef.current.set(dialogKey, next);
        }}
        folders={folders}
        members={members}
        submitting={saving}
        serverError={formError}
        restoredDraft={restored}
        onDiscardDraft={discardDraft}
        onSubmit={(value) => void submitDraft(value)}
        onClose={() => {
          // A draft is kept only after a failed save; otherwise closing starts fresh next time.
          if (dialogKey && !formError) draftsRef.current.delete(dialogKey);
          closeDialog();
        }}
        onShowExisting={showExisting}
        onCloseAutoFocus={restoreFocus}
        cover={
          coverTarget
            ? {
                url: coverTarget.coverStorageKey ? coverUrls.get(coverTarget.coverStorageKey) ?? null : null,
                hasCover: Boolean(coverTarget.coverStorageKey),
                busy: mutations.replaceCover.isPending || mutations.removeCover.isPending,
                error: coverStatus.error,
                notice: coverStatus.notice,
                onPick: (file) => void pickCover(file),
                onRemove: () => void dropCover(),
              }
            : undefined
        }
      />
      <FolderNameDialog
        open={folderDialog !== null}
        folder={folderDialog?.folder ?? null}
        submitting={mutations.createFolder.isPending || mutations.renameFolder.isPending}
        serverError={folderError}
        onSubmit={(name) => void submitFolder(name)}
        onClose={() => setFolderDialog(null)}
        onCloseAutoFocus={restoreFocus}
      />
      <DeleteFolderDialog
        folder={deleting}
        submitting={mutations.deleteFolder.isPending}
        serverError={deleteError}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
        onCloseAutoFocus={restoreFocus}
      />
    </section>
  );
}
