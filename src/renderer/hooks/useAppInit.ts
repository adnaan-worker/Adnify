/**
 * 应用初始化 Hook
 */
import { useEffect, useRef, useCallback } from 'react'
import { api } from '@renderer/services/electronAPI'
import { initializeApp, registerSettingsSync, registerAppErrorListener } from '@renderer/services/initService'
import { initWorkspaceStateSync } from '@renderer/services/workspaceStateService'

interface InitResult {
  shouldShowOnboarding: boolean
}

interface UseAppInitOptions {
  onInitialized?: (result: InitResult) => void
}

export function useAppInit(options: UseAppInitOptions = {}) {
  const initRef = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const updateLoaderStatus = useCallback((status: string) => {
    const statusEl = document.querySelector('#initial-loader .loader-status')
    if (statusEl) statusEl.textContent = status
  }, [])

  const removeInitialLoader = useCallback(() => {
    const loader = document.getElementById('initial-loader')
    const root = document.getElementById('root')

    if (root) root.classList.add('ready')

    if (loader) {
      requestAnimationFrame(() => {
        loader.classList.add('fade-out')
        setTimeout(() => loader.remove(), 300)
      })
    }
  }, [])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    const init = async () => {
      const result = await initializeApp(updateLoaderStatus)

      // 注册设置同步
      const unsubscribeSettings = registerSettingsSync()
      window.__settingsUnsubscribe = unsubscribeSettings

      // 注册主进程错误监听
      const unsubscribeError = registerAppErrorListener()
      window.__errorUnsubscribe = unsubscribeError

      // 短暂延迟后完成初始化
      setTimeout(() => {
        removeInitialLoader()
        api.appReady()
        optionsRef.current.onInitialized?.(result)
      }, 50)
    }

    init()

    return () => {
      const unsubscribeSettings = window.__settingsUnsubscribe
      if (unsubscribeSettings) {
        unsubscribeSettings()
        delete window.__settingsUnsubscribe
      }
      const unsubscribeError = window.__errorUnsubscribe
      if (unsubscribeError) {
        unsubscribeError()
        delete window.__errorUnsubscribe
      }
    }
  }, [updateLoaderStatus, removeInitialLoader])

  // 初始化工作区状态同步
  useEffect(() => {
    return initWorkspaceStateSync()
  }, [])
}
