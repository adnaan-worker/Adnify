import { useState, useEffect, useRef, useMemo } from 'react'

interface UseFluidTypewriterOptions {
    /** Base speed (chars per frame) - typical frame is ~16ms */
    baseSpeed?: number
    /** Speed multiplier based on remaining distance */
    accelerationFactor?: number
    /** Whether to enable fluid effect */
    enabled?: boolean
}

/**
 * A refined fluid typewriter hook.
 * Uses floating point arithmetic for sub-character smoothness and time-delta normalization.
 */
export const useFluidTypewriter = (
    content: string,
    isStreaming: boolean,
    options: UseFluidTypewriterOptions = {}
) => {
    const {
        baseSpeed = 0.5, // slightly slower base speed for smoother feel
        accelerationFactor = 0.1, // Adjusted for the new algorithm
        enabled = true
    } = options

    // If disabled, short-circuit
    if (!enabled) {
        return {
            displayedContent: content,
            isTyping: false
        }
    }

    // State
    const [displayedLength, setDisplayedLength] = useState(() => {
        // If we are definitely not streaming, show all
        if (!isStreaming) return content.length

        // If we are streaming, start at 0 so it types out
        return 0
    })

    const displayedLengthRef = useRef(displayedLength)
    displayedLengthRef.current = displayedLength

    const lastFrameTime = useRef<number>(0)
    const animationFrameId = useRef<number>()
    const isStreamingRef = useRef(isStreaming)

    // Update ref for use in animation loop
    useEffect(() => {
        isStreamingRef.current = isStreaming
    }, [isStreaming])

    // If streaming stops, ensure we snap to end
    useEffect(() => {
        if (!isStreaming && displayedLengthRef.current < content.length) {
            // We give it a tiny delay to allow any final animation frames to settle
            // before hard-snapping, which feels less jarring.
            const timer = setTimeout(() => {
                setDisplayedLength(content.length)
            }, 50)
            return () => clearTimeout(timer)
        }
    }, [isStreaming, content.length])

    // Animation Loop
    useEffect(() => {
        // Only animate if we are behind
        if (displayedLengthRef.current >= content.length) {
            return
        }

        const animate = (time: number) => {
            if (!lastFrameTime.current) lastFrameTime.current = time
            let delta = time - lastFrameTime.current

            // Cap delta to prevent huge jumps if tab was in background or paused
            if (delta > 50) delta = 16.6

            lastFrameTime.current = time

            const remaining = content.length - displayedLengthRef.current
            if (remaining <= 0) {
                lastFrameTime.current = 0
                return
            }

            // Speed = Base + (Remaining * Factor)
            const currentSpeed = baseSpeed + (remaining * accelerationFactor)
            let increment = currentSpeed * (delta / 16.6)

            // Ensure we at least move forward slightly if delta > 0
            if (delta > 0 && increment < 0.1) increment = 0.1

            let caughtUp = false

            setDisplayedLength(prev => {
                const next = prev + increment
                if (next >= content.length) {
                    caughtUp = true
                    return content.length
                }
                return next
            })

            if (!caughtUp && delta >= 0) {
                animationFrameId.current = requestAnimationFrame(animate)
            } else {
                lastFrameTime.current = 0
            }
        }

        animationFrameId.current = requestAnimationFrame(animate)

        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current)
            // DO NOT reset lastFrameTime.current here, so the next render continues smoothly
        }
    }, [content.length, baseSpeed, accelerationFactor])

    // Derive string from length
    const displayedContent = useMemo(() => {
        if (displayedLength >= content.length) return content
        return content.slice(0, Math.floor(displayedLength))
    }, [content, displayedLength])

    return {
        displayedContent,
        isTyping: isStreamingRef.current && displayedLength < content.length
    }
}
