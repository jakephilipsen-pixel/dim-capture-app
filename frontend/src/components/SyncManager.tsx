import { useSync } from '@/hooks/useSync'

/**
 * Headless component that runs the background sync loop for the whole app
 * (drain offline queue + push to CC). Mounted once in App, inside both the
 * ProgressProvider and OfflineQueueProvider. Renders nothing.
 */
export function SyncManager() {
  useSync()
  return null
}
