import { MagicBox } from "./MagicBox";

export type MagicBoxContext = {
  listId: string;
  listName: string;
  editable: boolean;
};

export function FloatingMagicBox({ context }: { context?: MagicBoxContext }) {
  if (context && !context.editable) return null;
  const list = context?.editable ? context : undefined;
  return (
    <div className="pointer-events-none fixed bottom-16 left-3 right-3 z-40 md:bottom-3 md:left-[252px] md:right-8">
      <div className="pointer-events-auto mx-auto w-full max-w-[1120px]">
        <MagicBox listId={list?.listId} listName={list?.listName} desktop floating />
      </div>
    </div>
  );
}
