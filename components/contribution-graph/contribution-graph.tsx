// src/app/dashboard/contribution-graph.tsx
export const revalidate = Number(process.env.GITHUB_GRAPH_REVALIDATE_SECONDS ?? 120); // 2-minute refresh
import { auth, clerkClient } from '@clerk/nextjs/server';
import { unstable_cache } from 'next/cache';

// Types for GitHub GraphQL response
interface GQLContributionDay {
  contributionCount: number;
  date: string; // YYYY-MM-DD
  weekday: number; // 0-6
  color: string; // color provided by GitHub scale
}

interface GQLWeek {
  firstDay: string;
  contributionDays: GQLContributionDay[]; // typically 7
}

interface GQLCalendar {
  totalContributions: number;
  colors?: string[]; // GitHub color scale from low->high
  weeks: GQLWeek[];
}

// Helper: clamp a Date to 00:00:00 UTC
function startOfUTCDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Helper: ISO YYYY-MM-DD for a UTC-based Date
function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Lightweight state card to reduce JSX duplication
function StateCard({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="w-full max-w-xl mx-auto bg-white dark:bg-background dark:border-2 dark:border-gray-600 p-8 rounded-2xl shadow-md border border-white/20 mt-8">
      <h2 className="text-2xl font-bold mb-2">{title}</h2>
      <p className="text-gray-600 dark:text-gray-300">{message}</p>
    </div>
  );
}

// Fetch contribution calendar with Next.js caching
async function getContributionCalendar(
  token: string,
  from: string,
  to: string
): Promise<GQLCalendar | null> {
  const headers = {
    Authorization: `bearer ${token}`,
    'Content-Type': 'application/json',
  } as const;

  const body = {
    query: `
      query($from: DateTime!, $to: DateTime!) {
        viewer {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              totalContributions
              colors
              weeks {
                firstDay
                contributionDays {
                  contributionCount
                  date
                  weekday
                  color
                }
              }
            }
          }
        }
      }
    `,
    variables: { from, to },
  };

  try {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      next: { revalidate },
    });

    if (!response.ok) {
      // 403 could be rate limiting
      console.error('Failed to fetch contribution data:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return null;
    }

    const calendar: GQLCalendar | undefined =
      data.data?.viewer?.contributionsCollection?.contributionCalendar;

    if (!calendar || !calendar.weeks) return null;
    return calendar;
  } catch (error) {
    console.error('Error fetching contribution data:', error);
    return null;
  }
}

// Build a standard GitHub-style grid: columns = weeks, rows = weekdays
type EnrichedDay = GQLContributionDay & { label: string };

// Build exactly last 60 days, precomputing labels and using a stable date formatter
function buildLast60Days(calendar: GQLCalendar, from: Date, to: Date) {
  // Build a map of date->day from GitHub response
  const map = new Map<string, GQLContributionDay>();
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      map.set(day.date, day);
    }
  }

  // Iterate from 'from' to 'to' to guarantee exactly 60 days
  const days: EnrichedDay[] = [];
  const cursor = new Date(from);
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  while (cursor <= to) {
    const iso = toISODateUTC(cursor);
    const existing = map.get(iso);
    const base: GQLContributionDay =
      existing ?? { contributionCount: 0, date: iso, weekday: cursor.getUTCDay(), color: '' };
    const label = `${base.contributionCount} contribution${base.contributionCount === 1 ? '' : 's'} on ${fmt.format(new Date(iso))}`;
    days.push({ ...base, label });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Ensure exactly 60 items (inclusive range should already provide 61 if not careful); slice from the end
  const last60 = days.slice(-60);

  const total = last60.reduce((sum, d) => sum + d.contributionCount, 0);
  const activeDays = last60.filter((d) => d.contributionCount > 0).length;
  return { last60, total, activeDays };
}

const DEFAULT_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

// Component to render the contribution graph
const ContributionGraph = async () => {
  const { userId } = await auth();
  if (!userId) {
    return <StateCard title="Authentication Required" message="Please sign in to view your GitHub contribution history." />;
  }

  // 60 days window normalized to 00:00 UTC; include today as the last day
  const todayUTC = startOfUTCDay(new Date());
  const fromUTC = new Date(todayUTC);
  fromUTC.setUTCDate(todayUTC.getUTCDate() - 59); // 60 days inclusive
  // IMPORTANT: Use current time for the GraphQL 'to' boundary so today's contributions are included
  const toISO = new Date().toISOString();
  const fromISO = fromUTC.toISOString();

  try {
    // Quick token presence check for better UX before hitting cache layer
    const client = await clerkClient();
    const tokenCheck = await client.users.getUserOauthAccessToken(userId, 'github');
    const githubToken = tokenCheck.data?.[0]?.token as string | undefined;
    if (!githubToken) {
      return <StateCard title="GitHub Connection Required" message="Please connect your GitHub account in your profile settings to load contribution data." />;
    }

    // Per-user cached calendar fetch for the date window
    const getCalendarForUserCached = unstable_cache(
      async (uid: string, from: string, to: string) => {
        const innerClient = await clerkClient();
        const res = await innerClient.users.getUserOauthAccessToken(uid, 'github');
        const tk = res.data?.[0]?.token as string | undefined;
        if (!tk) return null;
        return getContributionCalendar(tk, from, to);
      },
      ['contrib-calendar'],
      { revalidate, tags: ['contrib-calendar', `contrib:${userId}`] }
    );

    const calendar = await getCalendarForUserCached(userId, fromISO, toISO);
    if (!calendar) {
      return <StateCard title="No Data Available" message="Could not load contribution data right now. Please try again later." />;
    }

    const { last60, total, activeDays } = buildLast60Days(calendar, fromUTC, todayUTC);
    const colorScale = calendar.colors && calendar.colors.length >= 5 ? calendar.colors : DEFAULT_COLORS;

    return (
      <div className="w-full max-w-xl mx-auto">
        <div className="bg-white dark:bg-background dark:border-2 dark:border-gray-600 p-6 rounded-2xl shadow border border-white/20 mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Contribution Activity</h2>
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold">{total}</span> total • <span className="font-semibold">{activeDays}</span> active days
            </div>
          </div>

          {/* Grid: exactly 60 days as a 10x6 rectangle filling container width */}
          <div
            className="grid py-4 px-2 rounded-xl border border-gray-300/70 dark:border-gray-600 gap-1"
            style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}
          >
            {last60.map((day, idx) => (
              <span
                key={`${day.date}-${idx}`}
                role="button"
                tabIndex={0}
                aria-label={day.label}
                title={day.label}
                className="w-full aspect-square rounded-[4px] shadow-sm outline-none focus:ring-2 focus:ring-ring/50"
                style={{ backgroundColor: day.color || colorScale[0] }}
              />
            ))}
          </div>

          {/* Legend derived from GitHub scale */}
          <div className="flex items-center justify-center mt-3">
            <span className="text-xs text-muted-foreground mr-2">Less</span>
            <div className="flex items-center gap-1">
              {colorScale.map((c, idx) => (
                <span key={idx} className="w-3 h-3 rounded-[3px] border border-black/10 dark:border-white/20" style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground ml-2">More</span>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error in ContributionGraph:', error);
    return <StateCard title="Something Went Wrong" message="An unexpected error occurred while loading contribution data." />;
  }
};

export default ContributionGraph;