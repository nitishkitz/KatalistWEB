# Preview E2E specs

These specs use an isolated, synthetic Demo Persona session. Some tests
capture or edit preview-local Things; they are **not** all unauthenticated or
read-only. Demo actions must never reach a live Supabase project. CI supplies
an unreachable fixture URL/key and `VITE_KATALIST_DEMO_MODE=true`.

Run the authenticated preview journeys with demo mode enabled. Do not treat
their skip result as a pass: a missing Demo tab means capture and Morning Brief
coverage did not execute. Breakpoint-specific skips (for the opposite layout)
are expected on the desktop/tablet projects.

Locally, `.env.local` may name a real project. For a safe isolated run, override
the Supabase URL/key with unreachable fixture values and keep any test writes
inside Demo Persona local state. Specs that require real signed-in data belong
in `tests/e2e/staging/` with an explicitly isolated test environment.
