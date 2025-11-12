import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { evaluateAndAwardAchievements, getUserAchievementsCached } from '@/lib/achievements';
import { syncRepoDailyAggregates } from '@/lib/contrib-aggregate';

export const revalidate = 0; // dynamic

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ensure DB user exists and fetch createdAt (registration cutoff)
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const email = (user?.emailAddresses?.[0]?.emailAddress as string | undefined) || '';
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || (user?.username as string | undefined) || 'Unknown User';
  const avatarURL = (user?.imageUrl as string | undefined) || undefined;
  let dbUser = await prisma.user.findFirst({ where: { OR: [{ id: userId }, { clerkUserId: userId } ] } });
  if (!dbUser && email) {
    dbUser = await prisma.user.create({ data: { email, name, avatarURL, githubUsername: user?.username || '', clerkUserId: userId } });
  }
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const registrationCutoff = dbUser.createdAt;
  try {
    // Precompute aggregates for advanced achievements (repo diversity, time buckets)
    await syncRepoDailyAggregates(userId, registrationCutoff);
    await evaluateAndAwardAchievements(dbUser.id, registrationCutoff);
  } catch (e) {
    console.error('Achievement evaluation failed', e);
  }

  const achievements = await getUserAchievementsCached(dbUser.id);
  // Types may be stale until migration is applied; cast to any for selecting newly added fields
  const streakRow = await (prisma as any).user.findUnique({ where: { id: dbUser.id }, select: { currentStreak: true, longestStreak: true } });
  const { currentStreak = 0, longestStreak = 0 } = streakRow || {};

  return NextResponse.json({ achievements, currentStreak, longestStreak });
}
