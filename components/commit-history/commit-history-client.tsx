'use client';

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

export default function CommitHistoryUI({ commits }: { commits: GitHubCommit[] }) {
  return (
    <div className='relative mx-auto w-full max-w-xl bg-white dark:bg-background dark:border-2 dark:border-gray-600 p-8 rounded-lg shadow-md mt-8'>
      <h2 className='text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-6 border-b dark:border-gray-600 pb-4'>
        Latest Commits
      </h2>
      {commits.length > 0 ? (
        <ul className='space-y-3'>
          {commits.map((commit) => (
            <li
              key={commit.sha}
              className='text-text-gray-800 dark:text-gray-200 p-3 bg-gray-50 dark:bg-gray-700 rounded-md flex justify-between items-center'
            >
              <div>
                <p className='font-semibold text-lg'>
                  {commit.commit.message.split('\n')[0]}{' '}
                  <span className='font-mono text-xs text-gray-700/50 dark:text-gray-400/70'>
                    {commit.sha.substring(0, 7)}
                  </span>
                </p>
                <p className='text-xs text-gray-500 dark:text-gray-400'>
                  {new Date(commit.commit.author.date).toLocaleDateString(
                    undefined,
                    { day: 'numeric', month: 'long', year: 'numeric' }
                  )}
                </p>
              </div>
              <div className='pr-4'>
                <a
                  href={commit.html_url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-semibold text-sm flex-shrink-0'
                >
                  View
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-gray-500 dark:text-gray-400'>No commits yet.</p>
      )}
    </div>
  );
}