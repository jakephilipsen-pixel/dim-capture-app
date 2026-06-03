import { RouterProvider } from 'react-router-dom'

import { SyncManager } from '@/components/SyncManager'
import { OfflineQueueProvider } from '@/context/OfflineQueueContext'
import { ProgressProvider } from '@/context/ProgressContext'
import { router } from '@/router'

export function App() {
  return (
    <ProgressProvider>
      <OfflineQueueProvider>
        <SyncManager />
        <RouterProvider router={router} />
      </OfflineQueueProvider>
    </ProgressProvider>
  )
}
