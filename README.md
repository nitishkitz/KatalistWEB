# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Database migrations

There are two separate, unrelated migration systems in this repository. Do
not assume one deploys the other's changes.

- **`migrations/`** — deploy-time SQL for the `pg`/PGLite stack (Neon in
  production, PGLite as a local fallback — see `src/lib/db.ts`). Applied by
  `scripts/migrate.mjs`, which `npm run build` runs automatically
  (`npm run build:app` does **not** — it is the migration-free application
  build used by CI/hosting). `npm run db:migrate` runs this migrator
  directly. With no `DATABASE_URL` set, it skips and the PGLite fallback
  migrates itself at startup instead.
- **`supabase/migrations/`** — the actual Supabase Postgres schema this app
  runs against for everything else (Things, Lists, Buckets, Court, Morning
  Brief, chat, calls, Bridge, etc.). **Nothing in this repository's `npm`
  scripts deploys these.** They are applied to a Supabase project with the
  Supabase CLI (e.g. `supabase db push`) or an equivalent operator step,
  against whichever project the deployment's `SUPABASE_URL`/
  `VITE_SUPABASE_URL` actually points at. A migration living in this
  directory (for example
  `supabase/migrations/20260923100000_morning_brief_receipts.sql`) is
  **prepared, not deployed**, until that step has actually been run and
  verified.
