import { auth, clerkClient } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getMyScoreAggregates } from '@/lib/scoring';

export const revalidate = 0;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Resolve DB user (id may be primary or clerk id)
  let dbUser = await prisma.user.findFirst({ where: { OR: [{ id: userId }, { clerkUserId: userId }] }, select: { id: true } });
  if (!dbUser) {
    // Create if missing using Clerk basics
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const email = (u?.emailAddresses?.[0]?.emailAddress as string | undefined) || '';
    const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ') || (u?.username as string | undefined) || 'Unknown User';
    const avatarURL = (u?.imageUrl as string | undefined) || undefined;
    if (email) {
      dbUser = await prisma.user.create({ data: { email, name, avatarURL, githubUsername: u?.username || '', clerkUserId: userId } });
    }
  }
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const agg = await getMyScoreAggregates(dbUser.id);
  return NextResponse.json(agg);
}
