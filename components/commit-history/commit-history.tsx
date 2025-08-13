import { auth, clerkClient } from '@clerk/nextjs/server';
import CommitHistoryUI from './commit-history-client';
import prisma from '@/lib/prisma';
import { Commit, Repository } from '@prisma/client';

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

  const fromDateForApi =
    user.commitsLastTracked ||
    new Date(new Date().setDate(new Date().getDate() - 60));
  const newCommitsFromAPI = await getCommitHistory(
    githubToken,
    fromDateForApi.toISOString(),
    githubUsername
  );

  type CommitWithRepository = Commit & { repository: Repository };

  const allCommitsFromDb: CommitWithRepository[] = user.repositories.flatMap(
    (repo) => repo.commits.map((c) => ({ ...c, repository: repo }))
  );
  allCommitsFromDb.sort(
    (a, b) => b.authorDate.getTime() - a.authorDate.getTime()
  );

  const commitsToDisplay: GitHubCommit[] = allCommitsFromDb.map((c) => ({
    sha: c.commit_id,
    commit: {
      author: { name: c.authorName, date: c.authorDate.toISOString() },
      message: c.message,
    },
    html_url: c.htmlUrl,
  }));

  let newDataToStore: GitHubCommit[] = [];
  if (newCommitsFromAPI && newCommitsFromAPI.length > 0) {
    const lastTrackedIndex = newCommitsFromAPI.findIndex(
      (c) => c.sha === user.lastCommitIDTracked
    );
    newDataToStore =
      lastTrackedIndex !== -1
        ? newCommitsFromAPI.slice(0, lastTrackedIndex)
        : newCommitsFromAPI;

    if (newDataToStore.length > 0) {
      // Prepend new commits for immediate display
      commitsToDisplay.unshift(...newDataToStore);

      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      await prisma.$transaction(async (tx) => {
        for (const commit of newDataToStore) {
          if (commit.repository) {
            const repo = await tx.repository.upsert({
              where: { githubRepoId: commit.repository.id },
              update: {},
              create: {
                githubRepoId: commit.repository.id,
                name: commit.repository.name,
                fullName: commit.repository.full_name,
                userId: user.id,
              },
            });

            await tx.commit.create({
              data: {
                commit_id: commit.sha,
                message: commit.commit.message,
                authorName: commit.commit.author.name,
                authorDate: new Date(commit.commit.author.date),
                htmlUrl: commit.html_url,
                repositoryId: repo.id,
              },
            });
          }
        }

        await tx.commit.deleteMany({
          where: {
            repository: { userId: user.id },
            authorDate: { lt: sixtyDaysAgo },
          },
        });

        await tx.user.update({
          where: { id: user.id },
          data: {
            commitsLastTracked: new Date(),
            lastCommitIDTracked: newDataToStore[0].sha,
          },
        });
      });
    }
  }

  const dataToRender = commitsToDisplay.slice(0, 5);

  return <CommitHistoryUI commits={dataToRender} />;
};

export default CommitHistory;