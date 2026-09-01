import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Folder, Hash, Layers, List, Mic, Paperclip, Sparkles } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { useAppContext } from "@/features/context/use-app-context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rpcAddToBucket, rpcCreateThing } from "@/features/things/rpc";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { useLists } from "@/features/lists/use-lists";
import { useBuckets } from "@/features/buckets/use-buckets";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { isPreviewMode } from "@/lib/session-mode";
import { parseToss, tossBlockedByPerson } from "./parse-toss";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";

export function MagicBox({
  listId,
  listName,
  desktop = false,
}: {
  listId?: string;
  listName?: string;
  desktop?: boolean;
}) {
  const [value, setValue] = useState("");
  const [tossed, setTossed] = useState(false);
  const [trigger, setTrigger] = useState<{
    type: "person" | "list" | "bucket";
    query: string;
    startIndex: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // tracks which person ID the user has explicitly dismissed from the suggestion prompt
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const { context } = useAppContext();
  const qc = useQueryClient();
  const people = useAssignablePeople();
  const { lists } = useLists();
  const { buckets } = useBuckets();

  const isMac = typeof navigator !== "undefined" && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const parsed = useMemo(() => parseToss(value, people), [value, people]);
  // Blocked if there's an unresolved person chip, OR an unconfirmed suggestion that
  // the user hasn't explicitly dismissed yet.
  const blocked = tossBlockedByPerson(
    parsed.chips.filter(
      (c) => !(c.kind === "suggestion" && c.value === dismissedSuggestionId),
    ),
  );

  const effectiveListId = useMemo(() => {
    if (listId) return listId;
    const hashChip = parsed.chips.find((c) => c.kind === "list");
    if (!hashChip) return undefined;
    const hit = lists.find(
      (l) =>
        l.name.toLowerCase() === hashChip.value.toLowerCase() ||
        l.name.toLowerCase().includes(hashChip.value.toLowerCase()),
    );
    return hit?.id;
  }, [listId, parsed.chips, lists]);

  const effectiveBucketId = useMemo(() => {
    const bucketChip = parsed.chips.find((c) => c.kind === "bucket");
    if (!bucketChip) return undefined;
    const hit = buckets.find(
      (b) =>
        b.name.toLowerCase() === bucketChip.value.toLowerCase() ||
        b.name.toLowerCase().includes(bucketChip.value.toLowerCase()),
    );
    return hit?.id;
  }, [parsed.chips, buckets]);

  const checkMentionTrigger = (text: string, cursor: number) => {
    const textBefore = text.slice(0, cursor);
    const atMatch = textBefore.match(/(?:^|\s)@([^\s@#/]*)$/);
    const hashMatch = textBefore.match(/(?:^|\s)#([^\s@#/]*)$/);
    const slashMatch = textBefore.match(/(?:^|\s)\/([^\s@#/]*)$/);

    if (atMatch) {
      const q = atMatch[1] ?? "";
      const startIndex = textBefore.lastIndexOf("@");
      setTrigger({ type: "person", query: q, startIndex });
      setActiveIndex(0);
    } else if (hashMatch) {
      const q = hashMatch[1] ?? "";
      const startIndex = textBefore.lastIndexOf("#");
      setTrigger({ type: "list", query: q, startIndex });
      setActiveIndex(0);
    } else if (slashMatch) {
      const q = slashMatch[1] ?? "";
      const startIndex = textBefore.lastIndexOf("/");
      setTrigger({ type: "bucket", query: q, startIndex });
      setActiveIndex(0);
    } else {
      setTrigger(null);
    }
  };

  const filteredPeople = useMemo(() => {
    if (!trigger || trigger.type !== "person") return [];
    const q = trigger.query.toLowerCase();
    return people.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.initials && p.initials.toLowerCase().includes(q)),
    );
  }, [trigger, people]);

  const filteredLists = useMemo(() => {
    if (!trigger || trigger.type !== "list") return [];
    const q = trigger.query.toLowerCase();
    return lists.filter((l) => l.name.toLowerCase().includes(q));
  }, [trigger, lists]);

  const filteredBuckets = useMemo(() => {
    if (!trigger || trigger.type !== "bucket") return [];
    const q = trigger.query.toLowerCase();
    return buckets.filter((b) => b.name.toLowerCase().includes(q));
  }, [trigger, buckets]);

  const selectPerson = (person: (typeof people)[0]) => {
    if (!trigger) return;
    const prefix = value.slice(0, trigger.startIndex);
    const suffix = value.slice(trigger.startIndex + 1 + trigger.query.length);
    const namePart = person.name.split(" ")[0] || person.name;
    const nextVal = `${prefix}@${namePart} ${suffix}`;
    setValue(nextVal);
    setTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = prefix.length + namePart.length + 2;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const selectList = (list: (typeof lists)[0]) => {
    if (!trigger) return;
    const prefix = value.slice(0, trigger.startIndex);
    const suffix = value.slice(trigger.startIndex + 1 + trigger.query.length);
    const nextVal = `${prefix}#${list.name} ${suffix}`;
    setValue(nextVal);
    setTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = prefix.length + list.name.length + 2;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const selectBucket = (bucket: (typeof buckets)[0]) => {
    if (!trigger) return;
    const prefix = value.slice(0, trigger.startIndex);
    const suffix = value.slice(trigger.startIndex + 1 + trigger.query.length);
    const nextVal = `${prefix}/${bucket.name} ${suffix}`;
    setValue(nextVal);
    setTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = prefix.length + bucket.name.length + 2;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const acceptSuggestedPerson = (person: (typeof people)[0], matchedWord: string) => {
    const namePart = person.name.split(" ")[0];
    const re = new RegExp(`\\b${matchedWord}\\b`, "i");
    let nextVal = value;
    if (re.test(value)) {
      nextVal = value.replace(re, `@${namePart}`);
    } else {
      nextVal = `${value} @${namePart}`;
    }
    setValue(nextVal);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (blocked) throw new Error("Pick a person — Coey won't guess.");
      const live = !isPreviewMode();

      const assigneeIds = parsed.assigneeIds.filter(
        (id) => !(live && id.startsWith("p-")),
      );

      // Multi-toss: one Thing per assignee in parallel
      if (assigneeIds.length > 1) {
        const results = await Promise.all(
          assigneeIds.map((assigneeActorId) =>
            rpcCreateThing({
              title: parsed.title,
              context,
              ownerImportance: parsed.importance,
              listId: effectiveListId,
              assigneeActorId,
              dueAt: parsed.dueAt,
              dueHasTime: parsed.dueHasTime,
            }),
          ),
        );

        if (effectiveBucketId) {
          await Promise.allSettled(
            results
              .filter((r) => r?.id)
              .map((r) => rpcAddToBucket(effectiveBucketId, r!.id)),
          );
        }
        return { count: results.length };
      }

      // Single-toss (0 or 1 assignee)
      const assignee = assigneeIds[0];
      const created = await rpcCreateThing({
        title: parsed.title,
        context,
        ownerImportance: parsed.importance,
        listId: effectiveListId,
        assigneeActorId: assignee,
        dueAt: parsed.dueAt,
        dueHasTime: parsed.dueHasTime,
      });

      if (effectiveBucketId && created?.id) {
        try {
          await rpcAddToBucket(effectiveBucketId, created.id);
        } catch {
          // ignore bucket link error
        }
      }
      return { count: 1 };
    },
    onSuccess: async (result) => {
      setTossed(true);
      setValue("");
      setTrigger(null);
      setDismissedSuggestionId(null);
      await qc.invalidateQueries({ queryKey: keys.court("preview", context) });
      await qc.invalidateQueries({ queryKey: ["court"] });
      if (effectiveListId) {
        await qc.invalidateQueries({ queryKey: ["list-things", effectiveListId] });
        await qc.invalidateQueries({ queryKey: ["lists"] });
      }
      if (effectiveBucketId) {
        await qc.invalidateQueries({ queryKey: ["buckets"] });
      }
      const count = result?.count ?? 1;
      toast.success(count > 1 ? `${count} things tossed ✓` : "Tossed.");
      window.setTimeout(() => setTossed(false), 240);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn’t toss that.");
    },
  });
  const canToss = Boolean(value.trim()) && !blocked && !mutation.isPending;

  return (
    <div
      className={cn(
        "relative mb-3",
        desktop &&
          "fixed bottom-3 left-[calc(50%+6.5rem)] z-50 mb-0 w-[min(840px,calc(100vw-18rem))] -translate-x-1/2",
      )}
    >
      {/* Autocomplete Popover for @ People — appears immediately on typing @ */}
      {trigger?.type === "person" && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-full max-w-sm rounded-2xl border border-border/80 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-1">
            <AtSign className="h-3 w-3 text-primary" />
            Assign to Person
            {trigger.query && (
              <span className="ml-auto normal-case font-normal text-muted-foreground/70">
                "{trigger.query}"
              </span>
            )}
          </div>
          <div className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredPeople.length > 0 ? (
              filteredPeople.map((person, idx) => (
                <button
                  key={person.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectPerson(person);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[12.5px] transition-colors cursor-pointer",
                    idx === activeIndex
                      ? "bg-primary/10 font-semibold text-primary"
                      : "hover:bg-muted/50 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PersonAvatar
                      name={person.name}
                      initials={person.initials}
                      src={person.avatarUrl}
                      size={26}
                    />
                    <div className="min-w-0">
                      <span className="block truncate font-bold text-[12.5px]">{person.name}</span>
                      <span className="block text-[10px] text-muted-foreground">Connected teammate</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground opacity-60">↵ select</span>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-3 text-[12px] text-muted-foreground text-center">
                {trigger.query ? `No match for "${trigger.query}"` : "No teammates connected yet"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Autocomplete Popover for # Lists — appears immediately on typing # */}
      {trigger?.type === "list" && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-full max-w-sm rounded-2xl border border-border/80 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-1">
            <Hash className="h-3 w-3 text-primary" />
            Add to List
            {trigger.query && (
              <span className="ml-auto normal-case font-normal text-muted-foreground/70">
                "{trigger.query}"
              </span>
            )}
          </div>
          <div className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredLists.length > 0 ? (
              filteredLists.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectList(item);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[12.5px] transition-colors cursor-pointer",
                    idx === activeIndex
                      ? "bg-primary/10 font-semibold text-primary"
                      : "hover:bg-muted/50 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <List className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <span className="block truncate font-bold text-[12.5px]">{item.name}</span>
                      <span className="block text-[10px] text-muted-foreground capitalize">
                        List • {item.context}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground opacity-60">↵ select</span>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-3 text-[12px] text-muted-foreground text-center">
                {trigger.query ? `No list matching "${trigger.query}"` : "No lists yet"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Autocomplete Popover for / Buckets — appears immediately on typing / */}
      {trigger?.type === "bucket" && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-full max-w-sm rounded-2xl border border-border/80 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-1">
            <Layers className="h-3 w-3 text-primary" />
            Add to Bucket
            {trigger.query && (
              <span className="ml-auto normal-case font-normal text-muted-foreground/70">
                "{trigger.query}"
              </span>
            )}
          </div>
          <div className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredBuckets.length > 0 ? (
              filteredBuckets.map((bucket, idx) => (
                <button
                  key={bucket.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectBucket(bucket);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[12.5px] transition-colors cursor-pointer",
                    idx === activeIndex
                      ? "bg-primary/10 font-semibold text-primary"
                      : "hover:bg-muted/50 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Layers className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <span className="block truncate font-bold text-[12.5px]">{bucket.name}</span>
                      <span className="block text-[10px] text-muted-foreground capitalize">
                        Bucket • {bucket.context}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground opacity-60">↵ select</span>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-3 text-[12px] text-muted-foreground text-center">
                {trigger.query ? `No bucket matching "${trigger.query}"` : "No buckets yet"}
              </p>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "flex items-center gap-3 transition-opacity duration-200",
          desktop
            ? "h-[58px] rounded-[18px] border border-primary/70 bg-white px-4 shadow-[0_0_28px_rgba(88,71,255,0.2)]"
            : "rounded-xl border border-border bg-card px-1.5",
          tossed && "opacity-60",
        )}
      >
        {desktop ? (
          <KatalistIcon name="katalist-spark" className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        )}
        {/* ── Highlight mirror + input overlay ─────────────────────────────
            The mirror div renders @person #list /bucket tokens as colored bold
            spans. The real <input> sits on top with color:transparent so only
            the blinking caret is visible. Font metrics must match exactly. */}
        <div className="relative flex-1 h-full">
          {/* Mirror — purely visual, no interaction */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-[13.5px] leading-none"
            style={{ paddingTop: 0, paddingBottom: 0 }}
          >
            {value === "" ? null : (
              <>
                {(() => {
                  // Tokenise: split on @word, #word, /word keeping delimiters
                  const parts = value.split(/([@#/][^\s@#/]+)/g);
                  return parts.map((part, i) => {
                    if (/^@[^\s@#/]+/.test(part)) {
                      return (
                        <span key={i} className="font-bold text-primary">
                          {part}
                        </span>
                      );
                    }
                    if (/^#[^\s@#/]+/.test(part)) {
                      return (
                        <span key={i} className="font-bold text-blue-600">
                          {part}
                        </span>
                      );
                    }
                    if (/^\/[^\s@#/]+/.test(part)) {
                      return (
                        <span key={i} className="font-bold text-emerald-600">
                          {part}
                        </span>
                      );
                    }
                    return <span key={i} className="text-foreground">{part}</span>;
                  });
                })()}
              </>
            )}
          </div>

          {/* Real input — transparent text, caret only */}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              const cursor = e.target.selectionStart ?? next.length;
              checkMentionTrigger(next, cursor);
            }}
            onKeyUp={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                const cursor = e.currentTarget.selectionStart ?? value.length;
                checkMentionTrigger(value, cursor);
              }
            }}

          onKeyDown={(e) => {
            if (trigger?.type === "person" && filteredPeople.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % filteredPeople.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + filteredPeople.length) % filteredPeople.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const selected = filteredPeople[activeIndex] ?? filteredPeople[0];
                if (selected) selectPerson(selected);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTrigger(null);
                return;
              }
            }

            if (trigger?.type === "list" && filteredLists.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % filteredLists.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + filteredLists.length) % filteredLists.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const selected = filteredLists[activeIndex] ?? filteredLists[0];
                if (selected) selectList(selected);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTrigger(null);
                return;
              }
            }

            if (trigger?.type === "bucket" && filteredBuckets.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % filteredBuckets.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + filteredBuckets.length) % filteredBuckets.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const selected = filteredBuckets[activeIndex] ?? filteredBuckets[0];
                if (selected) selectBucket(selected);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTrigger(null);
                return;
              }
            }

            if (e.key === "Enter" && value.trim() && !blocked && !mutation.isPending) {
              e.preventDefault();
              void mutation.mutate();
            }
          }}
          placeholder={listName ? `Toss into ${listName}…` : "Toss a thought..."}
          className="absolute inset-0 w-full h-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          style={{ color: "transparent", caretColor: "var(--foreground)" }}
          aria-label="Magic Box"
        />
        </div>
        <kbd
          onClick={() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
          title={isMac ? "Press ⌘K to activate" : "Press Ctrl+K to activate"}
          className={cn(
            "hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline cursor-pointer select-none hover:bg-primary/5 hover:text-primary transition-colors",
            desktop ? "bg-white" : "bg-muted",
          )}
        >
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
        {desktop ? (
          <>
            {(["@", "#", "/"] as const).map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => {
                  const input = inputRef.current;
                  const start = input?.selectionStart ?? value.length;
                  const end = input?.selectionEnd ?? start;
                  const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
                  setValue(next);
                  const newPos = start + 1;
                  setTrigger({
                    type: token === "@" ? "person" : token === "#" ? "list" : "bucket",
                    query: "",
                    startIndex: start,
                  });
                  setActiveIndex(0);
                  requestAnimationFrame(() => {
                    input?.focus();
                    input?.setSelectionRange(newPos, newPos);
                  });
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[18px] text-muted-foreground outline-none hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                aria-label={
                  token === "@"
                    ? "Insert @ person"
                    : token === "#"
                      ? "Insert # list"
                      : "Insert / bucket"
                }
                title={
                  token === "@"
                    ? "Mention person (@)"
                    : token === "#"
                      ? "Link list (#)"
                      : "Link bucket (/)"
                }
              >
                {token}
              </button>
            ))}
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Add attachment"
              title="Add attachment"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Voice input"
              title="Voice input"
            >
              <Mic className="h-4 w-4" />
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  setValue("");
                  setTrigger(null);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                aria-label="Clear Magic Box"
                title="Clear input"
              >
                <KatalistIcon name="clear-input" className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canToss}
              onClick={() => void mutation.mutate()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-[0_4px_14px_rgba(88,71,255,0.35)] outline-none disabled:cursor-not-allowed disabled:bg-primary/30 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              aria-label="Toss Thing"
              title="Toss Thing"
            >
              <KatalistIcon name="send-toss" className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Voice input"
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Natural language AI person suggestion prompt — blocks toss until confirmed or dismissed */}
      {parsed.suggestedPerson &&
        !parsed.assigneeId &&
        parsed.suggestedPerson.person.id !== dismissedSuggestionId && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] text-primary animate-in fade-in slide-in-from-bottom-1">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate text-muted-foreground">
                Did you mean{" "}
                <strong className="font-semibold text-foreground">
                  {parsed.suggestedPerson.person.name}
                </strong>
                ?
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setDismissedSuggestionId(parsed.suggestedPerson!.person.id)}
                className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-all cursor-pointer"
              >
                No, skip
              </button>
              <button
                type="button"
                onClick={() => {
                  acceptSuggestedPerson(
                    parsed.suggestedPerson!.person,
                    parsed.suggestedPerson!.matchedWord,
                  );
                  setDismissedSuggestionId(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-primary/90 transition-all cursor-pointer"
              >
                <Sparkles className="h-3 w-3" />
                Yes, assign to {parsed.suggestedPerson.person.name.split(" ")[0]}
              </button>
            </div>
          </div>
        )}

      {parsed.chips.length > 0 && value.trim() ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parsed.chips.map((c) => {
            const isSuggestion = c.kind === "suggestion";
            return (
              <button
                key={c.kind + c.value}
                type="button"
                disabled={!isSuggestion}
                onClick={() => {
                  if (isSuggestion && parsed.suggestedPerson) {
                    acceptSuggestedPerson(
                      parsed.suggestedPerson.person,
                      parsed.suggestedPerson.matchedWord,
                    );
                  }
                }}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all text-left",
                  desktop && "inline-flex items-center gap-1 bg-white",
                  isSuggestion &&
                    "border-primary/40 bg-primary/5 text-primary hover:bg-primary hover:text-white cursor-pointer shadow-xs",
                  c.kind === "unresolved"
                    ? desktop
                      ? "border-status-waiting/50 text-status-waiting"
                      : "border-status-waiting/40 bg-status-waiting-bg text-status-waiting"
                    : !isSuggestion &&
                      (desktop
                        ? "border-border text-foreground"
                        : "border-border bg-card text-foreground"),
                )}
              >
                {desktop ? (
                  <KatalistIcon
                    name={
                      (
                        {
                          assignee: "at-person",
                          due: "date-detection",
                          importance: "urgent",
                          list: "list",
                          bucket: "hash-bucket",
                          suggestion: "katalist-spark",
                          unresolved: "urgent",
                        } satisfies Record<typeof c.kind, KatalistIconName>
                      )[c.kind]
                    }
                    className="h-3 w-3"
                  />
                ) : null}
                {c.kind === "unresolved"
                  ? c.label
                  : c.kind === "suggestion"
                    ? `${c.label} ↵`
                    : `${c.kind === "assignee" ? "@" : ""}${c.label}`}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
