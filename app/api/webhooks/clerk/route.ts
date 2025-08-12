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
    const { id, email_addresses, first_name, last_name } = evt.data;
    let githubUsername = null;
    let name;
    if(first_name == 'null' && last_name == 'null') {
            name = githubUsername;
    }
    else{
      name = `${first_name} ${last_name}`.trim();
    }    
      const { userId } = await auth();
      if (userId) {
        const client = await clerkClient();
        const user = await client.users.getUser(userId);
        githubUsername = user.username;
      }       
      await prisma.user.create({
        data: {
          clerkUserId: id,
          email: email_addresses[0]?.email_address,
          
          name: name,
          githubUsername: githubUsername ?? '',
        },
      });    
  }

  return new Response('', { status: 201 });
}
