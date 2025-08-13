// Shared GitHub API utilities
// Uses global fetch provided by Next.js/runtime or browser

export interface ContributionDay {
  contributionCount: number;
  date: string;
  weekday: number;
  color: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    author: { name: string; date: string };
    message: string;
  };
  html_url: string;
  repository?: GitHubRepo;
}

export async function getContributionData(
  token: string,
  from: string,
  to: string
): Promise<ContributionDay[] | null> {
  const headers = {
    Authorization: `bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const body = {
    query: `
      query($from: DateTime!, $to: DateTime!) {
        viewer {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks { contributionDays { contributionCount date weekday color }}
            }
          }
        }
      }
    `,
    variables: { from, to },
  };
  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const calendar = data.data?.viewer?.contributionsCollection?.contributionCalendar;
    if (!calendar) return null;
    return calendar.weeks.flatMap((week: any) => week.contributionDays as ContributionDay[]);
  } catch {
    return null;
  }
}

export async function getCommitHistory(
  token: string,
  sinceISO: string,
  username: string
): Promise<GitHubCommit[] | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Nextjs-Clerk-Commit-Viewer',
    Accept: 'application/vnd.github.v3+json',
  };
  try {
    const query = encodeURIComponent(`user:${username} pushed:>=${sinceISO}`);
    const repoRes = await fetch(
      `https://api.github.com/search/repositories?q=${query}&sort=updated&order=desc&per_page=100`,
      { headers }
    );
    if (!repoRes.ok) return null;
    const items = (await repoRes.json()).items as GitHubRepo[];
    const commits = (
      await Promise.all(
        items.map(async (repo) => {
          const commitRes = await fetch(
            `https://api.github.com/repos/${repo.full_name}/commits?since=${sinceISO}&author=${username}`,
            { headers }
          );
          return commitRes.ok ? ((await commitRes.json()) as GitHubCommit[]).map(c => ({ ...c, repository: repo })) : [];
        })
      )
    )
    .flat()
    .sort((a, b) => new Date(b.commit.author.date).getTime() - new Date(a.commit.author.date).getTime());
    return commits;
  } catch {
    return null;
  }
}
