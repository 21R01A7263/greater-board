import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { clerkClient, WebhookEvent, auth } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  // You can find this in the Clerk Dashboard -> Webhooks -> choose the webhook
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error(
      'Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local'
    );
  }

  // Get the headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error occured -- no svix headers', {
      status: 400,
    });
  }

  // Get the body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  // Verify the payload with the headers
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

  // if (eventType === 'user.created') {
  //   const { id, email_addresses, first_name, last_name, username } = evt.data;
  //   let githubUsername;
  //   let name;
  //   let email;
  //   // let id;
  //   const { userId } = await auth();
  //   // if (userId) {
  //   //   const client = await clerkClient();
  //   //   const user = await client.users.getUser(userId);
  //   //   githubUsername = user.username;
  //   //   email = user.emailAddresses[0].emailAddress;
  //   //   if (user.firstName && user.lastName) {
  //   //     name = `${user.firstName} ${user.lastName}`;
  //   //   } else if (user.firstName === null && user.lastName === null) {
  //   //     name = user.username;
  //   //   }
  //   //   id = user.id;
      
  //   // }
  //   await prisma.user.create({
  //       data: {
  //         clerkUserId: id,
  //         email: email,
  //         name: name,
  //         githubUsername: githubUsername || '',
  //       },
  //     });
  // }
  if (eventType === 'user.created') {
    const { id, email_addresses, first_name, last_name, username } = evt.data;
    
    // Ensure githubUsername is properly extracted and not null/undefined
    const githubUsername = username || '';
    
    // Construct the display name
    let name;
    if(!first_name && !last_name) {
      // If no first/last name, use the GitHub username as the display name
      name = githubUsername || 'Unknown User';
    } else {
      // Construct name from first and last name
      name = `${first_name || ''} ${last_name || ''}`.trim();
    }
    
    // Ensure we have required fields before creating user
    const email = email_addresses?.[0]?.email_address;
    
    if (!email) {
      console.error('No email address found in webhook data');
      return new Response('Missing email address', { status: 400 });
    }
    
    try {
      // Create user in Neon PostgreSQL database
      const newUser = await prisma.user.create({
        data: {
          clerkUserId: id,
          email: email,
          name: name,
          githubUsername: githubUsername, // This will be sent to Neon PostgreSQL
        },
      });
      
      console.log('User created successfully:', {
        id: newUser.id,
        clerkUserId: newUser.clerkUserId,
        email: newUser.email,
        name: newUser.name,
        githubUsername: newUser.githubUsername, // Verify it was stored
      });
      
    } catch (error) {
      console.error('Error creating user in database:', error);
      return new Response('Database error', { status: 500 });
    }
  }

  return new Response('', { status: 201 });
}
