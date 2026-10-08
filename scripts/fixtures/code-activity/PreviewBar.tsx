import { useId } from "react";
import type { PreviewScenario } from "./preview-adapter";
import { PREVIEW_LABEL } from "./fixtures";

interface PreviewBarProps {
  scenario: PreviewScenario;
  onChange: (patch: Partial<PreviewScenario>) => void;
}

const SELECT =
  "min-h-[34px] rounded-lg border border-[#d6dbea] bg-white px-2 text-[13px] text-black outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]";

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-[#4d5878]">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={SELECT}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Preview-only banner and scenario controls. This component is only ever mounted by the preview
 * adapter's root, so it cannot appear in a live session. Controls change fixture behavior, not real data.
 */
export function PreviewBar({ scenario, onChange }: PreviewBarProps) {
  return (
    <div className="border-b border-dashed border-[#e0b95c] bg-[#fffaf0] px-5 py-2.5 text-[12px] text-[#4a3a10] lg:px-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-md border border-[#e0b95c] bg-white px-2 py-px font-semibold">{PREVIEW_LABEL}</span>
        <span>No GitHub, AI, or database request is made. Nothing you do here creates a real Thing.</span>
      </div>
      <details className="mt-1.5">
        <summary className="inline-flex min-h-[28px] cursor-pointer items-center rounded-md px-1 font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#975ee2]">
          Preview controls <span aria-hidden="true">▾</span>
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-3 pb-1 md:grid-cols-4 xl:grid-cols-7">
          <Select
            label="Viewing as"
            value={scenario.role}
            onChange={(role) => onChange({ role })}
            options={[
              { value: "owner", label: "Owner" },
              { value: "collaborator", label: "Collaborator" },
              { value: "view_only", label: "View Only" },
            ]}
          />
          <Select
            label="Connection"
            value={scenario.connection}
            onChange={(connection) => onChange({ connection })}
            options={[
              { value: "active", label: "Connected" },
              { value: "unconnected", label: "Not connected" },
              { value: "suspended", label: "Suspended" },
              { value: "revoked", label: "Access revoked" },
              { value: "disconnected", label: "Disconnected" },
            ]}
          />
          <Select
            label="Feed"
            value={scenario.feed}
            onChange={(feed) => onChange({ feed })}
            options={[
              { value: "normal", label: "Sample activity" },
              { value: "empty", label: "No activity yet" },
              { value: "error", label: "Fails to load" },
            ]}
          />
          <Select
            label="Sync"
            value={scenario.sync}
            onChange={(sync) => onChange({ sync })}
            options={[
              { value: "ok", label: "Up to date" },
              { value: "syncing", label: "Syncing" },
              { value: "partial", label: "Partial" },
              { value: "stale", label: "Stale" },
              { value: "unavailable", label: "Unavailable" },
            ]}
          />
          <Select
            label="Drafting outcome"
            value={scenario.generation}
            onChange={(generation) => onChange({ generation })}
            options={[
              { value: "success", label: "Succeeds" },
              { value: "timeout", label: "Times out" },
              { value: "invalid_output", label: "Unusable answer" },
              { value: "unavailable", label: "Unavailable" },
            ]}
          />
          <Select
            label="Confirmation outcome"
            value={scenario.confirm}
            onChange={(confirm) => onChange({ confirm })}
            options={[
              { value: "success", label: "Succeeds" },
              { value: "lost_response", label: "Reply is lost once" },
              { value: "source_changed", label: "Source changed" },
              { value: "not_allowed", label: "Not allowed" },
            ]}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[#4d5878]">Private-content consent</span>
            <label className="inline-flex min-h-[34px] items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={scenario.consent}
                onChange={(e) => onChange({ consent: e.target.checked })}
                className="h-4 w-4 accent-[#975ee2]"
              />
              On for this List
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}
