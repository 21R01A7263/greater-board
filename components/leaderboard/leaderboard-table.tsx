import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type LeaderboardRow = {
  rank: number;
  userId: string;
  score: number;
  name?: string;
  avatarURL?: string | null;
};

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <div className="overflow-x-auto w-full">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left border-b border-neutral-200 dark:border-neutral-800">
            <th className="py-2 pr-2 w-14">#</th>
            <th className="py-2 pr-2">User</th>
            <th className="py-2 pr-2 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.userId}-${r.rank}`} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2 pr-2 font-medium">{r.rank}</td>
              <td className="py-2 pr-2 flex items-center gap-2">
                {r.avatarURL ? (
                  <Image src={r.avatarURL} alt={r.name || r.userId} width={24} height={24} className="rounded-full" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                )}
                <span className="truncate max-w-[280px]" title={r.name || r.userId}>{r.name || r.userId}</span>
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{r.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
