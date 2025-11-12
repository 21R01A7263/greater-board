import prisma from '@/lib/prisma';
import { unstable_cache, revalidateTag } from 'next/cache';

// Utility: clamp a number between min and max
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

// Get the start of day (UTC) for a Date
function dayStartUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Add days (UTC)
function addDaysUTC(d: Date, delta: number) {
  const t = new Date(d.getTime());
  t.setUTCDate(t.getUTCDate() + delta);
  return t;
}

// Return YYYY-MM-DD string (UTC)
function toISODate(d: Date) { return d.toISOString().slice(0, 10); }

// Determine users who should be scored for a given date (UTC day)
async function getCandidateUserIdsForDate(day: Date): Promise<string[]> {
  const usersFromContrib = await prisma.contribution.findMany({ where: { date: day }, select: { userId: true } });
  const usersFromRepoDaily = await (prisma as any).repoDailyContribution.findMany({ where: { date: day }, select: { userId: true } });
  const set = new Set<string>();
  usersFromContrib.forEach(u => set.add(u.userId));
  (usersFromRepoDaily as any[]).forEach((u: any) => set.add(u.userId));
  // Also include users who have a score row but may have no activity (for decay checks)
  const scoreUsers = await ((prisma as any).userScore).findMany({ select: { userId: true } }).catch(() => []);
  (scoreUsers as any[]).forEach((u: any) => set.add(u.userId));
  return Array.from(set);
}

async function getRegistrationCutoff(userId: string): Promise<Date | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  return u?.createdAt ?? null;
}

async function getStreakEndingOn(userId: string, day: Date, registrationCutoff: Date): Promise<number> {
  // Fetch up to last 60 days of contributions ending at `day`
  const since = addDaysUTC(day, -59);
  const from = since < registrationCutoff ? registrationCutoff : since;
  const rows = await prisma.contribution.findMany({
    where: { userId, date: { gte: from, lte: day } },
    select: { date: true, count: true },
    orderBy: { date: 'asc' },
  });
  if (!rows.length) return 0;
  const byDay = new Set(rows.filter(r => r.count > 0).map(r => toISODate(r.date)));
  let streak = 0;
  // Walk backward from `day` until a gap is found
  for (let i = 0; i < 60; i++) {
    const d = addDaysUTC(day, -i);
    const iso = toISODate(d);
    if (d < registrationCutoff) break;
    if (byDay.has(iso)) streak += 1; else break;
  }
  return streak;
}

// Compute daily score for a single user and date (UTC day start)
export async function computeDailyScoreForUser(userId: string, day: Date) {
  const registrationCutoff = await getRegistrationCutoff(userId);
  if (!registrationCutoff) return null;
  if (day < dayStartUTC(registrationCutoff)) return null; // respect mandatory rule

  // Prefer day-level aggregates populated during sync; fall back to repo daily totals
  const agg = await ((prisma as any).userDayCommitAggregate).findUnique({ where: { userId_date: { userId, date: day } } }).catch(() => null);
  // Aggregate commit count via aggregate total, else RepoDailyContribution
  let commitsCount = 0;
  if (agg && typeof agg.total === 'number') {
    commitsCount = agg.total as number;
  } else {
    const repoRows = await (prisma as any).repoDailyContribution.findMany({ where: { userId, date: day }, select: { count: true } });
    commitsCount = (repoRows as any[]).reduce((s: number, r: any) => s + (r.count || 0), 0);
  }

  // Base gains
  let gain = 0;
  const breakdown: any = { rules: [] };
  if (commitsCount >= 1) { gain += 2; breakdown.rules.push({ key: 'daily_presence', value: +2 }); }
  if (commitsCount >= 5) { gain += 1; breakdown.rules.push({ key: 'volume_bonus_5', value: +1 }); }

  // Streak bonus (+1 if streak >= 3)
  const streakLen = await getStreakEndingOn(userId, day, registrationCutoff);
  breakdown.streakLength = streakLen;
  if (streakLen >= 3) { gain += 1; breakdown.rules.push({ key: 'streak_bonus', value: +1 }); }

  // Penalties
  let loss = 0;
  // Use aggregate signals if available
  if (agg) {
    const shortMsgs = Math.max(0, (agg as any).shortMsgs || 0);
    if (shortMsgs) { loss += 2 * shortMsgs; breakdown.rules.push({ key: 'short_msgs', count: shortMsgs, value: -2 * shortMsgs }); }
    const total = Math.max(0, (agg as any).total || 0);
    const uniqueMessages = Math.max(0, (agg as any).uniqueMessages || 0);
    const duplicates = Math.max(0, total - uniqueMessages);
    const repeatPenalty = Math.max(0, duplicates - 2) * 2;
    if (repeatPenalty) { loss += repeatPenalty; breakdown.rules.push({ key: 'repeat_msgs', value: -repeatPenalty, duplicates }); }
    // Dispersion bonus: ≥3 distinct hours in a day -> +2
    try {
      const hours = Array.isArray((agg as any).hoursJson?.hours) ? (agg as any).hoursJson.hours as number[] : [];
      if (hours.length >= 3) { gain += 2; breakdown.rules.push({ key: 'dispersion_bonus_hours_3+', value: +2, hours: hours.length }); }
    } catch {}
  }

  // Excessive burst penalty (>20 commits in day)
  if (commitsCount > 20) { loss += 10; breakdown.rules.push({ key: 'excessive_burst', value: -10 }); }

  // Daily caps
  gain = clamp(gain, 0, 60);
  loss = clamp(loss, 0, 50);
  const net = clamp(gain - loss, -50, 60);

  // Upsert UserDailyScore
  await (prisma as any).userDailyScore.upsert({
    where: { userId_date: { userId, date: day } },
    update: { gain, loss, net, streakLength: streakLen, breakdown },
    create: { userId, date: day, gain, loss, net, streakLength: streakLen, breakdown },
  });

  // Update rolling UserScore (baseline 700)
  const existing = await ((prisma as any).userScore).findUnique({ where: { userId } }).catch(() => null);
  const current = existing?.current ?? 700;
  const next = Math.max(0, current + net);
  await ((prisma as any).userScore).upsert({
    where: { userId },
    update: { current: next },
    create: { userId, current: next },
  });

  // Touch cache tags so dependent views refresh promptly
  try { (revalidateTag as any)(`score:user:${userId}`, 'max'); } catch {}
  try { (revalidateTag as any)('leaderboard:active', 'max'); } catch {}

  return { userId, gain, loss, net, streakLength: streakLen };
}

// Recompute daily scores for all candidate users for a given ISO date (UTC). Defaults to yesterday.
export async function recomputeDailyScores(isoDate?: string) {
  const today = dayStartUTC(new Date());
  const day = isoDate ? dayStartUTC(new Date(isoDate + 'T00:00:00Z')) : addDaysUTC(today, -1);
  const users = await getCandidateUserIdsForDate(day);
  const results: any[] = [];
  for (const uid of users) {
    const r = await computeDailyScoreForUser(uid, day).catch(() => null);
    if (r) results.push(r);
  }
  return { day: toISODate(day), processed: results.length };
}

export async function getMyScoreAggregates(userId: string) {
  const cached = unstable_cache(async () => {
  const scoreRow = await ((prisma as any).userScore).findUnique({ where: { userId } }).catch(() => null);
    const today = dayStartUTC(new Date());
    const since7 = addDaysUTC(today, -6);
    const since30 = addDaysUTC(today, -29);
    const [rows7, rows30] = await Promise.all([
  ((prisma as any).userDailyScore).findMany({ where: { userId, date: { gte: since7 } }, select: { net: true } }),
  ((prisma as any).userDailyScore).findMany({ where: { userId, date: { gte: since30 } }, select: { net: true } }),
    ]);
    const sum = (arr: any[]) => (arr as any[]).reduce((s: number, r: any) => s + (r.net || 0), 0);
    return { current: scoreRow?.current ?? 700, last7: sum(rows7), last30: sum(rows30) };
  }, ['score-agg', userId], { revalidate: 120, tags: [`score:user:${userId}`] });
  return cached();
}

export type LeaderboardPeriod = 'weekly' | 'monthly';