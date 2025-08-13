import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { clerkClient, WebhookEvent } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { NextRequest } from 'next/server';

// NOTE: It is recommended to move these utility functions to a shared file,
// for example: '@/lib/github.ts'

interface ContributionDay {
  contributionCount: number;
  date: string;
  weekday: number;
  color: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    author: { name: string; date: string };
    message: string;
  };
  html_url: string;
  repository: GitHubRepo;
}

async function getContributionData(
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
              weeks {
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
    variables: {
      from,
      to,
    },
  };
  try {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error('Failed to fetch contribution data:', response.statusText);
      return null;
    }
    const data = await response.json();
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return null;
    }
    const calendar =
      data.data?.viewer?.contributionsCollection?.contributionCalendar;
    if (!calendar) {
      console.error('No calendar data found');
      return null;
    }
    const allDays: ContributionDay[] = [];
    calendar.weeks.forEach((week: { contributionDays: ContributionDay[] }) => {
      allDays.push(...week.contributionDays);
    });
    return allDays;
  } catch (error) {
    console.error('Error fetching contribution data:', error);
    return null;
  }
}

async function getCommitHistory(
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
    const searchQuery = `user:${username} pushed:>=${sinceISO}`;
    const encodedQuery = encodeURIComponent(searchQuery);
    const repoResponse = await fetch(
      `https://api.github.com/search/repositories?q=${encodedQuery}&sort=updated&order=desc&per_page=100`,
      { headers }
    );
    if (!repoResponse.ok) throw new Error('Failed to search repos');
    const searchResult = await repoResponse.json();
    const repos: GitHubRepo[] = searchResult.items;

    const commitPromises = repos.map(async (repo) => {
      const commitResponse = await fetch(
        `https://api.github.com/repos/${repo.full_name}/commits?since=${sinceISO}&author=${username}`,
        { headers }
      );
      if (!commitResponse.ok) return [];
  const commits = (await commitResponse.json()) as GitHubCommit[];
      return commits.map((c) => ({ ...c, repository: repo }));
    });

    const commitsByRepo = await Promise.all(commitPromises);
    const allCommits = commitsByRepo.flat();
    allCommits.sort(
      (a, b) =>
        new Date(b.commit.author.date).getTime() -
        new Date(a.commit.author.date).getTime()
    );
    return allCommits;
  } catch (error) {
    console.error('Error fetching commit history:', error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    throw new Error('Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env');
  }

  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error occured -- no svix headers', { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('Error verifying webhook:', err);
    return new Response('Error occured', { status: 400 });
  }

  const eventType = evt.type;
  if (eventType === 'user.created') {
    const { id, email_addresses, first_name, last_name, username, image_url } = evt.data;
    const githubUsername = username || '';
    const name = first_name && last_name ? `${first_name} ${last_name}`.trim() : githubUsername || 'Unknown User';
    const email = email_addresses?.[0]?.email_address;

    if (!email) {
      return new Response('Missing email address', { status: 400 });
    }

    try {
      const newUser = await prisma.user.create({
        data: {
          clerkUserId: id,
          email: email,
          name: name,
          githubUsername: githubUsername,
          avatarURL: image_url,
        },
      });

      const clerk = await clerkClient();
        const clerkResponse = await clerk.users.getUserOauthAccessToken(
          id,
          'github'
        );
      const githubToken = clerkResponse.data?.[0]?.token;

      if (githubToken) {
        // Initial Contribution Fetch
        const to = new Date();
        const fromContributions = new Date();
        fromContributions.setDate(to.getDate() - 60);
        const contributionDays = await getContributionData(githubToken, fromContributions.toISOString(), to.toISOString());

        if (contributionDays) {
          await prisma.contribution.createMany({
            data: contributionDays.map((day) => ({
              date: new Date(day.date),
              count: day.contributionCount,
              userId: newUser.id,
            })),
          });
          await prisma.user.update({ where: { id: newUser.id }, data: { contributionsLastTracked: to } });
        }

        // Initial Commit History Fetch
        const fromCommits = new Date();
        fromCommits.setDate(fromCommits.getDate() - 60);
        const commits = await getCommitHistory(githubToken, fromCommits.toISOString(), githubUsername);

        if (commits && commits.length > 0) {
          const lastCommitIDTracked = commits[0].sha;

          for (const commit of commits) {
            await prisma.repository.upsert({
              where: { githubRepoId: commit.repository.id },
              update: {},
              create: {
                githubRepoId: commit.repository.id,
                name: commit.repository.name,
                fullName: commit.repository.full_name,
                userId: newUser.id,
              },
            });

            await prisma.commit.create({
              data: {
                commit_id: commit.sha,
                message: commit.commit.message,
                authorName: commit.commit.author.name,
                authorDate: new Date(commit.commit.author.date),
                htmlUrl: commit.html_url,
                repositoryId: commit.repository.id,
              },
            });
          }

          await prisma.user.update({
            where: { id: newUser.id },
            data: {
              commitsLastTracked: new Date(),
              lastCommitIDTracked: lastCommitIDTracked,
            },
          });
        }
      }
    } catch (error) {
      console.error('Error in user creation or initial data fetch:', error);
      return new Response('Database error', { status: 500 });
    }
  }

  return new Response('', { status: 201 });
}