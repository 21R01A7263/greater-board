'use client';

import { useState } from 'react';

// Define the type for a single commit object
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

// The UI component that handles pagination state
export default function CommitHistoryUI({
  commits,
}: {
  commits: GitHubCommit[];
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const commitsPerPage = 5;

  // Pagination logic
  const indexOfLastCommit = currentPage * commitsPerPage;
  const indexOfFirstCommit = indexOfLastCommit - commitsPerPage;
  const currentCommits = commits.slice(indexOfFirstCommit, indexOfLastCommit);
  const totalPages = Math.ceil(commits.length / commitsPerPage);

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  return (
    <div className=' relative mx-auto w-full max-w-xl bg-white dark:bg-background dark:border-2 dark:border-gray-600 p-8 rounded-lg shadow-md mt-8'>
      <h2 className='text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-6 border-b dark:border-gray-600 pb-4'>
        Latest Commits
      </h2>
      {commits.length > 0 ? (
        <>
          <ul className='space-y-3 mb-6 min-h-[350px]'>
            {' '}
            {/* Added min-height to prevent layout shift */}
            {currentCommits.map((commit) => (
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
          <div className='flex justify-between items-center'>
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className='px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 dark:hover:bg-gray-500'
            >
              Previous
            </button>
            <span className='text-sm text-gray-600 dark:text-gray-300'>
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className='px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 dark:hover:bg-gray-500'
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <p className='text-gray-500 dark:text-gray-400'>No commits found in the last 30 days.</p>
      )}
    </div>
  );
}
