import prisma from '@/lib/prisma';
import { getActiveLeaderboard } from '@/lib/leaderboard';
import { LeaderboardTable } from '@/components/leaderboard/leaderboard-table';
import Link from 'next/link';

export const revalidate = 10; // allow short ISR on page

type SearchParams = { page?: string };

// In Next.js 15, searchParams is a Promise in Server Components; await before use
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const resolved = await searchParams;
  const page = Math.max(1, parseInt(resolved?.page || '1', 10));
  const pageSize = 50;
  const data = await getActiveLeaderboard(page, pageSize);

  // Fetch user display info for current page rows
  const ids = data.rows.map((r: any) => r.userId);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarURL: true } }) : [];
  const byId = new Map(users.map(u => [u.id, u] as const));
  const rows = data.rows.map((r: any) => ({ rank: r.rank as number, userId: r.userId as string, score: r.score as number, name: byId.get(r.userId)?.name, avatarURL: byId.get(r.userId)?.avatarURL }));

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / pageSize));
  const mkLink = (p: number) => `/leaderboard?page=${p}`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-4">Leaderboard</h1>
      <div className="flex items-center gap-2 mb-4 text-xs text-neutral-500">
        Active users with at least 1 commit in the last 30 days (ranked by current score)
      </div>
      <LeaderboardTable rows={rows} />
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-neutral-500">Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <Link href={mkLink(Math.max(1, page-1))} className={`px-3 py-1 rounded bg-neutral-100 dark:bg-neutral-900 ${page<=1 ? 'pointer-events-none opacity-50' : ''}`}>Prev</Link>
          <Link href={mkLink(Math.min(totalPages, page+1))} className={`px-3 py-1 rounded bg-neutral-100 dark:bg-neutral-900 ${page>=totalPages ? 'pointer-events-none opacity-50' : ''}`}>Next</Link>
        </div>
      </div>
    </div>
  );
}
