import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { clerkClient } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

// GitHub fetch with ETag support
async function ghWithEtag(url: string, token: string, etag?: string): Promise<{ status: number; json?: any; etag?: string | null; }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'greater-board',
      Accept: 'application/vnd.github+json',
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
    cache: 'no-store',
  });
  if (res.status === 304) {
    return { status: 304, etag: res.headers.get('etag') };
  }
  if (!res.ok) {
    throw new Error(String(res.status));
  }
  return { status: res.status, json: await res.json(), etag: res.headers.get('etag') };
}

type RepoInfo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  disabled?: boolean;
};

export async function POST(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret') || request.headers.get('authorization');
  if (!configuredSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 501 });
  }
  if (!provided || !provided.endsWith(configuredSecret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = new URL(request.url).searchParams.get('limit');
  const limit = Math.max(1, Math.min(500, limitParam ? parseInt(limitParam, 10) : 200));

  // Process repositories in batches
  const repos = await prisma.repository.findMany({
    where: {},
    select: { id: true, githubRepoId: true, name: true, fullName: true, userId: true },
    take: limit,
    orderBy: { updatedAt: 'asc' },
  });

  let updated = 0;
  let markedUnavailable = 0;
  let skippedNoToken = 0;
  const touchedUsers = new Set<string>();

  // Cache per-user GitHub tokens to avoid repeated Clerk calls
  const tokenByUser = new Map<string, string | null>();

  async function getTokenForUser(userId: string): Promise<string | null> {
    if (tokenByUser.has(userId)) return tokenByUser.get(userId)!;
    try {
      // Try provider id 'github' (Clerk newer SDKs)
      const client = await clerkClient();
      // Prefer getUserOauthAccessToken when available; fall back to getOAuthAccessToken
      let token: string | null = null;
      try {
        const res: any = await (client as any).users.getUserOauthAccessToken?.(userId, 'github');
        token = res?.data?.[0]?.token ?? null;
      } catch {}
      if (!token) {
        try {
          const res2: any = await (client as any).users.getOAuthAccessToken?.({ userId, provider: 'oauth_github' });
          token = res2?.data?.[0]?.token ?? null;
        } catch {}
      }
      tokenByUser.set(userId, token);
      return token;
    } catch {
      tokenByUser.set(userId, null);
      return null;
    }
  }

  for (const r of repos) {
    const token = await getTokenForUser(r.userId);
    if (!token) {
      skippedNoToken += 1;
      // We can't check this repo without the owner's token; move on.
      continue;
    }
    try {
      const existing = await (prisma.repository as any).findUnique({ where: { id: r.id }, select: { repoEtag: true } });
      const { status, json, etag } = await ghWithEtag(`https://api.github.com/repositories/${r.githubRepoId}`, token, existing?.repoEtag ?? undefined);
      if (etag) {
        await (prisma.repository as any).update({ where: { id: r.id }, data: { repoEtag: etag } }).catch(() => {});
      }
      if (status !== 304) {
        const info = json as RepoInfo;
        await (prisma.repository as any).update({
          where: { id: r.id },
          data: {
            name: info.name,
            fullName: info.full_name,
            isPrivate: !!info.private,
            isArchived: !!info.archived,
            isDisabled: !!info.disabled,
            isUnavailable: false,
            lastCheckedAt: new Date(),
          },
        });
        updated += 1;
        touchedUsers.add(r.userId);
      } else {
        // Not modified, still bump lastCheckedAt
        await (prisma.repository as any).update({ where: { id: r.id }, data: { lastCheckedAt: new Date() } });
      }
    } catch (e: any) {
      const status = parseInt(e?.message || '', 10);
      if (status === 404 || status === 410 || status === 451) {
        await (prisma.repository as any).update({
          where: { id: r.id },
          data: { isUnavailable: true, lastCheckedAt: new Date() },
        });
        markedUnavailable += 1;
        touchedUsers.add(r.userId);
      } else {
        // Other errors are transient; set lastCheckedAt to now but don't flip availability
  await (prisma.repository as any).update({ where: { id: r.id }, data: { lastCheckedAt: new Date() } });
      }
    }
  }
  // Invalidate commit caches for touched users so hidden/renamed repos reflect promptly
  try {
    const cache = await import('next/cache');
    for (const uid of touchedUsers) {
      (cache as any).revalidateTag?.(`commits:user:${uid}`);
    }
  } catch {}

  return NextResponse.json({ ok: true, scanned: repos.length, updated, markedUnavailable, skippedNoToken });
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Use POST to reconcile repositories. Optional query: ?limit=200' });
}
