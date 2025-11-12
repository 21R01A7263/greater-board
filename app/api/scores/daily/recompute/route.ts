import { NextResponse } from 'next/server';
import { recomputeDailyScores } from '@/lib/scoring';

export const runtime = 'nodejs';
export const revalidate = 0;

// POST /api/scores/daily/recompute?date=YYYY-MM-DD (admin/cron)
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get('authorization') || req.headers.get('x-cron-secret');
  if (!secret || !authz || !authz.endsWith(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || undefined;
  const res = await recomputeDailyScores(date);
  return NextResponse.json({ ok: true, ...res });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: 'POST to trigger recompute. Optional ?date=YYYY-MM-DD' });
}