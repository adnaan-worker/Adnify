import React from 'react'

export function Logo({ className = "w-6 h-6", glow = false }: { className?: string; glow?: boolean }) {
  return (
    <img
      src="/icon.png"
      alt="Adnify"
      className={`${className} ${glow ? 'drop-shadow-[0_0_8px_rgba(139,92,246,0.6)]' : ''}`}
    />
  )
}
