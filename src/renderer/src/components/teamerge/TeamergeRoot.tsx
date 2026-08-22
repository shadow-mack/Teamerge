import React, { useEffect } from 'react'
import { useAppStore } from '@/store'
import { useTeamergeSync } from './use-teamerge-sync'
import { KeystrokeApprovalStack } from './KeystrokeApprovalStack'

/** App-wide Teamerge presence: keeps the team in sync and surfaces keystroke approvals anywhere. */
export default function TeamergeRoot(): React.JSX.Element {
  useTeamergeSync()
  const openTeamPage = useAppStore((s) => s.openTeamPage)
  useEffect(() => {
    const open = (): void => openTeamPage()
    window.addEventListener('teamerge:open', open)
    return () => window.removeEventListener('teamerge:open', open)
  }, [openTeamPage])
  return <KeystrokeApprovalStack />
}
