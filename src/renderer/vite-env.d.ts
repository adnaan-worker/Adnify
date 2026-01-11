/// <reference types="vite/client" />

import type { useStore } from './store'

declare global {
  interface Window {
    __ADNIFY_STORE__: {
      getState: typeof useStore.getState
    }
    __settingsUnsubscribe?: () => void
    __errorUnsubscribe?: () => void
    electronAPI?: {
      invalidateProviders?: () => void
    }
  }

  var __PROD__: boolean
}

export {}
