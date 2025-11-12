# Commit History Performance & Caching

## Summary of Improvements

- Added Next.js `unstable_cache` around recent commit DB fetches with per-user tagging (`commits:user:<id>`).
- Added tag invalidation after commit sync, repository reconciliation, and manual purge.
- Reduced DB payload for commit list (select only needed fields; removed repository include).
- Increased page size from 5 to 10 to reduce pagination churn & repeated slicing.
- Memoized commit list slicing and individual row rendering via `React.memo`.
- Added composite indexes: `Commit(repositoryId, authorDate)` plus `Repository(userId)` for faster filtered queries / purges.
- Leveraged dynamic best-effort `revalidateTag` usage to avoid build-time type mismatches across Next versions.

## Query Path (Before vs After)

| Step | Before | After |
|------|--------|-------|
| Data fetch | Direct `findMany` every request | Cached with TTL (240s) & tags |
| Returned columns | Full row + repository include | Narrow selection of needed fields |
| Purge & sync invalidation | None | Automatic tag invalidation ensuring freshness |
| UI rendering | Re-renders all rows on page change | Only new page slice renders; rows memoized |

## Cache Design

- Key format: `['commits', userId, days, limit, offset]` ensuring distinct windows/page queries.
- TTL: 240 seconds (tunable) balances freshness and DB load.
- Tags: `commits:user:<id>` allow precise invalidation post-sync or repo metadata changes.
- Global tag `commits` invalidated on purge job.

## Invalidation Triggers

| Trigger | Location | Action |
|---------|----------|--------|
| Sync after GitHub fetch | `syncRecentCommits` | `revalidateTag(commits:user:<id>)` |
| Repository reconciliation | `app/api/reconcile-repos` | Revalidate touched users |
| Purge cron | `app/api/purge-commits` | Revalidate global `commits` |

## Further Optimization Ideas

1. Introduce Redis / Upstash for cross-region cache & longer retention windows.
2. Precompute daily contribution aggregates asynchronously to avoid on-request scans.
3. Add incremental static regeneration with `fetch` caching for GitHub API responses.
4. Implement client-side infinite scroll with windowed virtualization (e.g. `react-virtualized`) for large commit sets.
5. Add background scheduled sync (e.g. via Vercel Cron) so first user visit isn't blocked by fresh population.
6. Store normalized commit messages and parse conventional commit metadata for faster filtering.
7. Add SUPABASE or RLS policies if multi-tenant separation expands.

## Adjusting TTLs

- Modify `revalidate` export in `commit-history.tsx` for server component.
- Adjust `revalidate` option in `unstable_cache` call within `getRecentCommitsFromDBCached` for per-query TTL.

## Edge Cases & Notes

- If user has no DB record yet, sync returns early; consider queuing creation.
- GitHub rate limits are logged; a future enhancement could surface status in UI.
- Dynamic import of `revalidateTag` guards against API signature changes across Next versions.

## Metrics To Collect (Recommended)

Add lightweight instrumentation:
- Cache hit ratio (wrap cached call and log when executed vs served from cache).
- Average query latency before/after indexes (Prisma middleware).
- Sync duration and number of commits inserted per run (already returned by `syncRecentCommits`).

## Testing Suggestions

- Unit test caching wrapper to ensure same params produce cached result.
- Integration test invalidation (run sync then ensure subsequent call refetches fresh data).

---
Maintained by performance optimization pass (Nov 2025).
