// src/app/dashboard/commit-history.tsx

export const revalidate = 3600; // Revalidate every 60 seconds
import { auth, clerkClient } from '@clerk/nextjs/server';
import CommitHistoryUI from './commit-history-client'; // Import the new client component

// Define interfaces for type safety
interface GitHubRepo {
  full_name: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      date: string;
    };
    message: string;
  };
  html_url: string;
}

async function getCommitHistory(
  token: string,
  username: string
): Promise<GitHubCommit[] | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Nextjs-Clerk-Commit-Viewer',
    Accept: 'application/vnd.github.v3+json',
  };

  try {

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 30);
    const sinceISO = sinceDate.toISOString().split('T')[0]; // Get YYYY-MM-DD format

    const searchQuery = `user:${username} pushed:>=${sinceISO}`;
    const encodedQuery = encodeURIComponent(searchQuery);

    const repoResponse = await fetch(
      `https://api.github.com/search/repositories?q=${encodedQuery}&sort=updated&order=desc&per_page=100`,
      { headers }
    );
    // console.log('Repo Response:', repoResponse);
    if (!repoResponse.ok) {
      throw new Error(
        `Failed to search repositories. Status: ${repoResponse.status}`
      );
    }

    const searchResult = await repoResponse.json();
    const repos: GitHubRepo[] = searchResult.items;

    const commitPromises = repos.map(async (repo) => {
      const commitResponse = await fetch(
        `https://api.github.com/repos/${repo.full_name}/commits?since=${sinceISO}`,
        { headers }
      );
      if (!commitResponse.ok) {
        console.error(
          `Failed to fetch commits for ${repo.full_name}. Status: ${commitResponse.status}`
        );
        return [];
      }
      return commitResponse.json() as Promise<GitHubCommit[]>;
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

// Server Component: Fetches data and passes it to the client component
const CommitHistory = async () => {
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  const client = await clerkClient();
  const clerkResponse = await client.users.getUserOauthAccessToken(
    userId,
    'github'
  );
const githubToken = typeof clerkResponse.data?.[0]?.token === 'string' ? clerkResponse.data?.[0]?.token : '';
const user = await client.users.getUser(userId);

// Define type for external accounts
type ExternalAccount = {
  provider: string;
  username?: string;
  // ...other fields if needed
};

const githubUsername =
  typeof user?.publicMetadata?.github_username === 'string' && user?.publicMetadata?.github_username
    ? user.publicMetadata.github_username
    : typeof user?.username === 'string' && user?.username
    ? user.username
    : Array.isArray(user?.externalAccounts) &&
      typeof (user.externalAccounts as ExternalAccount[]).find((acc) => acc.provider === 'github')?.username === 'string'
    ? (user.externalAccounts as ExternalAccount[]).find((acc) => acc.provider === 'github')?.username
    : '';

  if (!githubToken || !githubUsername) {
    return (
      <div className="w-full max-w-4xl bg-white p-8 rounded-lg shadow-md mt-8">
        <h2 className="text-2xl font-semibold text-gray-700 mb-6 border-b pb-4">
          Commit History (Last 30 Days)
        </h2>
        <p className="text-red-500">
          GitHub token or username not found. Please reconnect your GitHub
          account.
        </p>
      </div>
    );
  }

  const commits = await getCommitHistory(githubToken, githubUsername);

  if (commits === null) {
    return (
      <div className="w-full max-w-4xl bg-white p-8 rounded-lg shadow-md mt-8">
        <h2 className="text-2xl font-semibold text-gray-700 mb-6 border-b pb-4">
          Commit History (Last 30 Days)
        </h2>
        <p className="text-red-500">Could not load commit history.</p>
      </div>
    );
  }

  // Render the client component and pass the fetched commits as a prop
  return <CommitHistoryUI commits={commits} />;
};

export default CommitHistory;