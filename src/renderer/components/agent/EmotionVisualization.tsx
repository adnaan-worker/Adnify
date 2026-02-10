/**
 * 情绪可视化组件
 * 动态、有趣的视觉展示
 */

cimport React, { useId, useMemo } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import type { EmotionState, EmotionDetection } from '@/renderer/agent/types/emotion'
import { EMOTION_COLORS } from '@/renderer/agent/emotion'

interface EmotionVisualizationProps {
  emotion: EmotionDetection
  history: Array<{ timestamp: number; state: EmotionState; intensity: number }>
}

export const EmotionVisualization: React.FC<EmotionVisualizationProps> = ({
  emotion,
  history,
}) => {
  // 创建动态的粒子效果（仅初始化一次，避免每次渲染跳动）
  const particles = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    id: i,
    delay: i * 0.1,
    duration: 2 + Math.random() * 2,
    left: Math.random() * 100,
    top: Math.random() * 100,
    xOffset: Math.random() * 20 - 10,
  })), [])

  // 情绪强度映射到动画参数
  const intensity = useMotionValue(emotion.intensity)
  const springIntensity = useSpring(intensity, { stiffness: 100, damping: 10 })
  const scale = useTransform(springIntensity, [0, 1], [0.8, 1.2])
  const opacity = useTransform(springIntensity, [0, 1], [0.3, 1])

  // 更新强度值
  React.useEffect(() => {
    intensity.set(emotion.intensity)
  }, [emotion.intensity, intensity])

  const color = EMOTION_COLORS[emotion.state]

  return (
    <div className="relative w-full h-48 overflow-hidden rounded-xl bg-gradient-to-br from-black/20 to-black/40">
      {/* 背景粒子效果 */}
      <div className="absolute inset-0">
        {particles.map(particle => (
          <motion.div
            key={particle.id}
            className="absolute rounded-full"
            style={{
              width: 4,
              height: 4,
              backgroundColor: color,
              left: `${particle.left}%`,
              top: `${particle.top}%`,
            }}
            animate={{
              y: [0, -30, 0],
              x: [0, particle.xOffset, 0],
              opacity: [0, 0.8, 0],
              scale: [0, 1, 0],
            }}
            transition={{
              duration: particle.duration,
              repeat: Infinity,
              delay: particle.delay,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>

      {/* 中心情绪球 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          style={{
            scale,
            opacity,
          }}
          className="relative"
        >
          {/* 外圈光晕 */}
          <motion.div
            className="absolute inset-0 rounded-full blur-xl"
            style={{
              backgroundColor: color,
              width: 120,
              height: 120,
              left: '50%',
              top: '50%',
              x: '-50%',
              y: '-50%',
            }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />

          {/* 主球 */}
          <motion.div
            className="rounded-full shadow-2xl"
            style={{
              width: 80,
              height: 80,
              backgroundColor: color,
              boxShadow: `0 0 40px ${color}40`,
            }}
            animate={{
              rotate: [0, 360],
            }}
            transition={{
              duration: 20,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            {/* 内部光效 */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3), transparent 70%)`,
              }}
            />
          </motion.div>
        </motion.div>
      </div>

      {/* 情绪波动波形 */}
      <EmotionWaveform history={history.slice(-30)} color={color} />

      {/* 强度指示器 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-sm rounded-full">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs text-white/80 font-medium">
            {Math.round(emotion.intensity * 100)}%
          </span>
        </div>
      </div>
    </div>
  )
}

const EmotionWaveform: React.FC<{
  history: Array<{ timestamp: number; state: EmotionState; intensity: number }>
  color: string
}> = ({ history, color }) => {
  const gradientId = useId()
  if (history.length < 2) return null

  const width = 300
  const height = 60
  const padding = 10
  const points: Array<{ x: number; y: number }> = []

  history.forEach((item, index) => {
    const x = padding + (index / (history.length - 1)) * (width - padding * 2)
    const y = padding + (1 - item.intensity) * (height - padding * 2)
    points.push({ x, y })
  })

  // 生成SVG路径
  const pathData = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-[300px] h-[60px]">
      <svg width={width} height={height} className="overflow-visible">
        {/* 渐变定义 */}
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.8" />
            <stop offset="100%" stopColor={color} stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* 填充区域 */}
        <motion.path
          d={`${pathData} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`}
          fill={`url(#${gradientId})`}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />

        {/* 描边 */}
        <motion.path
          d={pathData}
          fill="none"
          stroke={color}
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />

        {/* 数据点 */}
        {points.map((point, index) => (
          <motion.circle
            key={index}
            cx={point.x}
            cy={point.y}
            r="3"
            fill={color}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: index * 0.05, type: 'spring' }}
          />
        ))}
      </svg>
    </div>
  )
}
