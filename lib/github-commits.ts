import prisma from './prisma';
import { unstable_cache } from 'next/cache';

// Retention configuration: number of days to keep commits. Defaults to 30.
// Can be overridden with process.env.COMMIT_RETENTION_DAYS (string integer).
const COMMIT_RETENTION_DAYS: number = (() => {
  const raw = process.env.COMMIT_RETENTION_DAYS;
  if (!raw) return 30;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
})();

// How long before we consider the commit sync "stale" and eligible to refetch from GitHub.
// Default lowered from 30 minutes to 2 minutes, configurable via COMMIT_SYNC_STALE_MINUTES.
const COMMIT_SYNC_STALE_MINUTES: number = (() => {
  const raw = process.env.COMMIT_SYNC_STALE_MINUTES;
  if (!raw) return 2;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
})();

// Basic REST fetch wrapper with GitHub rate limit awareness and ETag support
async function ghWithEtag(url: string, token: string, etag?: string): Promise<{ status: number; etag?: string | null; json?: any; }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'greater-board',
      Accept: 'application/vnd.github+json',
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
    cache: 'no-store',
  });
  const rl = res.headers.get('x-ratelimit-remaining');
  if (res.status === 403) {
    const reset = res.headers.get('x-ratelimit-reset');
    console.warn('GitHub rate limited. remaining=', rl, 'reset=', reset);
  }
  const newEtag = res.headers.get('etag');
  if (res.status === 304) {
    return { status: 304, etag: newEtag };
  }
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${url}`);
  }
  const json = await res.json();
  return { status: res.status, etag: newEtag, json };
}

export interface SyncedCommit {
  sha: string;
  message: string;
  authorName: string;
  authorDate: string; // ISO
  htmlUrl: string;
  repositoryFullName: string;
  repositoryId: number; // GitHub repo id
  repositoryName: string;
}

export type DBCommitLite = {
  sha: string;
  message: string;
  authorName: string;
  authorDate: Date;
  htmlUrl: string;
};

interface GitHubRepoSearchItem { id: number; full_name: string; name: string; private?: boolean; archived?: boolean; disabled?: boolean; }
interface GitHubCommitItem { sha: string; commit: { message: string; author: { name: string; date: string; } }; html_url: string; }

// Fetch repositories updated in last N days for user
async function fetchRecentRepos(username: string, days: number, token: string) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString().split('T')[0];
  const q = encodeURIComponent(`user:${username} pushed:>=${sinceISO}`);
  const searchUrl = `https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=100`;
  const { json } = await ghWithEtag(searchUrl, token);
  return (json as { items: GitHubRepoSearchItem[] }).items;
}

// Limit concurrency to avoid bursting API (simple pool)
async function mapPool<I, O>(items: I[], limit: number, worker: (item: I) => Promise<O>): Promise<O[]> {
  const ret: O[] = [];
  let i = 0;
  const active: Promise<void>[] = [];
  async function run(item: I) {
    const result = await worker(item);
    ret.push(result);
  }
  while (i < items.length) {
    while (active.length < limit && i < items.length) {
      const p = run(items[i++]).finally(() => {
        const idx = active.indexOf(p as any);
        if (idx >= 0) active.splice(idx, 1);
      });
      active.push(p as any);
    }
    if (active.length) await Promise.race(active);
  }
  await Promise.all(active);
  return ret;
}

async function fetchCommitsForRepo(fullName: string, sinceISO: string, token: string, perPage: number, etag?: string) {
  const url = `https://api.github.com/repos/${fullName}/commits?since=${sinceISO}&per_page=${perPage}`;
  return ghWithEtag(url, token, etag);
}

export async function syncRecentCommits(params: { userId: string; githubUsername: string; token: string; days?: number; maxRepos?: number; concurrency?: number; }): Promise<number> {
  const { userId, githubUsername, token } = params;
  const days = params.days ?? 30;
  const maxRepos = params.maxRepos ?? 50; // Soft cap
  const concurrency = params.concurrency ?? 5;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString().split('T')[0];

  // Resolve DB user id (may be primary id or Clerk id)
  const dbUser = await prisma.user.findFirst({
    where: { OR: [ { id: userId }, { clerkUserId: userId } ] },
    select: { id: true },
  });
  if (!dbUser) {
    console.warn('syncRecentCommits: No matching DB user for id', userId);
    return 0;
  }

  const repos = (await fetchRecentRepos(githubUsername, days, token)).slice(0, maxRepos);

  // Gather commits across repos; keep latest 5 for UI but scan all for aggregates
  const globalSet = new Set<string>(); // dedupe by sha
  const globalCommits: SyncedCommit[] = [];
  // Per-day aggregate accumulator
  const dayAgg = new Map<string, { date: Date; shortMsgs: number; conventional: number; fixRefactorTest: number; uniqueSet: Set<string>; hours: Set<number>; }>();

  await mapPool(repos, concurrency, async (repo) => {
    try {
      // read any stored commits ETag for this repo
  // Type may not yet include new commitsEtag field until prisma generate runs; cast to any
  const repoRow = await (prisma.repository as any).findFirst({ where: { githubRepoId: repo.id, userId: dbUser.id }, select: { id: true, commitsEtag: true } });
  const { status, json, etag } = await fetchCommitsForRepo(repo.full_name, sinceISO, token, 50, (repoRow as any)?.commitsEtag ?? undefined);
      if (etag && repoRow) {
        // best-effort store new ETag (cast to any if type not updated)
        await (prisma.repository as any).update({ where: { id: (repoRow as any).id }, data: { commitsEtag: etag } }).catch(() => {});
      }
      if (status === 304) {
        // No changes for this repo; skip
        return [] as SyncedCommit[];
      }
      const items = (json as GitHubCommitItem[]) || [];
      // Early cut-off: stop processing once we hit commits older than the retention window
      for (const c of items) {
        if (!c?.commit?.author?.date) continue;
        const d = new Date(c.commit.author.date);
        if (d < since) break; // early cut-off
        const isoDay = d.toISOString().slice(0, 10);
        const dayKey = isoDay;
        const bucket = dayAgg.get(dayKey) || { date: new Date(isoDay + 'T00:00:00Z'), shortMsgs: 0, conventional: 0, fixRefactorTest: 0, uniqueSet: new Set<string>(), hours: new Set<number>() };
        const msg = (c.commit.message || '').trim();
        if (msg.length > 0 && msg.length < 5) bucket.shortMsgs += 1;
        if (/^(feat|fix|docs|refactor|test|chore|perf)(\(|:)/i.test(msg)) bucket.conventional += 1;
        if (/^(fix|refactor|test):/i.test(msg)) bucket.fixRefactorTest += 1;
        bucket.uniqueSet.add(msg.toLowerCase());
        bucket.hours.add(d.getUTCHours());
        dayAgg.set(dayKey, bucket);
        const sha = c.sha;
        if (globalSet.has(sha)) continue; // dedupe in-memory
        // Only store up to 5 visually; still continue loop to update aggregates
        if (globalCommits.length < 5) {
          globalSet.add(sha);
          globalCommits.push({
            sha,
            message: c.commit.message,
            authorName: c.commit.author?.name || 'Unknown',
            authorDate: c.commit.author?.date,
            htmlUrl: c.html_url,
            repositoryFullName: repo.full_name,
            repositoryId: repo.id,
            repositoryName: repo.name,
          });
        }
      }
      return [] as SyncedCommit[];
    } catch (e) {
      console.warn('Failed commits for', repo.full_name, e);
      return [] as SyncedCommit[];
    }
  });

  // Upsert per-day aggregates using RepoDailyContribution totals as ground truth for total count
  try {
    const dayKeys = Array.from(dayAgg.keys());
    if (dayKeys.length) {
      const dates = dayKeys.map(k => new Date(k + 'T00:00:00Z'));
      // Sum counts by date
      const totals = await ((prisma as any).repoDailyContribution).groupBy({
        by: ['date'],
        where: { userId: dbUser.id, date: { in: dates } },
        _sum: { count: true },
      }).catch(() => [] as any[]);
      const totalByISO = new Map<string, number>();
      for (const t of (totals as any[])) {
        const iso = (t.date as Date).toISOString().slice(0,10);
        totalByISO.set(iso, (t._sum?.count ?? 0) as number);
      }
      const rows = dayKeys.map(k => {
        const v = dayAgg.get(k)!;
        return {
          userId: dbUser.id,
          date: v.date,
          total: totalByISO.get(k) ?? 0,
          shortMsgs: v.shortMsgs,
          conventional: v.conventional,
          fixRefactorTest: v.fixRefactorTest,
          uniqueMessages: v.uniqueSet.size,
          hoursJson: { hours: Array.from(v.hours.values()) },
        };
      });
      // Upsert one by one to respect unique(userId,date)
      for (const r of rows) {
        await ((prisma as any).userDayCommitAggregate).upsert({
          where: { userId_date: { userId: r.userId, date: r.date } },
          update: { total: r.total, shortMsgs: r.shortMsgs, conventional: r.conventional, fixRefactorTest: r.fixRefactorTest, uniqueMessages: r.uniqueMessages, hoursJson: r.hoursJson },
          create: r,
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('aggregate upsert failed', e);
  }

  if (!globalCommits.length) return 0;

  // Upsert repositories first
  const repoMap = new Map<number, { id: number; name: string; fullName: string; isPrivate: boolean; isArchived: boolean; isDisabled: boolean }>();
  repos.forEach(r => repoMap.set(r.id, { id: r.id, name: r.name, fullName: r.full_name, isPrivate: !!r.private, isArchived: !!r.archived, isDisabled: !!r.disabled }));

  // Batch insert repositories using createMany to cut round trips; rely on unique constraints to skip duplicates.
  const repoValues = Array.from(repoMap.values());
  if (repoValues.length) {
    await prisma.repository.createMany({
      data: repoValues.map(r => ({
        githubRepoId: r.id,
        name: r.name,
        fullName: r.fullName,
        isPrivate: r.isPrivate,
        isArchived: r.isArchived,
        isDisabled: r.isDisabled,
        isUnavailable: false,
        userId: dbUser.id,
      })),
      skipDuplicates: true,
    });
  }
  // Build mapping githubRepoId -> repository.id (DB PK)
  // NOTE: After adding new repository flag fields you must run `prisma generate` so that the TypeScript client knows about them.
  // Until then we cast to any to avoid transient type errors in dev.
  const allRepos = await (prisma.repository as any).findMany({
    where: { githubRepoId: { in: repoValues.map(r => r.id) } },
    // Selecting only needed fields; new fields may not be in the generated client yet.
    select: { id: true, githubRepoId: true, name: true, fullName: true, isPrivate: true, isArchived: true, isDisabled: true },
  }) as Array<{ id: number; githubRepoId: number; name: string; fullName: string; isPrivate?: boolean; isArchived?: boolean; isDisabled?: boolean; }>;
  const repoIdByGhId = new Map<number, number>(allRepos.map(r => [r.githubRepoId, r.id]));

  // Reconcile repository renames: update existing rows whose name/fullName changed.
  if (allRepos.length) {
    const byGhId = new Map(allRepos.map(r => [r.githubRepoId, r] as const));
    const updates = repoValues
      .map(r => {
        const cur = byGhId.get(r.id);
        if (!cur) return null;
        const needsUpdate = (
          cur.name !== r.name ||
          cur.fullName !== r.fullName ||
          (cur.isPrivate ?? false) !== r.isPrivate ||
          (cur.isArchived ?? false) !== r.isArchived ||
          (cur.isDisabled ?? false) !== r.isDisabled
        );
        if (needsUpdate) {
            return (prisma.repository as any).update({
              where: { id: cur.id },
              data: { name: r.name, fullName: r.fullName, isPrivate: r.isPrivate, isArchived: r.isArchived, isDisabled: r.isDisabled, lastCheckedAt: new Date(), isUnavailable: false },
            });
        }
        return null;
      })
      .filter((u): u is ReturnType<typeof prisma.repository.update> => !!u);
    if (updates.length) {
      await prisma.$transaction(updates as any);
    }
  }

  // Batch insert commits with createMany and skipDuplicates for idempotency.
  // Commit fields for a given SHA are immutable on GitHub, so skipping updates is acceptable.
  // Take only the latest 5 across all repos, sorted by date desc
  const top5 = globalCommits
    .slice()
    .sort((a, b) => new Date(b.authorDate).getTime() - new Date(a.authorDate).getTime())
    .slice(0, 5);

  const commitRows = top5
    .map(c => {
      const repoId = repoIdByGhId.get(c.repositoryId);
      if (!repoId) return null;
      return {
        commit_id: c.sha,
        message: c.message,
        authorName: c.authorName,
        authorDate: new Date(c.authorDate),
        htmlUrl: c.htmlUrl,
        repositoryId: repoId,
        userId: dbUser.id,
      };
    })
    .filter(Boolean) as Array<{
      commit_id: string;
      message: string;
      authorName: string;
      authorDate: Date;
      htmlUrl: string;
      repositoryId: number;
      userId: string;
    }>;

  // Insert up to 5 rows; skipDuplicates ensures idempotency
  if (commitRows.length) {
    await prisma.commit.createMany({ data: commitRows, skipDuplicates: true });
  }

  // Enforce max 5 commits stored per user: keep top 5 by authorDate, delete the rest
  await enforceTop5ForUser(dbUser.id);

  // Update user tracking timestamps
  await prisma.user.update({ where: { id: dbUser.id }, data: { commitsLastTracked: new Date() } });
  // Cache invalidation must not run during render; callers may explicitly revalidate via API if needed.
  // Pre-warm cache for 5-commit view
  try {
    await getRecentCommitsFromDBCached(dbUser.id, days, 5, 0);
  } catch {}

  // Purge old commits by date (mostly no-op given we cap at 5)
  try {
    await purgeOldCommits(COMMIT_RETENTION_DAYS);
  } catch (e) {
    console.warn('purgeOldCommits failed', e);
  }
  return commitRows.length;
}

export async function getRecentCommitsFromDB(userId: string, days = 30, limit = 50, offset = 0): Promise<DBCommitLite[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  // Resolve DB user id
  const dbUser = await prisma.user.findFirst({ where: { OR: [ { id: userId }, { clerkUserId: userId } ] }, select: { id: true } });
  if (!dbUser) return [];
  // Opportunistic purge (non-blocking). Avoids accumulating stale rows if sync hasn't run recently.
  purgeOldCommits(COMMIT_RETENTION_DAYS).catch(err => console.debug('opportunistic purge failed (ignored)', err));
  const take = Math.min(5, limit ?? 5);
  const rows = await (prisma.commit as any).findMany({
    where: { userId: dbUser.id, authorDate: { gte: since }, repository: { isUnavailable: false } },
    orderBy: { authorDate: 'desc' },
    skip: 0, // always first page for UI
    take,
    // Only select fields used by UI layer to reduce payload
    select: { commit_id: true, message: true, authorName: true, authorDate: true, htmlUrl: true },
  });
  return (rows as Array<{ commit_id: string; message: string; authorName: string; authorDate: Date; htmlUrl: string; }>).map(r => ({
    sha: r.commit_id,
    message: r.message,
    authorName: r.authorName,
    authorDate: r.authorDate,
    htmlUrl: r.htmlUrl,
  }));
}

// Cached variant; builds a cache key from params and attaches a user-specific tag so sync can invalidate.
export async function getRecentCommitsFromDBCached(userId: string, days = 30, limit = 50, offset = 0): Promise<DBCommitLite[]> {
  // Force canonical cache key for the 5-item view
  const effLimit = 5;
  const key = ['commits', userId, String(days), String(effLimit), '0'];
  const cached = unstable_cache(
    async () => getRecentCommitsFromDB(userId, days, effLimit, 0),
    key,
    { revalidate: 120, tags: [`commits:user:${userId}`] }
  );
  return cached();
}

export async function needsCommitSync(userId: string, staleMinutes = COMMIT_SYNC_STALE_MINUTES) {
  const user = await prisma.user.findFirst({ where: { OR: [ { id: userId }, { clerkUserId: userId } ] }, select: { commitsLastTracked: true } });
  if (!user?.commitsLastTracked) return true;
  const ageMs = Date.now() - user.commitsLastTracked.getTime();
  return ageMs > staleMinutes * 60 * 1000;
}

// Delete commits older than the specified number of days based on authorDate.
// Returns number of rows deleted. Uses a single deleteMany query relying on index for performance.
export async function purgeOldCommits(days: number = 30): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const res = await prisma.commit.deleteMany({ where: { authorDate: { lt: cutoff } } });
  return res.count;
}

// Keep only top 5 commits per user by authorDate (desc)
async function enforceTop5ForUser(userId: string): Promise<void> {
  const top = await (prisma.commit as any).findMany({
    where: { userId },
    orderBy: { authorDate: 'desc' },
    select: { id: true },
    take: 5,
  });
  const keepIds = new Set((top as Array<{ id: number }>).map((t) => t.id));
  await (prisma.commit as any).deleteMany({ where: { userId, NOT: { id: { in: Array.from(keepIds) } } } });
}
