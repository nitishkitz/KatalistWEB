import { createFileRoute } from '@tanstack/react-router';
import {
  bridgeCookieHeader,
  bridgeError,
  json,
  logBridgeFailure,
} from '@/lib/bridge-session.server';

// Magic link -> trusted server route -> validated grant -> short-lived
// HttpOnly Bridge session cookie. The raw token is never logged and the
// service-role key never reaches the browser. Every failure returns the same
// neutral message so the endpoint cannot be used to probe the database.
export const Route = createFileRoute('/api/public/bridge/redeem')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let token: unknown;
        try {
          const body = (await request.json()) as { token?: unknown };
          token = body?.token;
        } catch {
          return bridgeError();
        }
        if (typeof token !== 'string' || token.length < 20 || token.length > 512) {
          return bridgeError();
        }

        const { supabaseAdmin } = await import(
          '@/integrations/supabase/client.server'
        );

        // The RPC validates: grant exists, not expired, not revoked, the
        // assignment is still current, the current assignee is still the
        // external actor on the grant, and the Thing is not Sorted/Cancelled.
        const { data, error } = await supabaseAdmin.rpc('bridge_redeem_token', {
          p_token: token,
        });

        if (error) logBridgeFailure('redeem', error);
        if (error || !data || data.length === 0) {
          return bridgeError();
        }

        const session = data[0]!;
        return json(
          { thing_id: session.thing_id, expires_at: session.expires_at },
          {
            headers: {
              'set-cookie': bridgeCookieHeader(
                session.session_token,
                session.expires_at,
              ),
            },
          },
        );
      },
    },
  },
});
