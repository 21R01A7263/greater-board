import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { clerkClient, WebhookEvent, auth } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error(
      'Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local'
    );
  }

  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error occured -- no svix headers', {
      status: 400,
    });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('Error verifying webhook:', err);
    return new Response('Error occured', {
      status: 400,
    });
  }

  const eventType = evt.type;

  if (eventType === 'user.created') {
    const { id, email_addresses, first_name, last_name, username, image_url } =
      evt.data;

    const githubUsername = username || '';

    let name;
    if (!first_name && !last_name) {
      name = githubUsername || 'Unknown User';
    } else {
      name = `${first_name || ''} ${last_name || ''}`.trim();
    }
    const avatarUrl = image_url;
    const email = email_addresses?.[0]?.email_address;

    if (!email) {
      console.error('No email address found in webhook data');
      return new Response('Missing email address', { status: 400 });
    }

    try {
      const newUser = await prisma.user.create({
        data: {
          clerkUserId: id,
          email: email,
          name: name,
          githubUsername: githubUsername,
          avatarURL: avatarUrl,
        },
      });
    } catch (error) {
      console.error('Error creating user in database:', error);
      return new Response('Database error', { status: 500 });
    }
  }

  return new Response('', { status: 201 });
}
