import { useId, useRef, useState } from "react";
import { Mic, Paperclip, Sparkles, Square, WandSparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { KatalistIcon } from "../KatalistIcon";
import { AttachmentTray } from "./AttachmentTray";
import { ConfirmationChips } from "./ConfirmationChips";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { ListAutocomplete } from "./ListAutocomplete";
import { listOptionId } from "./list-token";
import { ghostSuffix, mentionOptionId } from "./mention";
import { useMagicBoxController } from "./useMagicBoxController";
import { attachmentsUiEnabled } from "@/features/attachments/flags";

export function MagicBoxComposer({
  listId,
  listName,
  desktop = false,
  floating = false,
}: {
  listId?: string;
  listName?: string;
  desktop?: boolean;
  floating?: boolean;
}) {
  const composerId = useId();
  const box = useMagicBoxController({
    listId,
    listName,
    surface: listId ? "list" : "court",
  });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const highlighted = box.mentionMenuOpen ? box.ranked[box.highlight] : undefined;
  const highlightedList = box.listMenuOpen ? box.rankedLists[box.highlight] : undefined;
  const ghost =
    box.mentionMenuOpen && box.activeMention && highlighted
      ? ghostSuffix(box.activeMention.query, highlighted.name)
      : "";
  const recording = box.voice.state === "recording";
  const transcribing = box.voice.state === "transcribing";
  const recovering = box.draft.attachments.some((item) => item.status === "recovery-failed" || item.createdThingId);
  const attachmentBusy = box.draft.attachments.some((item) => item.status === "uploading" || item.status === "finalizing");
  const visualState = recovering
    ? "recovery"
    : box.pending || recording || transcribing || box.assist.busy || attachmentBusy
      ? "busy"
      : focused || Boolean(box.draft.rawText.trim())
        ? "engaged"
        : "idle";
  const canPolish =
    Boolean(box.assist) &&
    !box.pending &&
    !recording &&
    !transcribing &&
    box.draft.rawText.trim().length >= 8;

  return (
    <div className={cn(floating ? "mb-0" : "mb-3", box.motionClass)} data-magic-box-state={visualState}>
      <div className="sr-only" aria-live="polite">
        {box.announce}
      </div>
      {recovering ? (
        <p id="recovery" className="mb-2 text-[12px] text-status-waiting">
          Thing created. Retry or remove the remaining attachment.
        </p>
      ) : null}
      <div
        className={cn(
          "katalist-magic-box-frame relative flex h-11 items-center gap-2 transition-opacity duration-200",
          desktop
            ? "rounded-xl border border-border bg-white px-3 shadow-[0_0_18px_rgba(88,71,255,0.12)]"
            : "rounded-xl border border-border bg-card px-1.5",
        )}
      >
        {desktop ? (
          <KatalistIcon name="katalist-spark" className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        )}
        <div className="relative h-full min-w-0 flex-1">
          {ghost ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-center text-[13.5px] text-muted-foreground/45"
              aria-hidden
            >
              <span className="invisible whitespace-pre">
                {box.activeMention ? box.draft.rawText.slice(0, box.activeMention.end) : box.draft.rawText}
              </span>
              <span>{ghost}</span>
            </div>
          ) : null}
          <input
            ref={box.inputRef}
            role="combobox"
            value={box.draft.rawText}
            onChange={(event) => box.onTextChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
            onSelect={(event) => {
              const el = event.currentTarget;
              box.onTextChange(el.value, el.selectionStart ?? el.value.length);
            }}
            onKeyDown={(event) => box.onKeyDown(event)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={listName ? `Toss into ${listName}…` : "Toss a thought..."}
            className="relative z-10 h-full w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
            aria-label="Magic Box"
            aria-expanded={box.mentionMenuOpen || box.listMenuOpen}
            aria-haspopup="listbox"
            aria-controls={`${composerId}-listbox`}
            aria-autocomplete="list"
            aria-activedescendant={highlighted ? mentionOptionId(composerId, highlighted.id) : highlightedList ? listOptionId(composerId, highlightedList.id) : undefined}
            autoComplete="off"
          />
          {box.mentionMenuOpen ? (
            <MentionAutocomplete
              composerId={composerId}
              people={box.ranked}
              highlight={box.highlight}
              query={box.activeMention?.query ?? ""}
              floating={floating}
              onPick={(person, index) => box.acceptPerson(person, "click", index)}
            />
          ) : null}
          {box.listMenuOpen ? <ListAutocomplete composerId={composerId} lists={box.rankedLists} highlight={box.highlight} query={box.activeListToken?.query ?? ""} floating={floating} onPick={(list) => box.acceptList(list)} /> : null}
        </div>
        <kbd
          className={cn(
            "hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline",
            desktop ? "bg-white" : "bg-muted",
          )}
        >
          ⌘K
        </kbd>
        {canPolish ? (
          <button
            type="button"
            onClick={() => void box.assist.requestCorrection()}
            disabled={box.assist.busy}
            className="hidden h-8 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed sm:inline-flex"
            aria-label="Polish text"
            title="Polish text"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            Polish text
          </button>
        ) : null}
        {attachmentsUiEnabled() ? (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) void box.addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </>
        ) : null}
        {recording || transcribing ? (
          <>
            <button
              type="button"
              onClick={() => box.voice.stop()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Stop recording"
              title="Stop"
              disabled={transcribing}
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => box.voice.cancel()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Cancel recording"
              title="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void box.voice.start()}
            disabled={!box.voice.supported}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            aria-label="Voice input"
            title={box.voice.supported ? "Voice input" : "Voice is unavailable here"}
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
        {box.draft.rawText ? (
          <button
            type="button"
            onClick={() => box.onTextChange("", 0)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Clear Magic Box"
            title="Clear input"
          >
            <KatalistIcon name="clear-input" className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          disabled={!box.canToss || recovering}
          onClick={() => void box.toss()}
          className="inline-flex h-8 w-9 items-center justify-center rounded-md border border-primary text-primary outline-none disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Toss Thing"
          title="Toss Thing"
        >
          <KatalistIcon name="send-toss" className="h-3.5 w-3.5" />
        </button>
      </div>

      {box.draft.aiCorrection ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted-foreground">Suggestion: {box.draft.aiCorrection.text}</span>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => box.dispatch({ type: "AI_CORRECTION_ACCEPTED" })}
          >
            Use corrected text
          </button>
          <button
            type="button"
            className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => box.dispatch({ type: "AI_CORRECTION_DISMISSED" })}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <ConfirmationChips
        draft={box.draft}
        desktop={desktop}
        floating={floating}
        people={box.people}
        chipEditor={box.chipEditor}
        setChipEditor={box.setChipEditor}
        onAssignee={(person) => box.acceptPerson(person, "chip", 0)}
        onSelf={() => box.dispatch({ type: "ASSIGNEE_CLEARED" })}
        onDue={(dueAt, dueHasTime, label) => box.dispatch({ type: "DUE_SET", dueAt, dueHasTime, label })}
        onDueClear={() => box.dispatch({ type: "DUE_CLEARED" })}
        onImportance={(importance) => box.dispatch({ type: "IMPORTANCE_SET", importance })}
      />
      <AttachmentTray
        attachments={box.draft.attachments}
        onRemove={(clientId) => void box.removeAttachment(clientId)}
        onRetry={(clientId) => void box.retryAttachment(clientId)}
      />
    </div>
  );
}
