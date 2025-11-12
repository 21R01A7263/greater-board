// Commit History server component

export const revalidate = 120; // Revalidate every 2 minutes
import { auth, clerkClient } from '@clerk/nextjs/server';
import CommitHistoryUI from './commit-history-client'; // Import the client component
import { needsCommitSync, syncRecentCommits, getRecentCommitsFromDBCached } from '@/lib/github-commits';
import prisma from '@/lib/prisma';

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
  repository?: GitHubRepo;
}

// Legacy direct GitHub fetch removed; now using DB-backed caching via prisma.

const CommitHistory = async () => {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    include: {
      repositories: {
        include: {
          commits: {
            orderBy: {
              authorDate: 'desc',
            },
          },
        },
      },
    },
  });

  if (!user) {
    return <div>User not found in database.</div>;
  }

  const client = await clerkClient();
  const clerkResponse = await client.users.getUserOauthAccessToken(
    userId,
    'github'
  );
  const githubToken = clerkResponse.data?.[0]?.token;
  const githubUsername = user.githubUsername;

  if (!githubToken || !githubUsername) {
    return (
      <div className="w-full max-w-4xl bg-white p-8 rounded-lg shadow-md mt-8">
        <h2 className="text-2xl font-semibold text-gray-700 mb-6 border-b pb-4">
          Commit History
        </h2>
        <p className="text-red-500">
          GitHub token or username not found. Please reconnect your GitHub
          account.
        </p>
      </div>
    );
  }

  // Ensure there is a corresponding DB user row (for FK relations) even if webhooks are not configured in dev
  try {
    const email = (user?.emailAddresses?.[0]?.emailAddress as string | undefined) || '';
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || (user?.username as string | undefined) || 'Unknown User';
    const avatarURL = (user?.imageUrl as string | undefined) || undefined;
    if (email) {
      await prisma.user.upsert({
        where: { clerkUserId: userId },
        update: { email, name, githubUsername, avatarURL },
        create: { email, name, githubUsername, avatarURL, clerkUserId: userId },
      });
    }
  } catch (e) {
    console.warn('Failed to ensure DB user exists:', e);
  }

  // Sync if stale
  try {
    const stale = await needsCommitSync(userId);
    if (stale) {
      await syncRecentCommits({ userId, githubUsername, token: githubToken });
    }
  } catch (e) {
    console.error('Commit sync failed', e);
  }

  // Fetch only the latest 5 commits (helper internally caps to 5)
  const commits = await getRecentCommitsFromDBCached(userId, 30, 5, 0);
  const shaped: GitHubCommit[] = commits.map(c => {
    const dateVal: any = c.authorDate;
    const iso = (dateVal instanceof Date) ? dateVal.toISOString() : (typeof dateVal === 'string' ? dateVal : new Date(dateVal).toISOString());
    return {
      sha: c.sha,
      commit: { author: { name: c.authorName, date: iso }, message: c.message },
      html_url: c.htmlUrl,
    };
  });

  return <CommitHistoryUI commits={shaped} />;
};

export default CommitHistory;