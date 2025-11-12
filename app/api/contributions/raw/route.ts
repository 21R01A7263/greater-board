import { NextResponse } from 'next/server';
import { currentUser, clerkClient } from '@clerk/nextjs/server';

// Uncached direct fetch of GitHub contribution calendar for debugging today's cell
export async function GET() {
  const user = await currentUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Acquire token fresh
  const client = await clerkClient();
  const res = await client.users.getUserOauthAccessToken(userId, 'github');
  const token = res.data?.[0]?.token as string | undefined;
  if (!token) {
    return NextResponse.json({ error: 'No GitHub token' }, { status: 400 });
  }

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 59));
  const fromISO = start.toISOString();
  const toISO = now.toISOString();

  const body = {
    query: `query($from: DateTime!, $to: DateTime!) { viewer { contributionsCollection(from: $from, to: $to) { contributionCalendar { totalContributions colors weeks { firstDay contributionDays { contributionCount date weekday color } } } } } }`,
    variables: { from: fromISO, to: toISO },
  };

  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await resp.json();
  const calendar = json.data?.viewer?.contributionsCollection?.contributionCalendar;
  let todayCount: number | null = null;
  if (calendar?.weeks) {
    const todayISO = now.toISOString().slice(0, 10);
    for (const w of calendar.weeks) {
      for (const d of w.contributionDays) {
        if (d.date === todayISO) {
          todayCount = d.contributionCount;
          break;
        }
      }
      if (todayCount !== null) break;
    }
  }

  return NextResponse.json({ today: now.toISOString().slice(0,10), todayCount, rawTotal: calendar?.totalContributions ?? null, calendar });
}
