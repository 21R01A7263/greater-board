This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Commit History Retention

The application syncs your recent GitHub commits (per repository) and stores them in the `Commit` table via Prisma. To prevent unbounded growth of this table, a retention policy automatically purges commits older than a configured number of days (default: 30).

### Configuration

Set an environment variable in your `.env` file:

```
COMMIT_RETENTION_DAYS=30
```

If omitted or invalid, the system falls back to 30 days.

### How It Works

1. Each time commits are synced (`syncRecentCommits`), after upserting new commits a background purge removes rows whose `authorDate` is older than the retention window.
2. An opportunistic, non-blocking purge also runs when fetching commit history (`getRecentCommitsFromDB`) to catch stale rows even if a sync has not recently occurred.
3. An index on `Commit.authorDate` improves the performance of both filtering and deletion operations.

### Manual Purge

You can invoke the purge manually in code:

```ts
import { purgeOldCommits } from '@/lib/github-commits';
await purgeOldCommits(45); // keep only last 45 days
```

### Migration

The index is created in the migration `20251110_commit_author_date_idx`. Ensure migrations are applied:

```bash
npx prisma migrate deploy
```

This keeps the commit history lean and query performance stable over time.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

# greater-board

## Required environment variables

Add these to `.env` (see `.env.example`):

- `DATABASE_URL` – Postgres connection for Prisma
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` – Clerk frontend key
- `CLERK_SECRET_KEY` – Clerk backend key
- `CLERK_WEBHOOK_SECRET` – to verify Clerk webhooks
- `CRON_SECRET` – shared secret used to protect scheduled endpoints

Optional:

- `COMMIT_RETENTION_DAYS` – days to retain commits (defaults to 30)
- `GITHUB_GRAPH_REVALIDATE_SECONDS` – cache TTL for contribution graph
 - `COMMIT_SYNC_STALE_MINUTES` – minutes before a new GitHub commit sync is triggered (defaults to 2; previously 30)
 - Weekly/Monthly leaderboard snapshots are rebuilt every 2 minutes via Vercel Cron hitting `GET /api/cron/leaderboard-snapshots?secret=...` (see `vercel.json`).
 - Active leaderboard recompute is scheduled via Vercel cron every 2 minutes (see `vercel.json` entry for `/api/cron/active-leaderboard`).

## Batch Commit Sync Optimization

We now use Prisma `createMany({ skipDuplicates: true })` for repositories and commits in `lib/github-commits.ts` within `syncRecentCommits`. This replaced per-row `upsert` calls to reduce database round trips.

### Rationale
* Commits are immutable on GitHub; if a SHA already exists we don't need to update mutable fields.
* Repository metadata (name/fullName) is updated opportunistically by later syncs if changes occur. Current approach skips updates for existing repos to favor speed. If repo renames must be reflected immediately, switch back to `upsert` for repositories or add a lightweight reconciliation step.
* `skipDuplicates` relies on unique constraints (`Commit.sha`, `Repository.githubRepoId`, `Repository.fullName`).

### Behavior
1. Fetch recent repositories and commits.
2. Bulk insert repositories (skip duplicates).
3. Query inserted + existing repositories to map `githubRepoId` to internal `id`.
4. Bulk insert commits in 1000-row chunks (skip duplicates).
5. Update the user `commitsLastTracked` timestamp and purge old commits.
 6. Reconcile repository name and state flags (private/archived/disabled) each sync.

### Caveats
* Existing commit rows won't have their message/author fields refreshed if they changed (rare). If you need to mutate commit metadata after first insert, you must revert to per-row `upsert` or perform a selective update pass.
* Repository renames after initial sync will not update the stored `name`/`fullName`. To handle renames, add a follow-up reconciliation job using GitHub API to re-fetch repository details and `updateMany`.

### Future Enhancements
* Raw SQL `INSERT ... ON CONFLICT DO UPDATE` for repositories to keep names up-to-date while retaining batch performance.
* Differential update pass for commits whose author names changed (edge case when GitHub user renames).
* Metrics log for number of skipped duplicates per sync.
* Repository availability drift detection metrics.

### Testing
Run the dev server and trigger a sync by visiting a page that loads commit history (e.g., profile area) after setting environment variables for GitHub token and user. Repeated visits should not create duplicate rows.

### Periodic Repository Reconciliation

Endpoint: `POST /api/reconcile-repos` (protected by `CRON_SECRET`).

Purpose: Update repository metadata (rename, privacy, archived/disabled state) and mark repositories as unavailable if they return 404/410/451 from GitHub.

Query params:
* `limit` (optional) – max repositories scanned this invocation (default 200, max 500).

Environment required:
* `CRON_SECRET` – shared secret placed at end of `Authorization` or provided via `x-cron-secret` header.

Auth source for GitHub:
* Per-user GitHub OAuth tokens are retrieved from Clerk for each repository owner. No global `GITHUB_TOKEN` is required.

Response fields:
* `scanned` – number of repos processed.
* `updated` – repos whose metadata changed.
* `markedUnavailable` – repos flagged as `isUnavailable` due to HTTP status (likely deleted/private transfer).

Scheduling suggestion (Vercel Cron example): run every few hours with staggered limits to cover all repos.

### Scheduled jobs (Vercel)

`vercel.json` contains example schedules:

- `POST /api/reconcile-repos` every 3 hours
- `POST /api/purge-commits` daily at 02:15 UTC

Note: Cron routes are publicly reachable but protected by `CRON_SECRET`. Include `x-cron-secret: <secret>` or append the secret to the `Authorization` header value (the handler validates that it ends with the configured secret).

## Learn More

To learn more about Next.js, take a look at the following resources:


You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
