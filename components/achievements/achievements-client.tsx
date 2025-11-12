"use client";
import React from 'react';
import { Button } from '@/components/ui/button';

export type Earned = { key: string; name: string; description?: string; earnedAt?: string; category?: string; tier?: number };
export type Hint = { title: string; hint: string };
export type CatalogItem = { key: string; name: string; description?: string; category?: string; tier?: number };

export default function AchievementsClient({
  achievements,
  nextUp,
  catalog,
  progressByKey,
  currentStreak,
  longestStreak,
}: {
  achievements: Earned[];
  nextUp: Hint[];
  catalog: CatalogItem[];
  progressByKey: Record<string, string>;
  currentStreak: number;
  longestStreak: number;
}) {
  const [open, setOpen] = React.useState(false);
  const earnedKeys = new Set(achievements.map(a => a.key));

  // Group catalog by category for modal sections
  const groups = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    const cat = item.category || 'other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(item);
  }
  // Define a helpful display order
  const order = ['streak', 'time', 'week', 'month', 'repos', 'cadence', 'lifetime', 'peak', 'year', 'commit', 'other'];
  const orderedCats = Array.from(groups.keys()).sort((a,b)=> order.indexOf(a) - order.indexOf(b));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold">Streak</span>: {currentStreak} • <span className="font-semibold">Longest</span>: {longestStreak}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>View more</Button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-[92vw] max-w-3xl max-h-[85vh] overflow-auto rounded-2xl border bg-white dark:bg-background dark:border-gray-700 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">All achievements</h3>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
            </div>

            {orderedCats.map((cat) => (
              <div key={cat} className="mb-6">
                <h4 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">{labelForCategory(cat)}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {groups.get(cat)!.map((item) => {
                    const earned = earnedKeys.has(item.key);
                    const progress = progressByKey[item.key] ?? (earned ? 'Earned' : '—');
                    return (
                      <div key={item.key} className={`p-3 rounded-md border ${earned ? 'border-emerald-400/50 bg-emerald-50 dark:bg-emerald-950/30' : 'dark:border-gray-700'}`}>
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-sm">{item.name}</div>
                          {earned && <span className="text-xs text-emerald-700 dark:text-emerald-300">✓</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{item.description}</div>
                        <div className="text-xs mt-1"><span className="font-semibold">Progress:</span> {progress}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function labelForCategory(cat: string) {
  switch (cat) {
    case 'streak': return 'Streaks (daily)';
    case 'time': return 'Time of day (weekly)';
    case 'week': return 'Weekly goals';
    case 'month': return 'Monthly goals';
    case 'repos': return 'Repository variety & loyalty';
    case 'cadence': return 'Cadence';
    case 'lifetime': return 'Lifetime';
    case 'peak': return 'Peak days';
    case 'year': return 'Yearly';
    case 'commit': return 'Commit message badges';
    default: return 'Other';
  }
}
