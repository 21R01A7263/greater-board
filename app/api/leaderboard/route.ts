import { NextResponse } from 'next/server';
import { buildLeaderboardSnapshot, getLeaderboard, getActiveLeaderboard } from '@/lib/leaderboard';

export const revalidate = 0;
export const runtime = 'nodejs';

// GET /api/leaderboard?period=weekly|monthly&page=1&pageSize=50
export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = url.searchParams.get('period');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = clampPageSize(parseInt(url.searchParams.get('pageSize') || '50', 10));
  if (!period || period === 'active') {
    const data = await getActiveLeaderboard(page, pageSize);
    return NextResponse.json({ ok: true, period: 'active', ...data });
  }
  const data = await getLeaderboard((period as 'weekly' | 'monthly'), page, pageSize);
  return NextResponse.json({ ok: true, ...data });
}

// POST /api/leaderboard/rebuild?period=weekly|monthly (cron)
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get('authorization') || req.headers.get('x-cron-secret');
  if (!secret || !authz || !authz.endsWith(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const period = url.searchParams.get('period');
  if (!period || period === 'active') {
    // No snapshot build needed for active leaderboard; it is dynamic with cache
    return NextResponse.json({ ok: true, note: 'active leaderboard is dynamic; no snapshot created' });
  }
  const res = await buildLeaderboardSnapshot(period as 'weekly' | 'monthly');
  return NextResponse.json({ ok: true, snapshot: res });
}

function clampPageSize(n: number) { if (!Number.isFinite(n) || n <= 0) return 50; return Math.min(200, n); }
