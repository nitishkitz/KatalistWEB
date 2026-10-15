import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, LockKeyhole } from "lucide-react";
import gsap from "gsap";
import { AppShell } from "@/components/layout/AppShell";
import { AsyncState } from "@/components/katalist/AsyncState";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useBuckets } from "@/features/buckets/use-buckets";
import type { Thing } from "@/domain/thing";
import { bucketTheme } from "@/features/buckets/BucketGalleryCard";
import "@/features/buckets/buckets-workspace.css";
import { BucketThingsTable } from "@/features/buckets/BucketThingsTable";
import { useBucketItems } from "@/features/buckets/use-bucket-items";
import { AddToBucketDialog } from "@/features/buckets/AddToBucketDialog";
import { CourtDetailModal } from "@/features/court/CourtDetailModal";
import { domainErrorMessage } from "@/lib/domain-error";
import { getEffectiveReducedMotion } from "@/hooks/use-motion-preference";
import { toast } from "sonner";

export const Route = createFileRoute("/buckets/")({
  head: () => ({
    meta: [
      { title: "Buckets — Katalist" },
      { name: "description", content: "Your private focus spaces." },
    ],
  }),
  component: BucketsPage,
});

type HeroFlight = {
  id: string;
  art: string;
  sourceRect: { left: number; top: number; width: number; height: number };
  sourceImgEl?: HTMLImageElement | null;
};

function BucketsPage() {
  useLocalVersion();
  const {
    buckets,
    create,
    isLoading,
    error: bucketsError,
    refetch: refetchBuckets,
    hasFetchedOnce,
  } = useBuckets();
  const [creating, setCreating] = useState(false);
  const createSubmitInFlight = useRef(false);
  const [name, setName] = useState("");
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const [openThing, setOpenThing] = useState<Thing | null>(null);
  const [adding, setAdding] = useState(false);
  const [heroFlight, setHeroFlight] = useState<HeroFlight | null>(null);

  const headerImgRef = useRef<HTMLImageElement | null>(null);
  const headerCopyRef = useRef<HTMLDivElement | null>(null);
  const headerCompletionRef = useRef<HTMLDivElement | null>(null);
  const flyingHeroRef = useRef<HTMLDivElement | null>(null);
  const activeTweenRef = useRef<gsap.core.Timeline | gsap.core.Tween | null>(null);

  const activeBucket = buckets.find((b) => b.id === selectedBucketId) ?? buckets[0] ?? null;
  const {
    items,
    add,
    remove,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems,
  } = useBucketItems(activeBucket?.id);

  const activeIndex = Math.max(
    0,
    buckets.findIndex((b) => b.id === activeBucket?.id),
  );
  const total = activeBucket?.progressTotal ?? 0;
  const completed = Math.min(activeBucket?.progressCompleted ?? 0, total);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const quantity = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  const handleSelectBucket = (bucketId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (bucketId === activeBucket?.id) return;

    const cardBtn = event.currentTarget;
    const imgEl = cardBtn.querySelector<HTMLImageElement>("img");
    if (imgEl) {
      const rect = imgEl.getBoundingClientRect();
      const index = buckets.findIndex((b) => b.id === bucketId);
      const art = bucketTheme(index >= 0 ? index : 0).art;
      setHeroFlight({
        id: bucketId,
        art,
        sourceRect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        sourceImgEl: imgEl,
      });
    } else {
      setHeroFlight(null);
    }

    setSelectedBucketId(bucketId);
  };

  useLayoutEffect(() => {
    if (!heroFlight || !headerImgRef.current || !flyingHeroRef.current) {
      return;
    }

    const reduceMotion = getEffectiveReducedMotion();
    if (reduceMotion) {
      setHeroFlight(null);
      return;
    }

    const destImg = headerImgRef.current;
    const flyingEl = flyingHeroRef.current;
    const destRect = destImg.getBoundingClientRect();

    if (destRect.width === 0 || destRect.height === 0) {
      setHeroFlight(null);
      return;
    }

    if (activeTweenRef.current) {
      activeTweenRef.current.kill();
      activeTweenRef.current = null;
    }

    // Hide destination image while hero shuttle is flying
    gsap.set(destImg, { opacity: 0 });

    // Briefly dim source thumbnail to create realistic lift illusion
    const sourceImg = heroFlight.sourceImgEl;
    if (sourceImg) {
      gsap.to(sourceImg, { opacity: 0.35, duration: 0.15, ease: "power1.out" });
    }

    // Calculate FLIP deltas relative to destination
    const deltaX = heroFlight.sourceRect.left - destRect.left;
    const deltaY = heroFlight.sourceRect.top - destRect.top;
    const scale = heroFlight.sourceRect.width / destRect.width;

    // Position flying hero exactly at destination coordinates with GPU transforms inverted to source
    gsap.set(flyingEl, {
      position: "fixed",
      top: destRect.top,
      left: destRect.left,
      width: destRect.width,
      height: destRect.height,
      x: deltaX,
      y: deltaY,
      scale: scale,
      rotation: -3,
      transformOrigin: "0 0",
      opacity: 1,
      zIndex: 9999,
      pointerEvents: "none",
      filter: "drop-shadow(0 4px 10px rgba(121, 58, 255, 0.14))",
    });

    // Stagger in the new header title and metadata with soft unblur
    if (headerCopyRef.current) {
      gsap.fromTo(
        headerCopyRef.current,
        { opacity: 0, x: -16, filter: "blur(4px)" },
        { opacity: 1, x: 0, filter: "blur(0px)", duration: 0.34, delay: 0.08, ease: "power2.out" },
      );
    }

    // Stagger in the progress indicator
    if (headerCompletionRef.current) {
      gsap.fromTo(
        headerCompletionRef.current,
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.32, delay: 0.12, ease: "power2.out" },
      );
    }

    // Master timeline for the hero flight
    const tl = gsap.timeline({
      onComplete: () => {
        // Seamless landing handoff
        gsap.set(destImg, { opacity: 1 });
        if (sourceImg) {
          gsap.to(sourceImg, { opacity: 1, duration: 0.18, ease: "power1.out" });
        }
        setHeroFlight(null);
        activeTweenRef.current = null;
      },
    });

    tl.to(flyingEl, {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      duration: 0.38,
      ease: "power3.out",
      filter: "drop-shadow(0 14px 28px rgba(121, 58, 255, 0.22))",
    });

    activeTweenRef.current = tl;

    return () => {
      if (activeTweenRef.current) {
        activeTweenRef.current.kill();
        activeTweenRef.current = null;
      }
      gsap.set(destImg, { opacity: 1 });
      if (sourceImg) {
        gsap.set(sourceImg, { opacity: 1 });
      }
    };
  }, [heroFlight?.id]);

  useEffect(() => {
    return () => {
      activeTweenRef.current?.kill();
    };
  }, []);

  return (
    <AppShell noPadding homeSurface="buckets">
      <div className="buckets-workspace">
        <aside className="buckets-rail" aria-label="Bucket navigation">
          <header className="home-page-heading hidden">
            <h1>Buckets</h1><p>Private to you</p>
          </header>
          <button type="button" className="buckets-create" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Create bucket
          </button>
          <AsyncState
            isLoading={isLoading}
            data={buckets}
            error={bucketsError}
            onRetry={refetchBuckets}
            isEmpty={buckets.length === 0}
            hasFetchedOnce={hasFetchedOnce}
            emptyTitle="No Buckets yet"
            emptyDescription="Create a private collection of Things and Lists."
            loadingContent={
              <div className="buckets-rail-loading" aria-label="Loading buckets">
                <span />
                <span />
              </div>
            }
          >
            {() => (
              <nav
                className="buckets-collection-list"
                data-testid="bucket-gallery"
                aria-label="Your buckets"
              >
                {buckets.map((bucket, index) => (
                  <button
                    type="button"
                    key={bucket.id}
                    className="buckets-collection"
                    data-testid="bucket-gallery-card"
                    data-selected={bucket.id === activeBucket?.id || undefined}
                    aria-pressed={bucket.id === activeBucket?.id}
                    aria-label={`Show ${bucket.name}`}
                    onClick={(e) => handleSelectBucket(bucket.id, e)}
                  >
                    <img src={bucketTheme(index).art} alt="" draggable={false} />
                    <span className="buckets-collection-copy">
                      <strong>{bucket.name}</strong>
                      <span>
                        {quantity(bucket.thingCount, "Thing")} ·{" "}
                        {quantity(bucket.listCount, "List")}
                      </span>
                    </span>
                  </button>
                ))}
              </nav>
            )}
          </AsyncState>
        </aside>
        <div className="buckets-main">
          {activeBucket ? (
            <>
              <header className="buckets-heading">
                <img
                  ref={headerImgRef}
                  src={bucketTheme(activeIndex).art}
                  alt=""
                  draggable={false}
                />
                <div className="buckets-heading-copy" ref={headerCopyRef}>
                  <h2>{activeBucket.name}</h2>
                  <div>
                    <span>
                      {quantity(activeBucket.thingCount, "Thing")} ·{" "}
                      {quantity(activeBucket.listCount, "List")}
                    </span>
                    <span className="buckets-privacy">
                      <LockKeyhole aria-hidden="true" />
                      Private to you
                    </span>
                  </div>
                </div>
                <div className="buckets-completion" ref={headerCompletionRef}>
                  <div
                    role="progressbar"
                    aria-label={`${activeBucket.name} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <span>
                    <strong>{total ? `${percent}%` : "—"}</strong> complete
                  </span>
                </div>
              </header>
              <div className="buckets-content-table" key={activeBucket.id}>
                <BucketThingsTable
                  bucketId={activeBucket.id}
                  items={items}
                  isLoading={itemsLoading}
                  error={itemsError}
                  onRetry={() => void refetchItems()}
                  onOpenThing={setOpenThing}
                  onAdd={() => setAdding(true)}
                  bucketName={activeBucket.name}
                  onRemoveThing={(t) =>
                    void remove.mutateAsync({ thingId: t.id }).then(
                      () => toast.success("Removed from bucket."),
                      (err) => toast.error(domainErrorMessage(err)),
                    )
                  }
                  onRemoveList={(l) =>
                    void remove.mutateAsync({ listId: l.id }).then(
                      () => toast.success("List removed from bucket."),
                      (err) => toast.error(domainErrorMessage(err)),
                    )
                  }
                />
              </div>
            </>
          ) : !isLoading && !bucketsError ? (
            <div className="buckets-page-empty">
              <h2>Your private focus space</h2>
              <p>Create a bucket to collect related Things and Lists.</p>
            </div>
          ) : null}
        </div>
      </div>

      {activeBucket ? (
        <AddToBucketDialog
          open={adding}
          bucketName={activeBucket.name}
          referencedThingIds={
            new Set(items.flatMap((i) => (i.kind === "thing" ? [i.thingId] : [])))
          }
          referencedListIds={new Set(items.flatMap((i) => (i.kind === "list" ? [i.listId] : [])))}
          onClose={() => setAdding(false)}
          onAdd={(target) => add.mutateAsync(target)}
        />
      ) : null}
      <CourtDetailModal
        thing={openThing}
        isOpen={Boolean(openThing)}
        onClose={() => setOpenThing(null)}
      />

      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <form
            className="w-full max-w-sm rounded-2xl border border-border/80 bg-white p-5 katalist-elevation-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || create.isPending || createSubmitInFlight.current) return;
              createSubmitInFlight.current = true;
              void create.mutateAsync(name.trim()).then(
                () => {
                  toast.success("Bucket created.");
                  setName("");
                  setCreating(false);
                },
                (err) => toast.error(domainErrorMessage(err)),
              ).finally(() => { createSubmitInFlight.current = false; });
            }}
          >
            <h2 className="text-[15px] font-bold text-foreground">Create Bucket</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Buckets are private focus spaces for your references.
            </p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My priorities, Q3 Research"
              className="mt-3.5 h-10 w-full rounded-xl border border-border px-3 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-ring"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending || !name.trim()}
                className="rounded-lg disabled:cursor-not-allowed disabled:opacity-50 bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                {create.isPending ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {heroFlight && (
        <div ref={flyingHeroRef} className="buckets-hero-flight" aria-hidden="true">
          <img src={heroFlight.art} alt="" draggable={false} />
        </div>
      )}
    </AppShell>
  );
}
