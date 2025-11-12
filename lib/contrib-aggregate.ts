import { unstable_cache } from 'next/cache';
import prisma from './prisma';
import { auth, clerkClient } from '@clerk/nextjs/server';

// Time bucket windows
const MORNING_START = 5; // 05:00
const MORNING_END = 10;  // 10:59 inclusive
const EVENING_START = 20; // 20:00
const EVENING_END = 23;   // 23:59 inclusive

// Convert occurredAt (ISO UTC) to local date and hour using IANA timezone
function toLocalParts(iso: string, tz: string | undefined) {
  const date = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const y = Number(get('year'));
  const m = Number(get('month')) - 1;
  const d = Number(get('day'));
  const h = Number(get('hour'));
  const local = new Date(Date.UTC(y, m, d));
  const isoDay = local.toISOString().slice(0, 10);
  return { isoDay, hour: h };
}

// Fetch commit contributions by repository via GitHub GraphQL for a window
async function fetchCommitContribsByRepo(token: string, fromISO: string, toISO: string) {
  const query = `
    query($from: DateTime!, $to: DateTime!, $after: String) {
      viewer {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 50) {
            repository { databaseId nameWithOwner isPrivate }
            contributions(first: 100, after: $after) {
              nodes { occurredAt }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    }
  `;
  const headers = { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' } as const;
  const body = (after?: string) => ({ query, variables: { from: fromISO, to: toISO, after } });
  const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify(body()) });
  if (!res.ok) throw new Error('GraphQL fetch failed: ' + res.status);
  const json = await res.json();
  const repoBlocks = json?.data?.viewer?.contributionsCollection?.commitContributionsByRepository as Array<any> | undefined;
  if (!repoBlocks) return [] as Array<{ repoId: number; fullName: string; isPrivate: boolean; occurredAt: string } >;
  const rows: Array<{ repoId: number; fullName: string; isPrivate: boolean; occurredAt: string } > = [];
  for (const block of repoBlocks) {
    const repoId = block?.repository?.databaseId as number | undefined;
    const fullName = block?.repository?.nameWithOwner as string | undefined;
    const isPrivate = !!block?.repository?.isPrivate;
    if (!repoId || !fullName) continue;
    let afterCursor: string | undefined = undefined;
    let page = block?.contributions;
    // Drain this repo's contributions with simple loop and guard
    let safety = 0;
    while (page && safety < 5) {
      const nodes = (page.nodes as Array<{ occurredAt: string }>) || [];
      for (const n of nodes) rows.push({ repoId, fullName, isPrivate, occurredAt: n.occurredAt });
      if (page.pageInfo?.hasNextPage) {
        afterCursor = page.pageInfo.endCursor as string | undefined;
        // fetch next page for this repo
        const pRes = await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify(body(afterCursor)) });
        if (!pRes.ok) break;
        const pJson = await pRes.json();
        // We get a full result again; re-find this repo by name to get the next page
        const blocks = pJson?.data?.viewer?.contributionsCollection?.commitContributionsByRepository as Array<any>;
        const same = blocks?.find((b: any) => b?.repository?.databaseId === repoId);
        page = same?.contributions;
      } else {
        break;
      }
      safety++;
    }
  }
  return rows;
}

export async function syncRepoDailyAggregates(userId: string, registrationCutoff: Date) {
  // Resolve user and token
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const token = (await clerk.users.getUserOauthAccessToken(userId, 'github')).data?.[0]?.token as string | undefined;
  if (!token) return 0;
  const dbUser = await (prisma as any).user.findFirst({ where: { OR: [{ id: userId }, { clerkUserId: userId }] }, select: { id: true, timezone: true } });
  if (!dbUser) return 0;
  const tz = (dbUser as any).timezone || 'UTC';

  // Window: last 90 days but not before registration
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - 90);
  if (from < registrationCutoff) from.setTime(registrationCutoff.getTime());
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  // Fetch and aggregate
  const rows = await fetchCommitContribsByRepo(token, fromISO, toISO);
  if (!rows.length) return 0;

  // Build upsert maps
  const perDayPerRepo = new Map<string, { userId: string; date: Date; githubRepoId: number; repoFullName: string; isPrivate: boolean; count: number }>();
  const perDayBuckets = new Map<string, { userId: string; date: Date; morningCount: number; eveningCount: number; totalCount: number }>();

  for (const r of rows) {
    const { isoDay, hour } = toLocalParts(r.occurredAt, tz);
    // Filter here too (occuredAt can be older than cutoff if window overlaps)
    const occurred = new Date(r.occurredAt);
    if (occurred < registrationCutoff) continue;
    const key1 = `${isoDay}|${r.repoId}`;
    const dateObj = new Date(isoDay + 'T00:00:00Z');
    const current1 = perDayPerRepo.get(key1) || { userId: dbUser.id, date: dateObj, githubRepoId: r.repoId, repoFullName: r.fullName, isPrivate: r.isPrivate, count: 0 };
    current1.count += 1;
    perDayPerRepo.set(key1, current1);

    const key2 = isoDay;
  const current2 = perDayBuckets.get(key2) || { userId: dbUser.id, date: dateObj, morningCount: 0, eveningCount: 0, totalCount: 0 };
  current2.totalCount += 1;
  if (hour >= MORNING_START && hour <= MORNING_END) current2.morningCount += 1;
  if (hour >= EVENING_START && hour <= EVENING_END) current2.eveningCount += 1;
    perDayBuckets.set(key2, current2);
  }

  // Upsert RepoDailyContribution in batches
  const repoRows = Array.from(perDayPerRepo.values());
  const timeRows = Array.from(perDayBuckets.values());
  if (repoRows.length) {
    const CHUNK = 1000;
    for (let i=0; i<repoRows.length; i+=CHUNK) {
      const slice = repoRows.slice(i, i+CHUNK);
      await (prisma as any).repoDailyContribution.createMany({ data: slice, skipDuplicates: true });
    }
  }
  if (timeRows.length) {
    const CHUNK = 1000;
    for (let i=0; i<timeRows.length; i+=CHUNK) {
      const slice = timeRows.slice(i, i+CHUNK);
      await (prisma as any).contributionTimeBucket.createMany({ data: slice, skipDuplicates: true });
    }
  }
  // Update lastActiveDate and aggregatesLastSyncedAt for UX/staleness
  await (prisma as any).user.update({ where: { id: dbUser.id }, data: { lastActiveDate: new Date(), aggregatesLastSyncedAt: new Date() } });
  return repoRows.length + timeRows.length;
}

// Cached helpers for UI/next-up hints
export async function getMonthAggregateMetricsCached(userId: string, registrationCutoff: Date) {
  const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const key = ['agg', 'month', userId, monthStart.toISOString().slice(0,10)];
  const cached = unstable_cache(async () => {
    const contrib = await prisma.contribution.findMany({ where: { userId, AND: [{ date: { gte: monthStart } }, { date: { gte: registrationCutoff } }] }, select: { count: true } });
    const totalContrib = contrib.reduce((s,c)=> s + c.count, 0);
    const monthRepoRows = await (prisma as any).repoDailyContribution.findMany({ where: { userId, AND: [{ date: { gte: monthStart } }, { date: { gte: registrationCutoff } }] }, select: { githubRepoId: true } });
    const distinctRepos = new Set((monthRepoRows as any[]).map((r: any) => r.githubRepoId)).size;
    const monthPublicRows = await (prisma as any).repoDailyContribution.findMany({ where: { userId, AND: [{ date: { gte: monthStart } }, { date: { gte: registrationCutoff } }], isPrivate: false }, select: { count: true } });
    const publicContrib = (monthPublicRows as any[]).reduce((s: number, r: any)=> s + (r.count||0), 0);
    return { totalContrib, distinctRepos, publicContrib };
  }, key, { revalidate: 120, tags: ['agg', `agg:${userId}`] });
  return cached();
}

export async function getWeekTimeBucketProgressCached(userId: string, registrationCutoff: Date) {
  const seven = new Date(); seven.setDate(seven.getDate()-7);
  const key = ['agg', 'time7', userId];
  const cached = unstable_cache(async () => {
    const rows = await (prisma as any).contributionTimeBucket.findMany({ where: { userId, AND: [{ date: { gte: seven } }, { date: { gte: registrationCutoff } }] }, select: { morningCount: true, eveningCount: true } });
    const morningDays = (rows as any[]).filter((r:any)=> r.morningCount > 0).length;
    const eveningDays = (rows as any[]).filter((r:any)=> r.eveningCount > 0).length;
    return { morningDays, eveningDays };
  }, key, { revalidate: 120, tags: ['agg', `agg:${userId}`] });
  return cached();
}

export async function getFourWeekProgressCached(userId: string, registrationCutoff: Date) {
  const past60 = new Date(); past60.setDate(past60.getDate()-60);
  const key = ['agg', 'week4', userId];
  const cached = unstable_cache(async () => {
    const rows = await prisma.contribution.findMany({ where: { userId, AND: [{ date: { gte: past60 } }, { date: { gte: registrationCutoff } }] }, select: { date: true } });
    const weekActive = new Map<string, Set<string>>();
    for (const r of rows) {
      const d = r.date;
      const jan4 = new Date(Date.UTC(d.getUTCFullYear(),0,4));
      const dayOfYear = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(),0,1))/86400000)+1;
      const week = Math.ceil((dayOfYear + jan4.getUTCDay()+1)/7);
      const weekKey = `${d.getUTCFullYear()}-${String(week).padStart(2,'0')}`;
      const set = weekActive.get(weekKey) || new Set<string>();
      set.add(d.toISOString().slice(0,10));
      weekActive.set(weekKey,set);
    }
    const sortedWeeks = Array.from(weekActive.keys()).sort();
    let consec = 0; let prevNum: number | null = null; let prevYear: number | null = null; let maxConsec = 0;
    for (const wk of sortedWeeks) {
      const [y, wStr] = wk.split('-');
      const w = Number(wStr); const yNum = Number(y);
      const activeDaysCount = weekActive.get(wk)!.size;
      if (activeDaysCount < 2) { consec=0; prevNum=null; prevYear=null; continue; }
      if (prevNum === null || prevYear === null) { consec=1; prevNum=w; prevYear=yNum; }
      else {
        const sequential = (yNum === prevYear && w === prevNum + 1) || (yNum === prevYear + 1 && prevNum === 52 && w === 1);
        consec = sequential ? consec + 1 : 1;
        prevNum = w; prevYear = yNum;
      }
      if (consec > maxConsec) maxConsec = consec;
    }
    return { qualifyingWeeks: maxConsec };
  }, key, { revalidate: 120, tags: ['agg', `agg:${userId}`] });
  return cached();
}
