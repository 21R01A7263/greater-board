import prisma from './prisma';
import { unstable_cache } from 'next/cache';

// Achievement keys (centralized to avoid typos)
export const ACH_KEYS = {
  STREAK_3: 'streak_3',
  STREAK_7: 'streak_7',
  STREAK_14: 'streak_14',
  STREAK_30: 'streak_30',
  STREAK_100: 'streak_100',
  WEEKEND_WARRIOR: 'weekend_warrior',
  EARLY_BIRD: 'early_bird',
  NIGHT_OWL: 'night_owl',
  COMEBACK_KID: 'comeback_kid',
  CONSISTENCY_20_IN_30: 'consistency_20_in_30',
  FIRST_STEPS: 'first_steps',
  HITTING_STRIDE: 'hitting_stride',
  MARATHONER: 'marathoner',
  PEAK_DAY_25: 'peak_day_25',
  MONTHLY_MAKER_100: 'monthly_maker_100',
  FOUR_WEEK_FINISHER: 'four_week_finisher',
  EXPLORER_3_REPOS: 'explorer_3_repos',
  PUBLIC_SERVANT_20: 'public_servant_20',
  LOYAL_CONTRIBUTOR: 'loyal_contributor',
  MONDAY_MOMENTUM: 'monday_momentum',
  YEAR_300: 'year_300',
  YEAR_500: 'year_500',
  YEAR_1000: 'year_1000',
  SEMANTIC_SCHOLAR: 'semantic_scholar',
  LINKED_UP: 'linked_up',
  STORYTELLER: 'storyteller',
  SURGICAL_FIX: 'surgical_fix',
} as const;

export type AchievementKey = typeof ACH_KEYS[keyof typeof ACH_KEYS];

// Ensure catalog seeded once (idempotent)
export async function ensureAchievementCatalog() {
  const catalog: Array<{
    key: AchievementKey; name: string; description?: string; category?: string; tier?: number; icon?: string; hidden?: boolean;
  }> = [
    { key: ACH_KEYS.STREAK_3, name: 'On a Roll I', description: '3-day contribution streak', category: 'streak', tier: 1 },
    { key: ACH_KEYS.STREAK_7, name: 'On a Roll II', description: '7-day contribution streak', category: 'streak', tier: 2 },
    { key: ACH_KEYS.STREAK_14, name: 'On a Roll III', description: '14-day contribution streak', category: 'streak', tier: 3 },
    { key: ACH_KEYS.STREAK_30, name: 'On a Roll IV', description: '30-day contribution streak', category: 'streak', tier: 4 },
    { key: ACH_KEYS.STREAK_100, name: 'On a Roll V', description: '100-day contribution streak', category: 'streak', tier: 5 },
    { key: ACH_KEYS.WEEKEND_WARRIOR, name: 'Weekend Warrior', description: 'Contributed on both Saturday and Sunday', category: 'cadence' },
    { key: ACH_KEYS.EARLY_BIRD, name: 'Early Bird', description: 'Morning contributions (3+ days in a week)', category: 'time' },
    { key: ACH_KEYS.NIGHT_OWL, name: 'Night Owl', description: 'Evening contributions (3+ days in a week)', category: 'time' },
    { key: ACH_KEYS.COMEBACK_KID, name: 'Comeback Kid', description: 'Returned after 14+ days idle', category: 'cadence' },
    { key: ACH_KEYS.CONSISTENCY_20_IN_30, name: 'Consistency Beats Volume', description: '20 contributing days in 30-day window', category: 'cadence' },
    { key: ACH_KEYS.FIRST_STEPS, name: 'First Steps', description: 'First contributing day', category: 'lifetime' },
    { key: ACH_KEYS.HITTING_STRIDE, name: 'Hitting Stride', description: '10 contributing days lifetime', category: 'lifetime' },
    { key: ACH_KEYS.MARATHONER, name: 'Marathoner', description: '100 contributing days lifetime', category: 'lifetime' },
    { key: ACH_KEYS.PEAK_DAY_25, name: 'Peak Day', description: '25+ contributions in a single day', category: 'peak' },
    { key: ACH_KEYS.MONTHLY_MAKER_100, name: 'Monthly Maker', description: '100+ contributions in a calendar month', category: 'month' },
    { key: ACH_KEYS.FOUR_WEEK_FINISHER, name: 'Four-Week Finisher', description: '4 consecutive weeks with 2+ contributing days', category: 'week' },
    { key: ACH_KEYS.EXPLORER_3_REPOS, name: 'Explorer', description: 'Contributions across 3 different repos in a month', category: 'repos' },
    { key: ACH_KEYS.PUBLIC_SERVANT_20, name: 'Public Servant', description: '20+ contributions to public repos in a month', category: 'repos' },
    { key: ACH_KEYS.LOYAL_CONTRIBUTOR, name: 'Loyal Contributor', description: '8 contributing weeks to same repo in a quarter', category: 'repos' },
    { key: ACH_KEYS.MONDAY_MOMENTUM, name: 'Monday Momentum', description: '4 consecutive Mondays with contributions', category: 'cadence' },
    { key: ACH_KEYS.YEAR_300, name: 'Year Milestone 300', description: '300 contributions this year', category: 'year', tier: 1 },
    { key: ACH_KEYS.YEAR_500, name: 'Year Milestone 500', description: '500 contributions this year', category: 'year', tier: 2 },
    { key: ACH_KEYS.YEAR_1000, name: 'Year Milestone 1000', description: '1000 contributions this year', category: 'year', tier: 3 },
    { key: ACH_KEYS.SEMANTIC_SCHOLAR, name: 'Semantic Scholar', description: 'Last commit uses conventional commit prefix', category: 'commit' },
    { key: ACH_KEYS.LINKED_UP, name: 'Linked Up', description: 'Last commit references an issue/PR', category: 'commit' },
    { key: ACH_KEYS.STORYTELLER, name: 'Storyteller', description: 'Last commit message > 100 chars', category: 'commit' },
    { key: ACH_KEYS.SURGICAL_FIX, name: 'Surgical Fix', description: 'Last commit message starts with fix:', category: 'commit' },
  ];
  for (const a of catalog) {
  // Types may be stale until migration is applied; cast to any for safety
  await (prisma as any).achievement.upsert({
      where: { key: a.key },
      update: { name: a.name, description: a.description, category: a.category, tier: a.tier ?? 1, icon: a.icon, isHidden: a.hidden ?? false },
      create: { key: a.key, name: a.name, description: a.description, category: a.category, tier: a.tier ?? 1, icon: a.icon, isHidden: a.hidden ?? false },
    });
  }
}

// Award helper ensures idempotency per (userId, achievementId)
export async function awardAchievement(userId: string, key: AchievementKey, meta?: any) {
  const ach = await (prisma as any).achievement.findUnique({ where: { key } });
  if (!ach) return false;
  const existing = await (prisma as any).userAchievement.findUnique({ where: { userId_achievementId: { userId, achievementId: ach.id } } }).catch(() => null);
  if (existing) return false;
  await (prisma as any).userAchievement.create({ data: { userId, achievementId: ach.id, meta } });
  return true;
}

// Compute streak using contributions since registration and update cached streak fields.
export async function recomputeStreak(userId: string, registrationCutoff: Date) {
  const rows = await prisma.contribution.findMany({ where: { userId, date: { gte: registrationCutoff } }, select: { date: true, count: true }, orderBy: { date: 'asc' } });
  if (!rows.length) {
  await (prisma as any).user.update({ where: { id: userId }, data: { currentStreak: 0 } });
    return { currentStreak: 0, longestStreak: 0 };
  }
  // Normalize dates to YYYY-MM-DD strings
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const iso = r.date.toISOString().slice(0, 10);
    byDay.set(iso, (byDay.get(iso) ?? 0) + r.count);
  }
  const sortedDays = Array.from(byDay.keys()).sort();
  let longest = 0;
  let current = 0;
  let prevDate: Date | null = null;
  const todayISO = new Date().toISOString().slice(0, 10);
  for (const iso of sortedDays) {
    const d = new Date(iso + 'T00:00:00Z');
    if (prevDate) {
      const diff = (d.getTime() - prevDate.getTime()) / 86400000;
      if (diff === 1) {
        current += 1;
      } else if (diff > 1) {
        // streak broken
        longest = Math.max(longest, current);
        current = 1;
      }
    } else {
      current = 1;
    }
    prevDate = d;
  }
  longest = Math.max(longest, current);
  // If today has no contributions yet, streak counts until yesterday if continuous.
  await (prisma as any).user.update({ where: { id: userId }, data: { currentStreak: current, longestStreak: longest } });
  return { currentStreak: current, longestStreak: longest };
}

// Core evaluation entrypoint (minimal initial implementation)
export async function evaluateAndAwardAchievements(userId: string, registrationCutoff: Date) {
  await ensureAchievementCatalog();
  // Fetch user once for timing metadata
  const userRow = await (prisma as any).user.findUnique({ where: { id: userId }, select: { createdAt: true, achievementsLastEvaluatedAt: true } });
  const now = new Date();
  const daysSinceRegistration = Math.floor((now.getTime() - registrationCutoff.getTime()) / 86400000);
  const lastEval = userRow?.achievementsLastEvaluatedAt as Date | undefined;
  const minutesSinceLastEval = lastEval ? (now.getTime() - lastEval.getTime()) / 60000 : Infinity;

  // Evaluation throttling policy:
  // - Always evaluate streak + daily/weekly cadence each call.
  // - Skip expensive monthly/yearly/quarterly queries if:
  //   * daysSinceRegistration < MIN_DAYS_FOR_MONTHLY (default 7)
  //   * or last evaluation run < MIN_MINUTES_BETWEEN_FULL (default 240 minutes) ago.
  const MIN_DAYS_FOR_MONTHLY = parseInt(process.env.ACH_MIN_DAYS_FOR_MONTHLY || '7', 10);
  const MIN_MINUTES_BETWEEN_FULL = parseInt(process.env.ACH_MIN_MINUTES_BETWEEN_FULL || '2', 10); // default 2 minutes
  const allowFull = daysSinceRegistration >= MIN_DAYS_FOR_MONTHLY && minutesSinceLastEval >= MIN_MINUTES_BETWEEN_FULL;
  // Recompute streak
  const { currentStreak, longestStreak } = await recomputeStreak(userId, registrationCutoff);
  // Streak achievements
  if (currentStreak >= 3) await awardAchievement(userId, ACH_KEYS.STREAK_3);
  if (currentStreak >= 7) await awardAchievement(userId, ACH_KEYS.STREAK_7);
  if (currentStreak >= 14) await awardAchievement(userId, ACH_KEYS.STREAK_14);
  if (currentStreak >= 30) await awardAchievement(userId, ACH_KEYS.STREAK_30);
  if (currentStreak >= 100) await awardAchievement(userId, ACH_KEYS.STREAK_100);

  // Contribution aggregates (last 30 days window)
  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);
  const contrib30 = await prisma.contribution.findMany({ where: { userId, AND: [{ date: { gte: since30 } }, { date: { gte: registrationCutoff } }] }, select: { date: true, count: true } });
  const activeDays30 = new Set(contrib30.map(c => c.date.toISOString().slice(0,10)));
  if (activeDays30.size >= 20) await awardAchievement(userId, ACH_KEYS.CONSISTENCY_20_IN_30);

  // Lifetime counts (after registration only)
  const allContrib = await prisma.contribution.findMany({ where: { userId, date: { gte: registrationCutoff } }, select: { date: true, count: true } });
  const lifetimeActiveDays = new Set(allContrib.map(c => c.date.toISOString().slice(0,10)));
  if (lifetimeActiveDays.size >= 1) await awardAchievement(userId, ACH_KEYS.FIRST_STEPS);
  if (lifetimeActiveDays.size >= 10) await awardAchievement(userId, ACH_KEYS.HITTING_STRIDE);
  if (lifetimeActiveDays.size >= 100) await awardAchievement(userId, ACH_KEYS.MARATHONER);

  // Peak day (simple check)
  if (allContrib.some(c => c.count >= 25)) await awardAchievement(userId, ACH_KEYS.PEAK_DAY_25);

  let yearTotals: { yearTotal: number } | null = null;
  if (allowFull) {
    const yearStart = new Date(new Date().getFullYear(),0,1);
    const yearContrib = await prisma.contribution.findMany({ where: { userId, AND: [{ date: { gte: yearStart } }, { date: { gte: registrationCutoff } }] }, select: { count: true } });
    const yearTotal = yearContrib.reduce((s,c)=>s+c.count,0);
    yearTotals = { yearTotal };
    if (yearTotal >= 300) await awardAchievement(userId, ACH_KEYS.YEAR_300);
    if (yearTotal >= 500) await awardAchievement(userId, ACH_KEYS.YEAR_500);
    if (yearTotal >= 1000) await awardAchievement(userId, ACH_KEYS.YEAR_1000);
  }

  // Weekend Warrior (check last weekend or any weekend pair inside past 14 days)
  const past14 = new Date(); past14.setDate(past14.getDate()-14);
  const contrib14 = await prisma.contribution.findMany({ where: { userId, AND: [{ date: { gte: past14 } }, { date: { gte: registrationCutoff } }] }, select: { date: true } });
  const byWeekday = new Map<number,string[]>();
  for (const r of contrib14){ const wd = r.date.getUTCDay(); const iso=r.date.toISOString().slice(0,10); (byWeekday.get(wd)??byWeekday.set(wd,[]), byWeekday.get(wd)!).push(iso); }
  if ((byWeekday.get(6)?.length ?? 0) > 0 && (byWeekday.get(0)?.length ?? 0) > 0) await awardAchievement(userId, ACH_KEYS.WEEKEND_WARRIOR);

  // Monday Momentum (4 consecutive Mondays)
  const mondays = contrib30.filter(c => c.date.getUTCDay() === 1).map(c=>c.date).sort();
  let consecMondays = 0; let lastMonday: Date|undefined;
  for (const m of mondays){ if (!lastMonday) { consecMondays=1; lastMonday=m; continue;} const diff=(m.getTime()-lastMonday.getTime())/86400000; if (diff===7){ consecMondays+=1; lastMonday=m; } else if (diff>7){ consecMondays=1; lastMonday=m; } }
  if (consecMondays >= 4) await awardAchievement(userId, ACH_KEYS.MONDAY_MOMENTUM);

  // Advanced time-based: Early Bird / Night Owl (3+ qualifying days within last 7 days)
  const seven = new Date(); seven.setDate(seven.getDate()-7);
  const timeBuckets = await (prisma as any).contributionTimeBucket.findMany({ where: { userId, AND: [{ date: { gte: seven } }, { date: { gte: registrationCutoff } }] }, select: { date: true, morningCount: true, eveningCount: true } });
  const morningQualDays = (timeBuckets as any[]).filter((tb: any) => tb.morningCount > 0).length;
  const eveningQualDays = (timeBuckets as any[]).filter((tb: any) => tb.eveningCount > 0).length;
  if (morningQualDays >= 3) await awardAchievement(userId, ACH_KEYS.EARLY_BIRD);
  if (eveningQualDays >= 3) await awardAchievement(userId, ACH_KEYS.NIGHT_OWL);

  // Monthly Maker only when allowed (skip for very new users)
  if (allowFull) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthContrib = await prisma.contribution.findMany({ where: { userId, AND: [{ date: { gte: monthStart } }, { date: { gte: registrationCutoff } }] }, select: { count: true } });
    const monthTotal = monthContrib.reduce((s,c)=>s+c.count,0);
    if (monthTotal >= 100) await awardAchievement(userId, ACH_KEYS.MONTHLY_MAKER_100);
  }

  if (allowFull) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthRepoRows = await (prisma as any).repoDailyContribution.findMany({ where: { userId, AND: [{ date: { gte: monthStart } }, { date: { gte: registrationCutoff } }] }, select: { githubRepoId: true } });
    const distinctReposMonth = new Set((monthRepoRows as any[]).map((r: any) => r.githubRepoId));
    if (distinctReposMonth.size >= 3) await awardAchievement(userId, ACH_KEYS.EXPLORER_3_REPOS);
    const monthRepoDetail = await (prisma as any).repoDailyContribution.findMany({ where: { userId, AND: [{ date: { gte: monthStart } }, { date: { gte: registrationCutoff } }], isPrivate: false }, select: { count: true } });
    const publicMonthTotal = (monthRepoDetail as any[]).reduce((s: number, c: any)=> s + (c.count||0), 0);
    if (publicMonthTotal >= 20) await awardAchievement(userId, ACH_KEYS.PUBLIC_SERVANT_20);
  }

  if (allowFull) {
    const quarterStartMonth = Math.floor(now.getMonth()/3)*3;
    const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1);
    const quarterRepoRows = await (prisma as any).repoDailyContribution.findMany({ where: { userId, AND: [{ date: { gte: quarterStart } }, { date: { gte: registrationCutoff } }] }, select: { date: true, githubRepoId: true } });
    const weekMap = new Map<number, Set<string>>();
    for (const r of quarterRepoRows) {
      const d = r.date;
      const jan4 = new Date(Date.UTC(d.getUTCFullYear(),0,4));
      const dayOfYear = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(),0,1))/86400000)+1;
      const week = Math.ceil((dayOfYear + jan4.getUTCDay()+1)/7);
      const key = `${d.getUTCFullYear()}-${String(week).padStart(2,'0')}`;
      const set = weekMap.get(r.githubRepoId) || new Set<string>();
      set.add(key); weekMap.set(r.githubRepoId, set);
    }
    const loyal = Array.from(weekMap.values()).some(s => s.size >= 8);
    if (loyal) await awardAchievement(userId, ACH_KEYS.LOYAL_CONTRIBUTOR);
  }

  if (allowFull) {
    const past120 = new Date(); past120.setDate(past120.getDate()-120);
    const windowContrib = await prisma.contribution.findMany({ where: { userId, AND: [{ date: { gte: past120 } }, { date: { gte: registrationCutoff } }] }, select: { date: true } });
    const weekActive = new Map<string, Set<string>>();
    for (const r of windowContrib) {
      const d = r.date;
      const jan4 = new Date(Date.UTC(d.getUTCFullYear(),0,4));
      const dayOfYear = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(),0,1))/86400000)+1;
      const week = Math.ceil((dayOfYear + jan4.getUTCDay()+1)/7);
      const weekKey = `${d.getUTCFullYear()}-${String(week).padStart(2,'0')}`;
      const set = weekActive.get(weekKey) || new Set<string>();
      set.add(d.toISOString().slice(0,10));
      weekActive.set(weekKey,set);
    }
    const sortedWeeks = Array.from(weekActive.keys()).sort();
    let consec = 0; let prevNum: number | null = null; let prevYear: number | null = null; let finisher=false;
    for (const wk of sortedWeeks) {
      const [y, wStr] = wk.split('-');
      const w = Number(wStr); const yNum = Number(y);
      const activeDaysCount = weekActive.get(wk)!.size;
      if (activeDaysCount < 2) { consec=0; prevNum=null; prevYear=null; continue; }
      if (prevNum === null || prevYear === null) { consec=1; prevNum=w; prevYear=yNum; }
      else {
        const sequential = (yNum === prevYear && w === prevNum + 1) || (yNum === prevYear + 1 && prevNum === 52 && w === 1);
        consec = sequential ? consec + 1 : 1;
        prevNum = w; prevYear = yNum;
      }
      if (consec >= 4) { finisher=true; break; }
    }
    if (finisher) await awardAchievement(userId, ACH_KEYS.FOUR_WEEK_FINISHER);
  }

  // Commit message micro-badges (only consider commits after registration)
  // Commit userId denormalized field may be optional; cast to any for query
  const recentCommits = await (prisma.commit as any).findMany({ where: { userId, authorDate: { gte: registrationCutoff } }, orderBy: { authorDate: 'desc' }, take: 5 });
  if (recentCommits.length) {
    const latest = recentCommits[0];
    const msg = latest.message || '';
    if (/^(feat|fix|chore|docs|refactor|test)(\(|:)/i.test(msg)) await awardAchievement(userId, ACH_KEYS.SEMANTIC_SCHOLAR);
    if (/(^|\s)#\d+/.test(msg)) await awardAchievement(userId, ACH_KEYS.LINKED_UP);
    if (msg.length > 100) await awardAchievement(userId, ACH_KEYS.STORYTELLER);
    if (/^fix:/i.test(msg)) await awardAchievement(userId, ACH_KEYS.SURGICAL_FIX);
  }

  // Return list of earned achievements for display
  const earned = await (prisma as any).userAchievement.findMany({ where: { userId }, include: { achievement: true } });
  // Update last evaluated timestamp only if full evaluation happened
  if (allowFull) {
    await (prisma as any).user.update({ where: { id: userId }, data: { achievementsLastEvaluatedAt: new Date() } });
  }
  return (earned as any[]).map((e: any) => ({ key: e.achievement.key, name: e.achievement.name, description: e.achievement.description, tier: e.achievement.tier, earnedAt: e.earnedAt, category: e.achievement.category }));
}

// Cached getter for achievements
export async function getUserAchievementsCached(userId: string) {
  const cached = unstable_cache(async () => (prisma as any).userAchievement.findMany({ where: { userId }, include: { achievement: true } }), ['achievements', userId], { revalidate: 120, tags: ['achievements', `ach:${userId}`] });
  const rows = await cached();
  return (rows as any[]).map((r: any) => ({ key: r.achievement.key, name: r.achievement.name, description: r.achievement.description, tier: r.achievement.tier, earnedAt: r.earnedAt, category: r.achievement.category }));
}
