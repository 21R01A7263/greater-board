import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { revalidateTag } from 'next/cache';

// Explicit endpoint to revalidate commit cache after background sync or manual trigger.
// POST only. Requires authenticated user. Returns status of revalidation.
export async function POST() {
  const user = await currentUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
  // Use "max" profile to force immediate invalidate per Next.js guidance.
  revalidateTag(`commits:user:${userId}`, 'max');
    return NextResponse.json({ ok: true, tag: `commits:user:${userId}` });
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to revalidate', details: e?.message }, { status: 500 });
  }
}
