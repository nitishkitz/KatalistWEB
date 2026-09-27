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
        let clientToken: unknown;
        try {
          ({ body, clientToken } = (await request.json()) as { body?: unknown; clientToken?: unknown });
        } catch {
          return bridgeError('That action isn\u2019t available.', 400);
        }
        if (typeof body !== 'string' || body.trim().length === 0) {
          return bridgeError('A comment cannot be empty.', 400);
        }
        if (body.length > 4000) {
          return bridgeError('That comment is too long.', 400);
        }
        // H08: a client-generated idempotency token, reused by the caller
        // across a retry of the SAME logical send so a lost response
        // cannot create a duplicate comment. Optional and validated as a
        // real UUID -- an invalid value is dropped rather than rejecting
        // the whole request, since idempotency is a best-effort dedupe,
        // not a required field.
        const p_client_token =
          typeof clientToken === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientToken)
            ? clientToken
            : undefined;

        const { supabaseAdmin } = await import(
          '@/integrations/supabase/client.server'
        );
        const { data, error } = await supabaseAdmin.rpc('bridge_comment', {
          p_session_token: session,
          p_body: body,
          p_client_token,
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
