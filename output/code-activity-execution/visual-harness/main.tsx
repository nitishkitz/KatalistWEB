import { createRoot } from "react-dom/client";
import "@/styles.css";
import { CodeActivityWorkspace } from "@/features/code-activity/workspace/CodeActivityWorkspace";

const params = new URLSearchParams(location.search);
const role = (params.get("role") ?? "owner") as "owner" | "collaborator" | "viewer";

createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 16 }}>
    <CodeActivityWorkspace
      listId="10000000-0000-0000-0000-000000000001"
      listName="WORKSHOP FRIDAY"
      role={role}
      suspended={false}
      ai={{ available: false, consent: false } as never}
      people={[]}
      onManage={() => {}}
      onOpenConsent={() => {}}
    />
  </div>,
);
