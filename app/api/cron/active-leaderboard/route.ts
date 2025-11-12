import { NextResponse } from 'next/server';
import { recomputeDailyScores } from '@/lib/scoring';
import { getActiveLeaderboard } from '@/lib/leaderboard';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { syncRepoDailyAggregates } from '@/lib/contrib-aggregate';

export const runtime = 'nodejs';
export const revalidate = 0;

function dayStartUTC(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function toISODate(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET(req: Request) {
  const url = new URL(req.url);
  const configuredSecret = process.env.CRON_SECRET;
  const provided = url.searchParams.get('secret') || req.headers.get('x-cron-secret') || req.headers.get('authorization');
  if (configuredSecret) {
    if (!provided || !provided.endsWith(configuredSecret)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  // Optional limit for aggregate sync to avoid heavy runs; default 200
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') || '200', 10)));
  // Sync aggregates for users whose aggregates are stale (>2 minutes) so scoring has up-to-date commit totals
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 2 * 60 * 1000);
  const candidates = await prisma.user.findMany({
    where: { clerkUserId: { not: null }, OR: [ { aggregatesLastSyncedAt: null }, { aggregatesLastSyncedAt: { lt: staleCutoff } } ] },
    select: { id: true, clerkUserId: true, createdAt: true },
    take: limit,
    orderBy: { aggregatesLastSyncedAt: 'asc' },
  });
  let aggregatesSynced = 0;
  for (const u of candidates) {
    try {
      if (!u.clerkUserId) continue;
      const res = await syncRepoDailyAggregates(u.clerkUserId, u.createdAt);
      if (res > 0) aggregatesSynced += 1;
    } catch {}
  }
  const todayISO = toISODate(dayStartUTC(new Date()));
  const recompute = await recomputeDailyScores(todayISO);
  // Invalidate and warm active leaderboard cache
  try { (revalidateTag as any)('leaderboard:active', 'max'); } catch {}
  const warmed = await getActiveLeaderboard(1, 50);
  return NextResponse.json({ ok: true, aggregates: { considered: candidates.length, synced: aggregatesSynced }, recompute, warmed: { total: warmed.total, page: warmed.page, pageSize: warmed.pageSize } });
}
