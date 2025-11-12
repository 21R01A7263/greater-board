import prisma from '@/lib/prisma';
import { unstable_cache, revalidateTag } from 'next/cache';
import type { LeaderboardPeriod } from './scoring';

function dayStartUTC(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function addDaysUTC(d: Date, n: number) { const t = new Date(d.getTime()); t.setUTCDate(t.getUTCDate() + n); return t; }

function windowFor(period: LeaderboardPeriod) {
  const today = dayStartUTC(new Date());
  if (period === 'weekly') return { from: addDaysUTC(today, -6), to: today };
  return { from: addDaysUTC(today, -29), to: today };
}

export async function buildLeaderboardSnapshot(period: LeaderboardPeriod) {
  const { from, to } = windowFor(period);
  // Sum net scores per user in the window
  const rows = await ((prisma as any).userDailyScore).groupBy({
    by: ['userId'],
    where: { date: { gte: from, lte: to } },
    _sum: { net: true },
  });
  const items = (rows as any[])
    .map((r: any) => ({ userId: r.userId as string, score: (r._sum?.net ?? 0) as number }))
    .sort((a, b) => b.score - a.score);
  // Rank
  let rank = 0; let prevScore: number | null = null; let sameRankCount = 0;
  const ranked = items.map((it) => {
    if (prevScore === null || it.score !== prevScore) { rank = rank + 1 + sameRankCount; sameRankCount = 0; prevScore = it.score; }
    else { sameRankCount += 1; }
    return { ...it, rank };
  });
  const snapshot = await ((prisma as any).leaderboardSnapshot).create({
    data: { period, referenceDate: to, data: ranked },
  });
  try { (revalidateTag as any)(`leaderboard:${period}`, 'max'); } catch {}
  return { id: snapshot.id, period, count: ranked.length, referenceDate: to };
}

export async function getLeaderboard(period: LeaderboardPeriod, page = 1, pageSize = 50) {
  const cached = unstable_cache(async () => {
    const latest = await ((prisma as any).leaderboardSnapshot).findFirst({
      where: { period },
      orderBy: { generatedAt: 'desc' },
      select: { data: true, referenceDate: true, generatedAt: true },
    });
    const data = (latest?.data as any[]) || [];
    return { data, referenceDate: latest?.referenceDate ?? null, generatedAt: latest?.generatedAt ?? null };
  }, ['leaderboard', period], { revalidate: 120, tags: [`leaderboard:${period}`] });
  const all = await cached();
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return { period, total: all.data.length, page, pageSize, referenceDate: all.referenceDate, rows: all.data.slice(start, end) };
}

// Active leaderboard: all users with at least 1 commit in the last 30 days,
// ranked by their current rolling score (UserScore.current). Cached briefly.
export async function getActiveLeaderboard(page = 1, pageSize = 50) {
  const cached = unstable_cache(async () => {
    const today = dayStartUTC(new Date());
    const since30 = addDaysUTC(today, -29);
    // Candidate users from Contribution
    const contribUsers = await prisma.contribution.findMany({
      where: { date: { gte: since30 }, count: { gt: 0 } },
      select: { userId: true },
      distinct: ['userId'],
    });
    // Candidate users from RepoDailyContribution (in case Contribution isn't populated)
    const repoDailyUsers = await (prisma as any).repoDailyContribution.findMany({
      where: { date: { gte: since30 }, count: { gt: 0 } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const idSet = new Set<string>();
    contribUsers.forEach(u => idSet.add(u.userId));
    (repoDailyUsers as any[]).forEach((u: any) => idSet.add(u.userId));
    const ids = Array.from(idSet.values());
    if (!ids.length) return { total: 0, rows: [] as Array<{ userId: string; score: number }> };

    // Fetch scores; fallback to baseline 700 if not present
    const scores = await ((prisma as any).userScore).findMany({
      where: { userId: { in: ids } },
      select: { userId: true, current: true },
    }).catch(() => [] as any[]);
    const scoreById = new Map<string, number>((scores as any[]).map((s: any) => [s.userId as string, (s.current as number) ?? 700]));
    const items = ids.map(userId => ({ userId, score: scoreById.get(userId) ?? 700 }));
    items.sort((a, b) => b.score - a.score);
    // Rank with ties sharing the same rank value
    let rank = 0; let prev: number | null = null; let sameCount = 0;
    const ranked = items.map((it) => {
      if (prev === null || it.score !== prev) { rank = rank + 1 + sameCount; sameCount = 0; prev = it.score; }
      else { sameCount += 1; }
      return { ...it, rank };
    });
    return { total: ranked.length, rows: ranked };
  }, ['leaderboard', 'active'], { revalidate: 120, tags: ['leaderboard:active'] });

  const all = await cached();
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return { total: all.total, page, pageSize, rows: all.rows.slice(start, end) };
}
