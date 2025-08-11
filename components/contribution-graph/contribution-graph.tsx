// src/app/dashboard/contribution-graph.tsx
export const revalidate = 7200;
import { auth, clerkClient } from '@clerk/nextjs/server';

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
    color: '#fcfcfc' // GitHub's default color for 0 contributions
  };
}

// Function to pad contribution data to ensure we have exactly 60 days
function padContributionData(contributionDays: ContributionDay[], targetDays: number = 60): ContributionDay[] {
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

// Function to fetch contribution data for the last 60 days
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

    const calendar = data.data?.viewer?.contributionsCollection?.contributionCalendar;
    
    if (!calendar) {
      console.error('No calendar data found');
      return null;
    }

    // let allDays: ContributionDay[] = [];
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

// Component to render the contribution graph
const ContributionGraph = async () => {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div className='relative w-full max-w-2xl mx-auto'>
        <div className='absolute inset-0 bg-gradient-to-r from-blue-100 via-purple-50 to-pink-100 rounded-2xl blur-sm opacity-60'></div>
        <div className='relative bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-gray-200/50 mt-8'>
          <div className='flex items-center gap-3 mb-6'>
            <div className='w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg'>
              <svg className='w-5 h-5 text-white' fill='currentColor' viewBox='0 0 20 20'>
                <path fillRule='evenodd' d='M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z' clipRule='evenodd' />
              </svg>
            </div>
            <h2 className='text-2xl font-bold bg-gradient-to-r from-gray-700 to-gray-900 bg-clip-text text-transparent'>
              Contribution Activity
            </h2>
          </div>
          <div className='flex items-center justify-center py-12'>
            <div className='text-center'>
              <div className='w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center'>
                <svg className='w-8 h-8 text-blue-600' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' />
                </svg>
              </div>
              <h3 className='font-semibold text-gray-800 mb-2'>Authentication Required</h3>
              <p className='text-gray-600'>Please sign in to view your GitHub contribution history</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 60);

  const toISO = to.toISOString();
  const fromISO = from.toISOString();

  try {
    const client = await clerkClient();
    const clerkResponse = await client.users.getUserOauthAccessToken(
      userId,
      'github'
    );

    const githubToken = clerkResponse.data?.[0]?.token;

    if (!githubToken) {
      return (
        <div className='relative w-full max-w-2xl mx-auto'>
          <div className='absolute inset-0 bg-gradient-to-r from-orange-100 via-red-50 to-pink-100 rounded-2xl blur-sm opacity-60'></div>
          <div className='relative bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-gray-200/50 mt-8'>
            <div className='flex items-center gap-3 mb-6'>
              <div className='w-10 h-10 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center shadow-lg'>
                <svg className='w-5 h-5 text-white' fill='currentColor' viewBox='0 0 24 24'>
                  <path d='M12 0C5.374 0 0 5.373 0 12s5.374 12 12 12 12-5.373 12-12S18.626 0 12 0zm5.568 8.16l-6.568 6.568-6.568-6.568 1.414-1.414L12 12.9l6.154-6.154 1.414 1.414z'/>
                </svg>
              </div>
              <h2 className='text-2xl font-bold bg-gradient-to-r from-gray-700 to-gray-900 bg-clip-text text-transparent'>
                Contribution Activity
              </h2>
            </div>
            <div className='flex items-center justify-center py-12'>
              <div className='text-center'>
                <div className='w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-orange-100 to-orange-200 rounded-2xl flex items-center justify-center'>
                  <svg className='w-8 h-8 text-orange-600' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' />
                  </svg>
                </div>
                <h3 className='font-semibold text-gray-800 mb-2'>GitHub Connection Required</h3>
                <p className='text-gray-600'>Please reconnect your GitHub account to view contribution data</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const contributionDays = await getContributionData(
      githubToken,
      fromISO,
      toISO
    );

    if (!contributionDays || contributionDays.length === 0) {
      return (
        <div className='relative w-full max-w-2xl mx-auto'>
          <div className='absolute inset-0 bg-gradient-to-r from-gray-100 via-slate-50 to-gray-100 rounded-2xl blur-sm opacity-60'></div>
          <div className='relative bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-gray-200/50 mt-8'>
            <div className='flex items-center gap-3 mb-6'>
              <div className='w-10 h-10 bg-gradient-to-br from-gray-400 to-gray-600 rounded-xl flex items-center justify-center shadow-lg'>
                <svg className='w-5 h-5 text-white' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' />
                </svg>
              </div>
              <h2 className='text-2xl font-bold bg-gradient-to-r from-gray-700 to-gray-900 bg-clip-text text-transparent'>
                Contribution Activity
              </h2>
            </div>
            <div className='flex items-center justify-center py-12'>
              <div className='text-center'>
                <div className='w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex items-center justify-center'>
                  <svg className='w-8 h-8 text-gray-500' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707' />
                  </svg>
                </div>
                <h3 className='font-semibold text-gray-800 mb-2'>No Data Available</h3>
                <p className='text-gray-600'>Could not load contribution data. Please try again later</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Create a 10x6 grid of contribution days (60 total) - dates increment top to bottom
    const grid: ContributionDay[][] = [];
    for (let col = 0; col < 10; col++) {
      const column: ContributionDay[] = [];
      for (let row = 0; row < 6; row++) {
        const index = col * 6 + row;
        if (index < contributionDays.length) {
          column.push(contributionDays[index]);
        }
      }
      grid.push(column);
    }

    // Calculate total contributions and streak info
    const totalContributions = contributionDays.reduce((sum, day) => sum + day.contributionCount, 0);
    const activeDays = contributionDays.filter(day => day.contributionCount > 0).length;
    const maxContributions = Math.max(...contributionDays.map(day => day.contributionCount));

    return (
      <div className='relative w-full max-w-xl mx-auto'>
        {/* Animated background gradient */}
        {/* <div className='absolute inset-0 bg-gradient-to-r from-emerald-100 via-teal-50 to-cyan-100 rounded-2xl blur-sm opacity-60 animate-pulse'></div> */}
        
        <div className='relative bg-white/90 dark:bg-background dark:border-2 dark:border-gray-600 backdrop-blur-sm p-8 rounded-2xl shadow-2xl border border-white/20 mt-8 overflow-hidden'>
          {/* Decorative elements */}
          {/* <div className='absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-green-300/30 to-emerald-300/30 rounded-full blur-xl -translate-y-1/2 translate-x-1/2'></div> */}
          {/* <div className='absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-teal-200/30 to-cyan-300/30 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2'></div> */}
          
          {/* Header */}
          <div className='relative flex items-center justify-between mb-6'>
            <div className='flex items-center gap-4'>
              
              <div>
                <h2 className='text-3xl font-bold text-primary dark:text-primary'>
                  Contribution Activity
                </h2>
                <p className='text-md pl-1 font-semibold mt-1'><span className='text-green-600'>{totalContributions}</span> contributions over <span className='text-blue-600'>{activeDays}</span> active days</p>
              </div>
            </div>
            
            {/* Stats cards */}
            {/* <div className='hidden md:flex gap-4'>
              <div className=' px-4 py-3 rounded-xl border border-green-200/50'>
                <div className='text-2xl font-bold text-green-700'>{totalContributions}</div>
                <div className='text-xs text-green-600'>Total</div>
              </div>
              <div className=' px-4 py-3 rounded-xl border border-blue-200/50'>
                <div className='text-2xl font-bold text-blue-700'>{activeDays}</div>
                <div className='text-xs text-blue-600'>Active Days</div>
              </div>
            </div> */}
          </div>

          {/* Mobile stats */}
          <div className='md:hidden flex gap-2 mb-6'>
            <div className='flex-1 bg-gradient-to-br from-green-50 to-emerald-100 p-4 rounded-xl border border-green-200/50'>
              <div className='text-2xl font-bold text-green-700'>{totalContributions}</div>
              <div className='text-sm text-green-600'>Total Contributions</div>
            </div>
            <div className='flex-1 bg-gradient-to-br from-blue-50 to-cyan-100 p-4 rounded-xl border border-blue-200/50'>
              <div className='text-2xl font-bold text-blue-700'>{activeDays}</div>
              <div className='text-sm text-blue-600'>Active Days</div>
            </div>
          </div>

          {/* Contribution Grid */}
          <div className='relative'>
            <div className='flex gap-2 py-8 px-4 rounded-xl border border-gray-300/90 dark:border-gray-600 justify-center'>
              {grid.map((column, colIndex) => (
                <div key={colIndex} className='flex flex-col gap-2'>
                  {column.map((day, rowIndex) => {
                    const intensity = day.contributionCount === 0 ? 0 : Math.min(4, Math.ceil((day.contributionCount / Math.max(maxContributions, 1)) * 4));
                    const shadowIntensity = intensity > 0 ? 'shadow-sm' : 'shadow-sm';
                    
                    return (
                      <div
                        key={rowIndex}
                        className={`w-8 h-8 rounded-lg  hover:scale-105 hover:rotate-2 hover:shadow-lg transition-all cursor-pointer shadow-slate-400/60 ${shadowIntensity} hover:z-10 relative group`}
                        style={{ 
                          backgroundColor: day.color,
                          // boxShadow: intensity > 0 ? `0 4px 8px ${day.color}20` : undefined
                        }}
                      >
                        {/* Tooltip */}
                        <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 group-hover:opacity-100  whitespace-nowrap z-50 pointer-events-none'>
                          <div className='font-semibold'>{day.contributionCount} contribution{day.contributionCount !== 1 ? 's' : ''}</div>
                          <div className='text-gray-300'>
                            {new Date(day.date).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </div>
                          <div className='absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900'></div>
                        </div>
                        
                        {/* Shine effect for active days */}
                        {/* {intensity > 0 && (
                          <div className='absolute inset-0 bg-gradient-to-br from-black/20 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300'></div>
                        )} */}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            
            {/* Legend */}
            <div className='flex items-center justify-center mt-4 px-2'>
              <span className='text-sm text-gray-600 font-medium pr-4 dark:text-primary'>Less</span>
              <div className='flex items-center gap-1'>
                {[
                  { color: '#fcfcfc', label: '0' },
                  { color: '#9be9a8', label: '1-2' },
                  { color: '#40c463', label: '3-5' },
                  { color: '#30a14e', label: '6-8' },
                  { color: '#216e39', label: '9+' }
                ].map((item, index) => (
                  <div key={index} className='group relative'>
                    <div 
                      className='w-4 h-4 rounded-md border-2 border-black/40 dark:border-primary-foreground shadow-sm hover:scale-125 transition-transform'
                      style={{ backgroundColor: item.color }}
                    />
                    {/* <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none'>
                      {item.label}
                    </div> */}
                  </div>
                ))}
              </div>
              <span className='text-sm text-gray-600 font-medium pl-4 dark:text-primary'>More</span>
            </div>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error in ContributionGraph:', error);
    return (
      <div className='relative w-full max-w-2xl mx-auto'>
        <div className='absolute inset-0 bg-gradient-to-r from-red-100 via-pink-50 to-red-100 rounded-2xl blur-sm opacity-60'></div>
        <div className='relative bg-white/80 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-gray-200/50 mt-8'>
          <div className='flex items-center gap-3 mb-6'>
            <div className='w-10 h-10 bg-gradient-to-br from-red-400 to-red-600 rounded-xl flex items-center justify-center shadow-lg'>
              <svg className='w-5 h-5 text-white' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' />
              </svg>
            </div>
            <h2 className='text-2xl font-bold bg-gradient-to-r from-gray-700 to-gray-900 bg-clip-text text-transparent'>
              Contribution Activity
            </h2>
          </div>
          <div className='flex items-center justify-center py-12'>
            <div className='text-center'>
              <div className='w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-red-100 to-red-200 rounded-2xl flex items-center justify-center'>
                <svg className='w-8 h-8 text-red-600' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' />
                </svg>
              </div>
              <h3 className='font-semibold text-gray-800 mb-2'>Something Went Wrong</h3>
              <p className='text-gray-600'>An error occurred while loading contribution data</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
};

export default ContributionGraph;