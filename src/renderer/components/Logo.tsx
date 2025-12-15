import React from 'react'

export function Logo({ className = "w-6 h-6", glow = false }: { className?: string; glow?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} ${glow ? 'drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]' : ''}`}
    >
      {/* 字母 A 的左腿 - 电路风格 */}
      <path
        d="M20 90 L40 30"
        stroke="url(#gradientA)"
        strokeWidth="12"
        strokeLinecap="round"
      />
      
      {/* 字母 A 的右腿 - 断开连接 */}
      <path
        d="M60 30 L80 90"
        stroke="url(#gradientA)"
        strokeWidth="12"
        strokeLinecap="round"
      />

      {/* 核心连接点 (横杠替换为节点) */}
      <circle cx="50" cy="55" r="8" fill="#3b82f6" className="animate-pulse-slow">
        <animate attributeName="opacity" values="0.8;1;0.8" dur="3s" repeatCount="indefinite" />
      </circle>
      
      {/* 连线 - 左到中 */}
      <path d="M32 55 L42 55" stroke="#60a5fa" strokeWidth="6" strokeLinecap="round" />
      
      {/* 连线 - 中到右 */}
      <path d="M58 55 L68 55" stroke="#60a5fa" strokeWidth="6" strokeLinecap="round" />

      {/* 顶部顶点装饰 */}
      <circle cx="50" cy="20" r="5" fill="#a855f7" />

      <defs>
        <linearGradient id="gradientA" x1="20" y1="90" x2="80" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </svg>
  )
}
