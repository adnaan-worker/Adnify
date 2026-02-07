/**
 * 情绪环境光效
 * 在编辑器区域周围产生微妙的光晕效果
 * 用户能感知到氛围变化，但完全不会遮挡内容
 *
 * 放置在编辑器容器内，使用 pointer-events-none
 */

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { EmotionState } from '@/renderer/agent/types/emotion'
import { useEmotionState } from '@/renderer/hooks/useEmotionState'
import { EMOTION_COLORS } from '@/renderer/agent/emotion'

const GLOW_CONFIG: Record<EmotionState, {
  opacity: number
  spread: number
  animated: boolean
  corners: ('tl' | 'tr' | 'bl' | 'br')[]
}> = {
  focused:    { opacity: 0.06,  spread: 200, animated: false, corners: ['tl', 'br'] },
  frustrated: { opacity: 0.08,  spread: 250, animated: true,  corners: ['tl', 'tr', 'bl', 'br'] },
  tired:      { opacity: 0.05,  spread: 300, animated: true,  corners: ['bl', 'br'] },
  excited:    { opacity: 0.07,  spread: 180, animated: true,  corners: ['tl', 'tr'] },
  bored:      { opacity: 0.03,  spread: 150, animated: false, corners: ['br'] },
  stressed:   { opacity: 0.07,  spread: 220, animated: true,  corners: ['tl', 'tr', 'bl', 'br'] },
  flow:       { opacity: 0.05,  spread: 250, animated: true,  corners: ['tl', 'br'] },
  neutral:    { opacity: 0,     spread: 0,   animated: false, corners: [] },
}

const cornerPositions = {
  tl: { top: 0, left: 0, background: (color: string, spread: number, opacity: number) =>
    `radial-gradient(circle at top left, ${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent ${spread}px)` },
  tr: { top: 0, right: 0, background: (color: string, spread: number, opacity: number) =>
    `radial-gradient(circle at top right, ${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent ${spread}px)` },
  bl: { bottom: 0, left: 0, background: (color: string, spread: number, opacity: number) =>
    `radial-gradient(circle at bottom left, ${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent ${spread}px)` },
  br: { bottom: 0, right: 0, background: (color: string, spread: number, opacity: number) =>
    `radial-gradient(circle at bottom right, ${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent ${spread}px)` },
}

export const EmotionAmbientGlow: React.FC = () => {
  const emotion = useEmotionState()

  const state = emotion?.state || 'neutral'
  const config = { ...GLOW_CONFIG[state], color: EMOTION_COLORS[state] }
  const intensity = emotion?.intensity ?? 0

  // neutral 或 0 强度不渲染
  if (state === 'neutral' || intensity === 0 || config.opacity === 0) return null

  // 实际透明度 = 基础透明度 * 强度
  const effectiveOpacity = config.opacity * Math.max(intensity, 0.3)

  return (
    <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5 }}
        >
          {config.corners.map((corner) => {
            const pos = cornerPositions[corner]
            return (
              <motion.div
                key={corner}
                className="absolute"
                style={{
                  width: config.spread * 2,
                  height: config.spread * 2,
                  ...Object.fromEntries(
                    Object.entries(pos).filter(([key]) => key !== 'background')
                  ),
                  background: pos.background(config.color, config.spread, effectiveOpacity),
                }}
                animate={config.animated ? {
                  opacity: [1, 0.6, 1],
                  scale: [1, 1.05, 1],
                } : undefined}
                transition={config.animated ? {
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                } : undefined}
              />
            )
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
