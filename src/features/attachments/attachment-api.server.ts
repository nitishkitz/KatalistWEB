import { createClient } from "@supabase/supabase-js";
import { HttpError, defaultGetUser, jsonNoStore, requireSupabaseUser, type GetUserFn } from "@/lib/supabase-user.server";

export type FinalizeAttachmentRequest = {
  thingId: string;
  clientId: string;
  stagingKey: string;
  fileName: string;
  mimeType: string;
};

export type FinalizeAttachmentResult = {
  attachmentId: string;
  status: "ready";
  storageKey: string;
};

export type AttachmentRow = {
  id: string;
  thing_id: string;
  client_id: string;
  staging_key: string;
  storage_key: string | null;
  file_name: string;
  mime_type: string;
  byte_size: number;
  status: "pending" | "ready";
};

export type AttachmentApiDeps = {
  getUser?: GetUserFn;
  reserve: (input: FinalizeAttachmentRequest, userId: string) => Promise<AttachmentRow>;
  complete: (attachmentId: string, storageKey: string, userId: string) => Promise<AttachmentRow>;
  abandon: (attachmentId: string, userId: string) => Promise<void>;
  storageMove: (from: string, to: string) => Promise<{ ok: boolean; missingSource?: boolean }>;
  storageExists: (key: string) => Promise<boolean>;
  storageRemove: (key: string) => Promise<void>;
};

function sanitizeError(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonNoStore(
      { error: error.status === 401 ? "unauthorized" : "invalid_request", message: error.message },
      error.status,
    );
  }
  const message = error instanceof Error ? error.message : "";
  if (/not found/i.test(message)) return jsonNoStore({ error: "not_found", message: "Thing not found." }, 404);
  if (/limit/i.test(message)) return jsonNoStore({ error: "limit", message: "You can attach up to 5 files." }, 409);
  if (/collision|invalid staging|too large|spoof/i.test(message)) {
    return jsonNoStore({ error: "invalid_request", message: "Check the information and try again." }, 400);
  }
  return jsonNoStore({ error: "retryable", message: "That file slipped. Retry or remove it." }, 503);
}

export function createFinalizeAttachmentHandler(deps: AttachmentApiDeps) {
  return async (request: Request) => {
    try {
      const user = await requireSupabaseUser(request, deps.getUser ?? defaultGetUser);
      const body = (await request.json()) as FinalizeAttachmentRequest;
      if (!body?.thingId || !body.clientId || !body.stagingKey || !body.fileName) {
        throw new HttpError(400, "Check the information and try again.");
      }
      const expectedPrefix = `staging/${user.id}/${body.clientId}/`;
      if (!body.stagingKey.startsWith(expectedPrefix) || body.stagingKey.includes("..")) {
        throw new HttpError(400, "Check the information and try again.");
      }
      const reserved = await deps.reserve(body, user.id);
      const finalKey = reserved.storage_key || `things/${body.thingId}/${reserved.id}/${body.fileName}`;
      if (reserved.status === "ready") {
        return jsonNoStore({
          attachmentId: reserved.id,
          status: "ready",
          storageKey: finalKey,
        } satisfies FinalizeAttachmentResult);
      }
      const moved = await deps.storageMove(body.stagingKey, finalKey);
      if (!moved.ok) {
        const destExists = moved.missingSource ? await deps.storageExists(finalKey) : false;
        if (!destExists) throw new Error("retryable move");
      }
      const completed = await deps.complete(reserved.id, finalKey, user.id);
      return jsonNoStore({
        attachmentId: completed.id,
        status: "ready",
        storageKey: completed.storage_key || finalKey,
      } satisfies FinalizeAttachmentResult);
    } catch (error) {
      return sanitizeError(error);
    }
  };
}

export function createRemoveAttachmentHandler(deps: AttachmentApiDeps) {
  return async (request: Request) => {
    try {
      const user = await requireSupabaseUser(request, deps.getUser ?? defaultGetUser);
      const body = (await request.json()) as { attachmentId?: string; stagingKey?: string };
      if (body.stagingKey) {
        if (!body.stagingKey.startsWith(`staging/${user.id}/`) || body.stagingKey.includes("..")) {
          throw new HttpError(400, "Check the information and try again.");
        }
        await deps.storageRemove(body.stagingKey);
      }
      if (body.attachmentId) await deps.abandon(body.attachmentId, user.id);
      return jsonNoStore({ ok: true });
    } catch (error) {
      return sanitizeError(error);
    }
  };
}

export async function cleanupStalePendingAttachments(deps: {
  listStale: () => Promise<Array<{ id: string; staging_key: string }>>;
  storageRemove: (key: string) => Promise<void>;
  abandon: (id: string) => Promise<void>;
}): Promise<{ removed: number }> {
  const rows = await deps.listStale();
  let removed = 0;
  for (const row of rows) {
    if (!row.staging_key.startsWith("staging/") || row.staging_key.includes("..")) continue;
    await deps.storageRemove(row.staging_key);
    await deps.abandon(row.id);
    removed += 1;
  }
  return { removed };
}

function userClient(request: Request) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return createClient(url, key, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mapRow(data: Record<string, unknown>): AttachmentRow {
  return {
    id: String(data.id),
    thing_id: String(data.thing_id),
    client_id: String(data.client_id),
    staging_key: String(data.staging_key),
    storage_key: data.storage_key ? String(data.storage_key) : null,
    file_name: String(data.file_name),
    mime_type: String(data.mime_type),
    byte_size: Number(data.byte_size),
    status: data.status === "ready" ? "ready" : "pending",
  };
}

export function createSupabaseAttachmentDeps(request: Request): AttachmentApiDeps {
  return {
    async reserve(input: FinalizeAttachmentRequest) {
      const { data, error } = await userClient(request).rpc("reserve_thing_attachment", {
        p_thing_id: input.thingId,
        p_client_id: input.clientId,
        p_staging_key: input.stagingKey,
        p_file_name: input.fileName,
      });
      if (error) throw new Error(error.message);
      return mapRow(data as Record<string, unknown>);
    },
    async complete(attachmentId, storageKey) {
      const { data, error } = await userClient(request).rpc("complete_thing_attachment", {
        p_attachment_id: attachmentId,
        p_storage_key: storageKey,
      });
      if (error) throw new Error(error.message);
      return mapRow(data as Record<string, unknown>);
    },
    async abandon(attachmentId) {
      const { error } = await userClient(request).rpc("abandon_pending_attachment", {
        p_attachment_id: attachmentId,
      });
      if (error) throw new Error(error.message);
    },
    async storageMove(from, to) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.storage.from("thing-attachments").move(from, to);
      if (!error) return { ok: true };
      const missingSource = /not found|not_found|404/i.test(error.message);
      return { ok: false, missingSource };
    },
    async storageExists(key) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const folder = key.split("/").slice(0, -1).join("/");
      const name = key.split("/").pop() ?? key;
      const { data } = await supabaseAdmin.storage.from("thing-attachments").list(folder);
      return Boolean(data?.some((item) => item.name === name));
    },
    async storageRemove(key) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("thing-attachments").remove([key]);
    },
  };
}
