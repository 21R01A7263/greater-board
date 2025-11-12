import { NextResponse } from 'next/server';
import { purgeOldCommits } from '@/lib/github-commits';
// Use dynamic import for revalidateTag to avoid type variance across Next versions

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret') || request.headers.get('authorization');
  if (!configuredSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 501 });
  }
  if (!provided || !provided.endsWith(configuredSecret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const days = (() => {
    const raw = process.env.COMMIT_RETENTION_DAYS;
    const d = raw ? parseInt(raw, 10) : 30;
    return Number.isFinite(d) && d > 0 ? d : 30;
  })();

  try {
    const count = await purgeOldCommits(days);
    // Commits changed globally; invalidate generic tag to be safe
    try {
      const cache = await import('next/cache');
      (cache as any).revalidateTag?.('commits');
    } catch {}
    return NextResponse.json({ ok: true, deleted: count, days });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Use POST to trigger purge' });
}
