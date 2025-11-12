import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/',
  '/api/webhooks/clerk',
  // Allow cron target routes to authenticate using CRON_SECRET header instead of Clerk session
  '/api/reconcile-repos',
  '/api/purge-commits',
  // Newly allowlisted cron/admin endpoints guarded by CRON_SECRET
  '/api/leaderboard',
  '/api/scores/daily/recompute',
  '/api/cron/leaderboard-snapshots',
  '/api/cron/active-leaderboard',
])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}