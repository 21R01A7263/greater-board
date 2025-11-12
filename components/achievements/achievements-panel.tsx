import { auth, clerkClient } from '@clerk/nextjs/server';
import { evaluateAndAwardAchievements, getUserAchievementsCached, ACH_KEYS } from '@/lib/achievements';
import AchievementsClient from './achievements-client';
import { syncRepoDailyAggregates, getMonthAggregateMetricsCached, getWeekTimeBucketProgressCached, getFourWeekProgressCached } from '@/lib/contrib-aggregate';
import prisma from '@/lib/prisma';

export const revalidate = 300;

export default async function AchievementsPanel() {
  const { userId } = await auth();
  if (!userId) return null;

  // Ensure DB user
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const email = (user?.emailAddresses?.[0]?.emailAddress as string | undefined) || '';
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || (user?.username as string | undefined) || 'Unknown User';
  const avatarURL = (user?.imageUrl as string | undefined) || undefined;
  let dbUser = await prisma.user.findFirst({ where: { OR: [{ id: userId }, { clerkUserId: userId }] } });
  if (!dbUser && email) {
    dbUser = await prisma.user.create({ data: { email, name, avatarURL, githubUsername: user?.username || '', clerkUserId: userId } });
  }
  if (!dbUser) return null;

  const registrationCutoff = dbUser.createdAt;
  // Precompute aggregates and then evaluate and award (best-effort; ignore errors)
  try {
    await syncRepoDailyAggregates(userId, registrationCutoff);
    await evaluateAndAwardAchievements(dbUser.id, registrationCutoff);
  } catch (e) {
    console.error('Achievements evaluation failed', e);
  }

  const achievements = await getUserAchievementsCached(dbUser.id);
  const streakRow = await (prisma as any).user.findUnique({ where: { id: dbUser.id }, select: { currentStreak: true, longestStreak: true } });
  const currentStreak: number = streakRow?.currentStreak ?? 0;
  const longestStreak: number = streakRow?.longestStreak ?? 0;

  // Derive Next Up using cached aggregates
  const monthMetrics = await getMonthAggregateMetricsCached(dbUser.id, registrationCutoff);
  const weekBuckets = await getWeekTimeBucketProgressCached(dbUser.id, registrationCutoff);
  const fourWeek = await getFourWeekProgressCached(dbUser.id, registrationCutoff);

  // Build a Set of earned keys to filter hints
  const earnedKeys = new Set(achievements.map(a => a.key));

  type Hint = { title: string; hint: string };
  const hints: Hint[] = [];

  // Helper to conditionally push hints when not earned
  const pushIfNotEarned = (key: string, title: string, progress: string) => {
    if (!earnedKeys.has(key)) hints.push({ title, hint: progress });
  };

  // Streak tiers: show only the next unearned tier
  const streakTiers: Array<{ key: string; title: string; threshold: number }> = [
    { key: ACH_KEYS.STREAK_3, title: 'On a Roll I', threshold: 3 },
    { key: ACH_KEYS.STREAK_7, title: 'On a Roll II', threshold: 7 },
    { key: ACH_KEYS.STREAK_14, title: 'On a Roll III', threshold: 14 },
    { key: ACH_KEYS.STREAK_30, title: 'On a Roll IV', threshold: 30 },
    { key: ACH_KEYS.STREAK_100, title: 'On a Roll V', threshold: 100 },
  ];
  const nextStreakTier = streakTiers.find(t => !earnedKeys.has(t.key));
  if (nextStreakTier && currentStreak < nextStreakTier.threshold) {
    pushIfNotEarned(nextStreakTier.key, nextStreakTier.title, `${Math.min(currentStreak, nextStreakTier.threshold)}/${nextStreakTier.threshold} day streak`);
  }

  // Time-of-day weekly goals
  pushIfNotEarned(ACH_KEYS.EARLY_BIRD, 'Early Bird', `${Math.min(3, weekBuckets.morningDays)}/3 morning days this week`);
  pushIfNotEarned(ACH_KEYS.NIGHT_OWL, 'Night Owl', `${Math.min(3, weekBuckets.eveningDays)}/3 evening days this week`);

  // Monthly goals
  pushIfNotEarned(ACH_KEYS.EXPLORER_3_REPOS, 'Explorer', `${Math.min(3, monthMetrics.distinctRepos)}/3 repos this month`);
  pushIfNotEarned(ACH_KEYS.PUBLIC_SERVANT_20, 'Public Servant', `${Math.min(20, monthMetrics.publicContrib)}/20 public repo contributions this month`);
  pushIfNotEarned(ACH_KEYS.MONTHLY_MAKER_100, 'Monthly Maker', `${Math.min(100, monthMetrics.totalContrib)}/100 contributions this month`);

  // Four-Week Finisher
  pushIfNotEarned(ACH_KEYS.FOUR_WEEK_FINISHER, 'Four-Week Finisher', `${Math.min(4, fourWeek.qualifyingWeeks)}/4 consecutive qualifying weeks`);

  // Year milestones: cascade to next unattained threshold
  const yearMilestones: Array<{ key: string; title: string; threshold: number }> = [
    { key: ACH_KEYS.YEAR_300, title: 'Year-in-Review 300', threshold: 300 },
    { key: ACH_KEYS.YEAR_500, title: 'Year-in-Review 500', threshold: 500 },
    { key: ACH_KEYS.YEAR_1000, title: 'Year-in-Review 1000', threshold: 1000 },
  ];
  const nextYear = yearMilestones.find(m => !earnedKeys.has(m.key));
  // We don't compute the current year total here to avoid heavy queries; hints for yearly are omitted by design.
  // If desired later: fetch cached year total and show only for the next unattained milestone.

  const nextUp = hints;

  // Build progress map for modal
  // Additional lightweight aggregates for progress
  const since30 = new Date(); since30.setDate(since30.getDate()-30);
  const contrib30 = await prisma.contribution.findMany({ where: { userId: dbUser.id, AND: [{ date: { gte: since30 } }, { date: { gte: registrationCutoff } }] }, select: { date: true, count: true } });
  const activeDays30 = new Set(contrib30.map(c=> c.date.toISOString().slice(0,10))).size;
  const allContrib = await prisma.contribution.findMany({ where: { userId: dbUser.id, date: { gte: registrationCutoff } }, select: { date: true, count: true } });
  const byDay = new Map<string, number>();
  for (const r of allContrib){ const iso=r.date.toISOString().slice(0,10); byDay.set(iso, (byDay.get(iso)||0)+r.count); }
  const lifetimeActiveDays = byDay.size;
  const bestDay = Array.from(byDay.values()).reduce((m,v)=> Math.max(m,v), 0);

  // Weekend status (this week)
  const weekStart = new Date(); weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay()); // Sunday
  const weekContrib = await prisma.contribution.findMany({ where: { userId: dbUser.id, AND: [{ date: { gte: weekStart } }, { date: { gte: registrationCutoff } }] }, select: { date: true } });
  const hasSat = weekContrib.some(c=> c.date.getUTCDay()===6);
  const hasSun = weekContrib.some(c=> c.date.getUTCDay()===0);

  // Monday momentum (consecutive Mondays in recent window)
  const past90 = new Date(); past90.setDate(past90.getDate()-90);
  const mondayRows = await prisma.contribution.findMany({ where: { userId: dbUser.id, AND: [{ date: { gte: past90 } }, { date: { gte: registrationCutoff } }] }, select: { date: true } });
  const mondayDates = mondayRows.filter(r=> r.date.getUTCDay()===1).map(r=> r.date).sort((a,b)=> a.getTime()-b.getTime());
  let mondayConsec = 0; let last: Date|undefined;
  for (const d of mondayDates){ if (!last){ mondayConsec=1; last=d; continue;} const diff=(d.getTime()-last.getTime())/86400000; if (diff===7){ mondayConsec+=1; last=d; } else if (diff>7){ mondayConsec=1; last=d; } }

  // Year total
  const now = new Date();
  const yearStart = new Date(now.getFullYear(),0,1);
  const yearRows = await prisma.contribution.findMany({ where: { userId: dbUser.id, AND: [{ date: { gte: yearStart } }, { date: { gte: registrationCutoff } }] }, select: { count: true } });
  const yearTotal = yearRows.reduce((s,c)=> s+c.count, 0);

  // Loyal contributor (max weeks for a repo in current quarter)
  const quarterStartMonth = Math.floor(now.getMonth()/3)*3;
  const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1);
  const quarterRepoRows = await (prisma as any).repoDailyContribution.findMany({ where: { userId: dbUser.id, AND: [{ date: { gte: quarterStart } }, { date: { gte: registrationCutoff } }] }, select: { date: true, githubRepoId: true } });
  const repoWeeks = new Map<string, Set<string>>();
  for (const r of quarterRepoRows){ const d=r.date; const jan4=new Date(Date.UTC(d.getUTCFullYear(),0,4)); const dayOfYear=Math.floor((d.getTime()-Date.UTC(d.getUTCFullYear(),0,1))/86400000)+1; const week=Math.ceil((dayOfYear + jan4.getUTCDay()+1)/7); const key=`${d.getUTCFullYear()}-${String(week).padStart(2,'0')}`; const set=repoWeeks.get(r.githubRepoId)||new Set<string>(); set.add(key); repoWeeks.set(r.githubRepoId,set); }
  const loyalWeeksMax = Math.max(0, ...Array.from(repoWeeks.values()).map(s=> s.size));

  const progressByKey: Record<string, string> = {
    [ACH_KEYS.STREAK_3]: `${Math.min(currentStreak,3)}/3 day streak`,
    [ACH_KEYS.STREAK_7]: `${Math.min(currentStreak,7)}/7 day streak`,
    [ACH_KEYS.STREAK_14]: `${Math.min(currentStreak,14)}/14 day streak`,
    [ACH_KEYS.STREAK_30]: `${Math.min(currentStreak,30)}/30 day streak`,
    [ACH_KEYS.STREAK_100]: `${Math.min(currentStreak,100)}/100 day streak`,
    [ACH_KEYS.EARLY_BIRD]: `${Math.min(3, weekBuckets.morningDays)}/3 morning days this week`,
    [ACH_KEYS.NIGHT_OWL]: `${Math.min(3, weekBuckets.eveningDays)}/3 evening days this week`,
    [ACH_KEYS.EXPLORER_3_REPOS]: `${Math.min(3, monthMetrics.distinctRepos)}/3 repos this month`,
    [ACH_KEYS.PUBLIC_SERVANT_20]: `${Math.min(20, monthMetrics.publicContrib)}/20 public contributions this month`,
    [ACH_KEYS.MONTHLY_MAKER_100]: `${Math.min(100, monthMetrics.totalContrib)}/100 contributions this month`,
    [ACH_KEYS.FOUR_WEEK_FINISHER]: `${Math.min(4, fourWeek.qualifyingWeeks)}/4 qualifying weeks`,
    [ACH_KEYS.CONSISTENCY_20_IN_30]: `${Math.min(20, activeDays30)}/20 active days in last 30`,
    [ACH_KEYS.FIRST_STEPS]: `${Math.min(1, lifetimeActiveDays)}/1 contributing day`,
    [ACH_KEYS.HITTING_STRIDE]: `${Math.min(10, lifetimeActiveDays)}/10 contributing days`,
    [ACH_KEYS.MARATHONER]: `${Math.min(100, lifetimeActiveDays)}/100 contributing days`,
    [ACH_KEYS.PEAK_DAY_25]: `${Math.min(25, bestDay)}/25 best day`,
    [ACH_KEYS.WEEKEND_WARRIOR]: `${hasSat ? 'Sat✓' : 'Sat—'}, ${hasSun ? 'Sun✓' : 'Sun—'}`,
    [ACH_KEYS.MONDAY_MOMENTUM]: `${Math.min(4, mondayConsec)}/4 consecutive Mondays`,
    [ACH_KEYS.YEAR_300]: `${Math.min(300, yearTotal)}/300 this year`,
    [ACH_KEYS.YEAR_500]: `${Math.min(500, yearTotal)}/500 this year`,
    [ACH_KEYS.YEAR_1000]: `${Math.min(1000, yearTotal)}/1000 this year`,
    [ACH_KEYS.LOYAL_CONTRIBUTOR]: `${Math.min(8, loyalWeeksMax)}/8 weeks same repo this quarter`,
  } as Record<string,string>;

  // Fetch catalog to show all achievements including unearned
  const catalog = await (prisma as any).achievement.findMany({ select: { key: true, name: true, description: true, category: true, tier: true } });

  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="bg-white dark:bg-background dark:border-2 dark:border-gray-600 p-6 rounded-2xl shadow border border-white/20 mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Achievements</h2>
          <AchievementsClient
            achievements={achievements}
            nextUp={nextUp}
            catalog={catalog}
            progressByKey={progressByKey}
            currentStreak={currentStreak}
            longestStreak={longestStreak}
          />
        </div>
        {/* Next Up */}
        {nextUp.length > 0 && (
          <div className="mb-4 p-3 rounded-lg border dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
            <p className="text-sm font-semibold mb-1">Next up</p>
            <ul className="text-sm list-disc pl-5 text-muted-foreground">
              {nextUp.slice(0,3).map((n, i) => (
                <li key={i}><span className="font-medium text-foreground">{n.title}</span>: {n.hint}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Earned badges grid (kept minimal; full list in modal) */}
        <div className="grid grid-cols-2 gap-3">
          {achievements.slice(0,6).map((a) => (
            <div key={a.key} className="p-3 rounded-md border dark:border-gray-600 bg-white/60 dark:bg-gray-700">
              <p className="text-sm font-semibold">{a.name}</p>
              <p className="text-xs text-muted-foreground">{a.description}</p>
            </div>
          ))}
          {achievements.length === 0 && (
            <p className="text-sm text-muted-foreground">No achievements yet. Keep contributing!</p>
          )}
        </div>
      </div>
    </div>
  );
}
