import { NextResponse } from 'next/server';
import { buildLeaderboardSnapshot } from '@/lib/leaderboard';

export const runtime = 'nodejs';
export const revalidate = 0;

// GET /api/cron/leaderboard-snapshots?secret=...
// Rebuilds weekly and monthly leaderboard snapshots. Designed for Vercel Cron (GET only).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const configuredSecret = process.env.CRON_SECRET;
  const provided = url.searchParams.get('secret') || req.headers.get('x-cron-secret') || req.headers.get('authorization');
  if (configuredSecret) {
    if (!provided || !provided.endsWith(configuredSecret)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const weekly = await buildLeaderboardSnapshot('weekly');
    const monthly = await buildLeaderboardSnapshot('monthly');
    return NextResponse.json({ ok: true, weekly, monthly });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed to build snapshots' }, { status: 500 });
  }
}
