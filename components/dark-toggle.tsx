'use client';
import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <div className='fixed bottom-4 right-4 z-50 flex items-center justify-center rounded-full bg-background/80 p-1 backdrop-blur-md transition-all hover:bg-background/90 dark:bg-background/80 dark:hover:bg-background/90'>
      <Button variant='outline' size='icon' onClick={toggleTheme}>
        <Sun className='h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90' />
        <Moon className='absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0' />
        <span className='sr-only'>Toggle theme</span>
      </Button>
    </div>
  );
}
