import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { revalidateTag } from 'next/cache';

// POST /api/contributions/revalidate
// Invalidates the contribution calendar cache for the current user so today's cell can refresh immediately
export async function POST() {
  const user = await currentUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    revalidateTag('contrib-calendar', 'max');
    revalidateTag(`contrib:${userId}`, 'max');
    return NextResponse.json({ ok: true, tags: ['contrib-calendar', `contrib:${userId}`] });
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to revalidate', details: e?.message }, { status: 500 });
  }
}
