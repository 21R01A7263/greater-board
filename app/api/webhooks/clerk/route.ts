import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { clerkClient, WebhookEvent } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { NextRequest } from 'next/server';

// Assuming getContributionData is moved to a separate utility file
// For example: '@/lib/github.ts'
// As a temporary measure, the function is copied here.
// NOTE: It is highly recommended to move getContributionData to a separate file.

interface ContributionDay {
  contributionCount: number;
  date: string;
  weekday: number;
  color: string;
}

// Function to generate a date string in YYYY-MM-DD format
function formatDateToISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Function to create a default contribution day
function createDefaultDay(date: Date): ContributionDay {
  return {
    contributionCount: 0,
    date: formatDateToISO(date),
    weekday: date.getDay(),
    color: '#fcfcfc', // GitHub's default color for 0 contributions
  };
}

// Function to pad contribution data to ensure we have exactly 60 days
function padContributionData(
  contributionDays: ContributionDay[],
  targetDays: number = 60
): ContributionDay[] {
  if (contributionDays.length >= targetDays) {
    return contributionDays.slice(-targetDays);
  }

  const paddedData: ContributionDay[] = [];
  const today = new Date();

  // Calculate how many days we need to pad
  const daysToAdd = targetDays - contributionDays.length;

  // Add padding days at the beginning
  for (let i = daysToAdd - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - (targetDays - 1) + (daysToAdd - 1 - i));
    paddedData.push(createDefaultDay(date));
  }

  // Add the actual contribution data
  paddedData.push(...contributionDays);

  return paddedData;
}
async function getContributionData(
  token: string,
  from: string,
  to: string
): Promise<ContributionDay[] | null> {
  const headers = {
    Authorization: `bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const body = {
    query: `
      query($from: DateTime!, $to: DateTime!) {
        viewer {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks {
                contributionDays {
                  contributionCount
                  date
                  weekday
                  color
                }
              }
            }
          }
        }
      }
    `,
    variables: {
      from,
      to,
    },
  };
  try {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error('Failed to fetch contribution data:', response.statusText);
      return null;
    }
    const data = await response.json();
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return null;
    }
    const calendar =
      data.data?.viewer?.contributionsCollection?.contributionCalendar;
    if (!calendar) {
      console.error('No calendar data found');
      return null;
    }
    const allDays: ContributionDay[] = [];
    calendar.weeks.forEach((week: { contributionDays: ContributionDay[] }) => {
      allDays.push(...week.contributionDays);
    });
    return padContributionData(allDays);
  } catch (error) {
    console.error('Error fetching contribution data:', error);
    return null;
  }
}

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

      // New feature implementation: Fetch and store initial contribution data
      try {
        // Initialize Clerk client instance
        const clerk = await clerkClient();
        const clerkResponse = await clerk.users.getUserOauthAccessToken(
          id,
          'github'
        );
        const githubToken = clerkResponse.data?.[0]?.token;

        if (githubToken) {
          const to = new Date();
          const from = new Date();
          from.setDate(to.getDate() - 60);
          const contributionDays = await getContributionData(
            githubToken,
            from.toISOString(),
            to.toISOString()
          );

          if (contributionDays) {
            await prisma.contribution.createMany({
              data: contributionDays.map((day) => ({
                date: new Date(day.date),
                count: day.contributionCount,
                userId: newUser.id,
              })),
            });

            await prisma.user.update({
              where: { id: newUser.id },
              data: { contributionsLastTracked: to },
            });
          }
        }
      } catch (error) {
        console.error('Error fetching initial contribution data:', error);
        // Do not block user creation if this fails
      }
    } catch (error) {
      console.error('Error creating user in database:', error);
      return new Response('Database error', { status: 500 });
    }
  }

  return new Response('', { status: 201 });
}