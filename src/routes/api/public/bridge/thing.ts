import { createFileRoute } from '@tanstack/react-router';
import { bridgeError, json, logBridgeFailure, readBridgeCookie } from '@/lib/bridge-session.server';

// Thing-scoped read for a valid Bridge session. Authority comes from the
// server-held session cookie only; no Thing id is accepted from the caller,
// and no database detail is returned on failure.
export const Route = createFileRoute('/api/public/bridge/thing')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = readBridgeCookie(request);
        if (!session) return bridgeError();

        const { supabaseAdmin } = await import(
          '@/integrations/supabase/client.server'
        );
        const { data, error } = await supabaseAdmin.rpc('bridge_get_thing', {
          p_session_token: session,
        });

        if (error) logBridgeFailure('thing', error);
        if (error || !data || data.length === 0) return bridgeError();
        return json({ thing: data[0] });
      },
    },
  },
});
