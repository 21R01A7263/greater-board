import React from 'react'
import Avatar from '@/components/avatar/avatar'
import ContributionGraph from '@/components/contribution-graph/contribution-graph'
import CommitHistory from '@/components/commit-history/commit-history'

export default function page() {
  return (
    <div>
      <Avatar />
      <ContributionGraph />
      <CommitHistory />
    </div>
  )
}
