import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { clerkClient, WebhookEvent } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

// Cache webhook secret at module level
const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  throw new Error(
    'Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local'
  );
}

// Pre-create webhook instance
const webhook = new Webhook(WEBHOOK_SECRET);

export async function POST(req: NextRequest) {
  try {
    // Get headers synchronously in parallel
    const [headerPayload, payload] = await Promise.all([
      headers(),
      req.json(),
    ]);

    // Extract required headers with single get calls
    const svixHeaders = {
      'svix-id': headerPayload.get('svix-id') ?? '',
      'svix-timestamp': headerPayload.get('svix-timestamp') ?? '',
      'svix-signature': headerPayload.get('svix-signature') ?? '',
    };

    // Validate all headers at once
    if (
      !svixHeaders['svix-id'] ||
      !svixHeaders['svix-timestamp'] ||
      !svixHeaders['svix-signature']
    ) {
      return NextResponse.json(
        { error: 'Missing svix headers' },
        { status: 400 }
      );
    }

    // Verify webhook with pre-stringified body
    const body = JSON.stringify(payload);
    const evt = webhook.verify(body, svixHeaders) as WebhookEvent;

    // Early return for non-user.created events
    if (evt.type !== 'user.created') {
      return NextResponse.json({}, { status: 200 });
    }

    // Extract user data directly from webhook payload instead of making API call
    const userData = evt.data;
    const userId = userData.id;
    const email = userData.email_addresses?.[0]?.email_address;
    const firstName = userData.first_name;
    const lastName = userData.last_name;
    const username = userData.username;

    // Optimize name assignment with nullish coalescing
    const name =
      firstName && lastName
        ? `${firstName} ${lastName}`
        : username ?? email?.split('@')[0] ?? 'Unknown User';

    // Single database operation with upsert to handle duplicates
    await prisma.user.upsert({
      where: { clerkUserId: userId },
      create: {
        clerkUserId: userId,
        email: email ?? '',
        name,
        githubUsername: username ?? name,
      },
      update: {
        email: email ?? '',
        name,
        githubUsername: username ?? name,
      },
    });

    return NextResponse.json({}, { status: 201 });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
