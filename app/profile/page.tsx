import React from 'react'
import Avatar from '@/components/avatar/avatar'
import ContributionGraph from '@/components/contribution-graph/contribution-graph'
import CommitHistory from '@/components/commit-history/commit-history'
import AchievementsPanel from '@/components/achievements/achievements-panel'

export default function page() {
  return (
    <div>
      <Avatar />
  <ContributionGraph />
  <AchievementsPanel />
      <CommitHistory />
    </div>
  )
}
