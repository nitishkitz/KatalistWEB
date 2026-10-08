/** MOCKED: stands in for the real List-scoped Magic Box, which needs the app's providers. */
export function MagicBox({ listName }: { listId?: string; listName?: string; desktop?: boolean }) {
  return (
    <div style={{ border: "1px solid #d9def0", borderRadius: 12, padding: "12px 14px", fontSize: 14, color: "#6a769c", background: "#fff" }}>
      <input aria-label="Magic Box (harness stub)" placeholder={`Toss a Thing into ${listName ?? "this List"}…`} style={{ width: "100%", border: 0, outline: 0, font: "inherit" }} />
    </div>
  );
}
