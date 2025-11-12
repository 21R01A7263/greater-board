'use client';

import { useMemo } from 'react';
import React from 'react';

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

export default function CommitHistoryUI({
  commits,
}: {
  commits: GitHubCommit[];
}) {
  // We only ever show up to 5 commits (already limited server side)
  const currentCommits = useMemo(() => commits.slice(0, 5), [commits]);

  return (
    <div className=' relative mx-auto w-full max-w-xl bg-white dark:bg-background dark:border-2 dark:border-gray-600 p-8 rounded-lg shadow-md mt-8'>
      <h2 className='text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-6 border-b dark:border-gray-600 pb-4'>
        Latest Commits
      </h2>
      {currentCommits.length > 0 ? (
        <ul className='space-y-3 mb-6 min-h-[350px]'>
          {currentCommits.map((commit) => (
            <MemoCommitRow key={commit.sha} commit={commit} />
          ))}
        </ul>
      ) : (
        <p className='text-gray-500 dark:text-gray-400'>
          No commits found in the last 30 days.
        </p>
      )}
    </div>
  );
}

// Memoized row component to avoid re-rendering unchanged rows
const MemoCommitRow = React.memo(function CommitRow({ commit }: { commit: GitHubCommit }) {
  const firstLine = commit.commit.message.split('\n')[0];
  const shortSha = commit.sha.substring(0, 7);
  const dateString = useMemo(() => new Date(commit.commit.author.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }), [commit.commit.author.date]);
  // Derive micro-badges purely for UI (awarding is handled server-side and post-registration)
  const chips = useMemo(() => {
    const msg = firstLine || '';
    const list: string[] = [];
    if (/^(feat|fix|chore|docs|refactor|test)(\(|:)/i.test(msg)) list.push('Semantic');
    if (/(^|\s)#\d+/.test(msg)) list.push('Linked');
    if (msg.length > 100) list.push('Storyteller');
    if (/^fix:/i.test(msg)) list.push('Fix');
    return list;
  }, [firstLine]);
  return (
    <li className='text-text-gray-800 dark:text-gray-200 p-3 bg-gray-50 dark:bg-gray-700 rounded-md flex justify-between items-center'>
      <div>
        <p className='font-semibold text-lg'>
          {firstLine}{' '}
          <span className='font-mono text-xs text-gray-700/50 dark:text-gray-400/70'>
            {shortSha}
          </span>
        </p>
        <p className='text-xs text-gray-500 dark:text-gray-400'>{dateString}</p>
        {chips.length > 0 && (
          <div className='flex gap-2 mt-1 flex-wrap'>
            {chips.map((c, idx) => (
              <span key={idx} className='px-2 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300/50'>
                {c}
              </span>
            ))}
          </div>
        )}
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
  );
});
