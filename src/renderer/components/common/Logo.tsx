import { useStore } from '@renderer/store'
import iconPng from '@renderer/assets/icon.png'
import dawnIconPng from '@renderer/assets/dawn_icon.png'

export function Logo({ className = "w-6 h-6", glow = false }: { className?: string; glow?: boolean }) {
  const { currentTheme } = useStore()
  const isDawn = currentTheme === 'dawn'

  return (
    <img
      src={isDawn ? dawnIconPng : iconPng}
      alt="Adnify"
      className={`${className} ${glow ? 'drop-shadow-[0_0_8px_rgba(var(--accent),0.6)]' : ''}`}
    />
  )
}
