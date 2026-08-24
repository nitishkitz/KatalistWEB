import { MagicBoxComposer } from "./magic-box/MagicBoxComposer";

/** tossBlockedByPerson — Pick a person. Date ambiguity never throws Check date. */
export function MagicBox({
  listId,
  listName,
  desktop = false,
}: {
  listId?: string;
  listName?: string;
  desktop?: boolean;
}) {
  return <MagicBoxComposer listId={listId} listName={listName} desktop={desktop} />;
}
