import Link from 'next/link';
import { Button } from '../ui/button';
import { Logo } from './logo';
import { NavMenu } from './nav-menu';
import { NavigationSheet } from './navigation-sheet';
import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';

const Navbar04Page = () => {
  return (
    <nav className='h-16 w-full bg-background shadow-xs shadow-neutral-900 border dark:border-slate-700'>
      <div className='h-full flex items-center justify-between mx-auto px-6'>
        <Link href='/'>
          <Logo className='h-7 w-7 mb-1' />
        </Link>

        {/* Desktop Menu */}
        <NavMenu className='hidden md:block' />

        <div className='flex items-center gap-3'>
          <SignedOut>
            <SignInButton>
              <Button className='cursor-pointer rounded-full'>Sign In</Button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>

          {/* Mobile Menu */}
          <div className='md:hidden'>
            <NavigationSheet />
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar04Page;
