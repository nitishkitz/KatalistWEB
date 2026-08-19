import { createFileRoute } from '@tanstack/react-router';
import { bridgeError, json, logBridgeFailure, readBridgeCookie } from '@/lib/bridge-session.server';

const ACTIONS = new Set(['catch', 'not_started', 'under_progress', 'sorted']);

// Narrowly scoped Bridge actions. Forward-only progression, current-assignment
// and non-terminal checks are enforced in the database RPC. Database errors are
// logged server-side only; the guest sees a safe, generic message.
export const Route = createFileRoute('/api/public/bridge/act')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = readBridgeCookie(request);
        if (!session) return bridgeError();

        let action: unknown;
        try {
          ({ action } = (await request.json()) as { action?: unknown });
        } catch {
          return bridgeError('That action isn\u2019t available.', 400);
        }
        if (typeof action !== 'string' || !ACTIONS.has(action)) {
          return bridgeError('That action isn\u2019t available.', 400);
        }

        const { supabaseAdmin } = await import(
          '@/integrations/supabase/client.server'
        );
        const { data, error } = await supabaseAdmin.rpc('bridge_act', {
          p_session_token: session,
          p_action: action,
        });

        if (error) {
          logBridgeFailure('act', error);
          return bridgeError('Unable to update this Thing.', 400);
        }
        return json({ work_status: data });
      },
    },
  },
});
