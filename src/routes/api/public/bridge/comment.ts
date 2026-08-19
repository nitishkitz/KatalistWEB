import { createFileRoute } from '@tanstack/react-router';
import { bridgeError, json, logBridgeFailure, readBridgeCookie } from '@/lib/bridge-session.server';

// Bridge comment: writes into the same canonical thing_comments conversation,
// attributed to the external Actor. No List access, no other Things. Database
// errors never reach the guest.
export const Route = createFileRoute('/api/public/bridge/comment')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = readBridgeCookie(request);
        if (!session) return bridgeError();

        let body: unknown;
        try {
          ({ body } = (await request.json()) as { body?: unknown });
        } catch {
          return bridgeError('That action isn\u2019t available.', 400);
        }
        if (typeof body !== 'string' || body.trim().length === 0) {
          return bridgeError('A comment cannot be empty.', 400);
        }
        if (body.length > 4000) {
          return bridgeError('That comment is too long.', 400);
        }

        const { supabaseAdmin } = await import(
          '@/integrations/supabase/client.server'
        );
        const { data, error } = await supabaseAdmin.rpc('bridge_comment', {
          p_session_token: session,
          p_body: body,
        });

        if (error) {
          logBridgeFailure('comment', error);
          return bridgeError('Unable to update this Thing.', 400);
        }
        return json({ comment_id: data });
      },
    },
  },
});
