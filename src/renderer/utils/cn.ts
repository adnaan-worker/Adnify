/**
 * 合并 className 的工具函数
 * 用于条件性地合并 Tailwind CSS 类名
 */

type ClassValue = string | number | boolean | undefined | null | Record<string, boolean> | ClassValue[]

/**
 * 合并 className 的工具函数
 * 支持字符串、对象、数组等多种格式
 */
export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = []

  for (const input of inputs) {
    if (!input) continue

    if (typeof input === 'string') {
      classes.push(input)
    } else if (typeof input === 'number') {
      classes.push(String(input))
    } else if (Array.isArray(input)) {
      const inner = cn(...input)
      if (inner) classes.push(inner)
    } else if (typeof input === 'object') {
      for (const key in input) {
        if (input[key]) {
          classes.push(key)
        }
      }
    }
  }

  return classes.filter(Boolean).join(' ')
}
