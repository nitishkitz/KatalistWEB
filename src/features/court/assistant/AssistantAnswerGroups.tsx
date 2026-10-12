import { useEffect, useRef, useState } from "react";
import { useCourt } from "../use-court";
import { useNudges } from "@/features/nudges/use-nudges";
import { AssistantThingGroup } from "./AssistantThingGroup";
import { useAssistantRowActions } from "./use-assistant-row-actions";

export type AnswerGroup = {
  key: string;
  title: string;
  thing_ids: string[];
  total: number;
  notes?: Record<string, string>;
};

/**
 * Renders the server's answer groups from the Court's own Thing data
 * (avatars, capabilities) and the server's nudge eligibility and history.
 * Loaded lazily by the Ask panel so the Court data layer is only pulled in
 * when an answer actually has rows.
 */
export default function AssistantAnswerGroups({
  groups,
  answeredAt,
  onOpenThing,
}: {
  groups: AnswerGroup[];
  answeredAt: number;
  onOpenThing: (thingId: string) => void;
}) {
  const court = useCourt();
  const nudgeState = useNudges();
  const rowActions = useAssistantRowActions();
  const courtById = new Map(court.all.map((thing) => [thing.id, thing]));

  // The answer is the source of truth. If it names a Thing the Court cache
  // does not hold yet, refetch the Court once instead of hiding the row, and
  // only report a row as missing after that recheck has come back.
  const missingFromCourt = groups.some((group) => group.thing_ids.some((id) => !courtById.has(id)));
  const recheckedFor = useRef(0);
  const [recheckDoneFor, setRecheckDoneFor] = useState(0);
  useEffect(() => {
    if (!missingFromCourt || !court.hasFetchedOnce || !answeredAt) return;
    if (recheckedFor.current === answeredAt) return;
    recheckedFor.current = answeredAt;
    void Promise.resolve(court.refetch()).finally(() => setRecheckDoneFor(answeredAt));
  }, [missingFromCourt, court, answeredAt]);

  const nudgeFor = (thingId: string) => ({
    allowed: nudgeState.nudgeableIds.has(thingId),
    lastNudgedAt: nudgeState.lastNudgedAt.get(thingId),
    loading: nudgeState.eligibilityLoading,
  });

  return (
    <>
      {groups.map((group) => {
        const resolved = group.thing_ids
          .map((id) => courtById.get(id))
          .filter((thing): thing is NonNullable<typeof thing> => Boolean(thing));
        return (
          <AssistantThingGroup
            key={group.key}
            title={group.title}
            total={group.total}
            things={resolved}
            missingCount={
              recheckDoneFor === answeredAt ? group.thing_ids.length - resolved.length : 0
            }
            notes={group.notes}
            myActorId={court.myActorId}
            nudgeFor={nudgeFor}
            actions={rowActions}
            onOpen={onOpenThing}
          />
        );
      })}
    </>
  );
}
