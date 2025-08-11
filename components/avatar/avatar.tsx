import Image from 'next/image';
import React from 'react';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { checkRole } from '@/utils/roles';

export default async function Avatar() {
  const { userId } = await auth();

  if (!userId) {
    // This case should ideally be handled by the middleware,
    // but it's a good practice for robustness.
    return (
      <div className='p-8'>
        <p>You must be signed in to view this page.</p>
      </div>
    );
  }
  const isAdmin = await checkRole('admin');
  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  const userImage = user.imageUrl ?? '/avatar.png';
  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  const displayName = fullName || user.username || 'User';
  const handle = user.username ? `@${user.username}` : '';

  console.log(userImage, fullName, displayName, handle);
  return (
    // Add flex and items-end here
    <div>
      <div className='max-h-54 w-full bg-gray-700' />
      <Image
        src='/background.avif'
        alt='background'
        width={1640}
        height={664}
        // sizes='100vw'
        className='w-full h-54 object-cover'
      />

      <div className='border-t-4 px-24'>
        <div className='relative flex items-end justify-between space-x-3'>
          <div className='flex flex-row space-x-4'>
            <div className='-mt-12'>
              <Image
                width={128}
                height={128}
                src={userImage}
                alt={`${displayName}'s avatar`}
                className='h-32 w-32 rounded-full border-4 border-white bg-gray-200 dark:border-gray-900'
              />
            </div>
            <div className='pb-2 mt-3 space-y-1 '>
              <h1 className='text-2xl font-bold'>{displayName}</h1>
              {handle && <p className='text-sm text-gray-500'>{handle}</p>}
            </div>
          </div>

          <div className='mb-8'>
            <p>You are {isAdmin ? 'an admin' : 'a user'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
