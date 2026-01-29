/**
 * React 性能优化 Hooks
 * 提供常用的性能优化工具
 */

import { useCallback, useRef, useEffect } from 'react'

/**
 * 优化的事件监听器 Hook
 * 自动管理监听器的添加和移除，避免重复添加
 * 
 * @example
 * ```tsx
 * useEventListener('keydown', (e) => {
 *   if (e.key === 'Escape') closeModal()
 * })
 * ```
 */
export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  element: Window | HTMLElement | null = window,
  options?: AddEventListenerOptions
) {
  const savedHandler = useRef(handler)

  // 更新 handler 引用，但不触发重新添加监听器
  useEffect(() => {
    savedHandler.current = handler
  }, [handler])

  useEffect(() => {
    if (!element) return

    const eventListener = (event: Event) => {
      savedHandler.current(event as WindowEventMap[K])
    }

    element.addEventListener(eventName, eventListener, options)
    return () => element.removeEventListener(eventName, eventListener, options)
  }, [eventName, element, options])
}

/**
 * 防抖 Hook
 * 延迟执行函数，在指定时间内多次调用只执行最后一次
 * 
 * @example
 * ```tsx
 * const debouncedSearch = useDebounce((query: string) => {
 *   searchAPI(query)
 * }, 500)
 * ```
 */
export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout>()
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args)
    }, delay)
  }, [delay]) as T
}

/**
 * 节流 Hook
 * 限制函数执行频率，在指定时间内最多执行一次
 * 
 * @example
 * ```tsx
 * const throttledScroll = useThrottle((e: Event) => {
 *   handleScroll(e)
 * }, 100)
 * ```
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRun = useRef(Date.now())
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now()
    if (now - lastRun.current >= delay) {
      callbackRef.current(...args)
      lastRun.current = now
    }
  }, [delay]) as T
}

/**
 * 稳定的 useCallback
 * 使用 useRef 避免依赖项变化导致的重新创建
 * 
 * @example
 * ```tsx
 * const handleClick = useStableCallback(() => {
 *   // 可以安全地使用最新的 props 和 state
 *   console.log(someState)
 * })
 * ```
 */
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  })

  return useCallback((...args: Parameters<T>) => {
    return callbackRef.current(...args)
  }, []) as T
}

/**
 * 点击外部关闭 Hook
 * 支持单个 ref（返回 ref）或多个 refs（传入数组）
 * 常用于模态框、下拉菜单等组件
 * 
 * @example
 * ```tsx
 * // 用法 1: 自动创建 ref
 * const ref = useClickOutside(() => {
 *   setIsOpen(false)
 * })
 * return <div ref={ref}>...</div>
 * 
 * // 用法 2: 传入多个已有的 refs
 * useClickOutside(() => setIsOpen(false), true, [menuRef, buttonRef])
 * ```
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: () => void,
  enabled: boolean = true,
  externalRefs?: React.RefObject<HTMLElement>[]
) {
  const internalRef = useRef<T>(null)
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      
      // 如果提供了外部 refs，检查所有 refs
      if (externalRefs && externalRefs.length > 0) {
        // 检查点击是否在任何一个 ref 内部
        const isInside = externalRefs.some(
          ref => ref.current && ref.current.contains(target)
        )
        // 只有当点击不在任何 ref 内部时才关闭
        if (!isInside) {
          handlerRef.current()
        }
      } 
      // 否则使用内部 ref
      else if (internalRef.current && !internalRef.current.contains(target)) {
        handlerRef.current()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [enabled, externalRefs])

  return internalRef
}

/**
 * ESC 键关闭 Hook
 * 常用于模态框、下拉菜单等组件
 * 
 * @example
 * ```tsx
 * useEscapeKey(() => {
 *   setIsOpen(false)
 * })
 * ```
 */
export function useEscapeKey(handler: () => void, enabled: boolean = true) {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handlerRef.current()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [enabled])
}

/**
 * 组合 useClickOutside 和 useEscapeKey
 * 
 * @example
 * ```tsx
 * const ref = useCloseOnOutsideOrEscape(() => {
 *   setIsOpen(false)
 * }, isOpen)
 * 
 * return <div ref={ref}>...</div>
 * ```
 */
export function useCloseOnOutsideOrEscape<T extends HTMLElement = HTMLElement>(
  handler: () => void,
  enabled: boolean = true
) {
  const ref = useClickOutside<T>(handler, enabled)
  useEscapeKey(handler, enabled)
  return ref
}

/**
 * 防抖值 Hook
 * 延迟更新值，常用于搜索输入
 * 
 * @example
 * ```tsx
 * const [searchQuery, setSearchQuery] = useState('')
 * const debouncedQuery = useDebouncedValue(searchQuery, 500)
 * 
 * useEffect(() => {
 *   // 只在 debouncedQuery 变化时搜索
 *   searchAPI(debouncedQuery)
 * }, [debouncedQuery])
 * ```
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(timeout)
  }, [value, delay])

  return debouncedValue
}

/**
 * 上一次的值 Hook
 * 保存上一次渲染的值
 * 
 * @example
 * ```tsx
 * const prevCount = usePrevious(count)
 * console.log(`Count changed from ${prevCount} to ${count}`)
 * ```
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>()

  useEffect(() => {
    ref.current = value
  }, [value])

  return ref.current
}

/**
 * 挂载状态 Hook
 * 检查组件是否已挂载，避免在卸载后更新状态
 * 
 * @example
 * ```tsx
 * const isMounted = useIsMounted()
 * 
 * const fetchData = async () => {
 *   const data = await api.getData()
 *   if (isMounted()) {
 *     setData(data)
 *   }
 * }
 * ```
 */
export function useIsMounted(): () => boolean {
  const isMountedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  return useCallback(() => isMountedRef.current, [])
}

// 导入 useState 用于 useDebouncedValue
import { useState } from 'react'
