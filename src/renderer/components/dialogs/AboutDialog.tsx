/**
 * About Dialog
 * 显示应用信息、版本、链接等
 */

import { logger } from '@utils/Logger'
import { useState, useEffect } from 'react'
import { X, Github, ExternalLink, Code2, Cpu, Zap } from 'lucide-react'
import { Logo } from '../common/Logo'
import { useStore } from '@store'
import { Modal } from '../ui'
import { motion } from 'framer-motion'

interface AboutDialogProps {
    onClose: () => void
}

export default function AboutDialog({ onClose }: AboutDialogProps) {
    const { language } = useStore()
    const [version, setVersion] = useState('1.0.0')

    useEffect(() => {
        const loadVersions = async () => {
            try {
                const appVersion = await window.electronAPI?.getAppVersion?.()
                if (appVersion) setVersion(appVersion)
            } catch (e) {
                logger.ui.error('Failed to get app version:', e)
            }
        }
        loadVersions()
    }, [])

    return (
        <Modal isOpen={true} onClose={onClose} noPadding size="2xl" className="overflow-hidden bg-transparent shadow-2xl">
            <div className="relative overflow-hidden bg-surface/80 backdrop-blur-3xl border border-border/50 flex flex-col h-[580px] w-full">
                {/* Background Texture - Dot Pattern */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.05]" 
                     style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '24px 24px' }} 
                />
                
                {/* Subtle Gradient Glows */}
                <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-accent/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[150px] pointer-events-none" />

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 z-50 p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-text-muted hover:text-text-primary transition-all duration-300"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Main Content */}
                <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-12 pt-12 pb-8">
                    {/* Logo Section */}
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, type: 'spring', bounce: 0.4 }}
                        className="mb-10 relative group cursor-default"
                    >
                        <div className="absolute inset-0 bg-accent/40 blur-3xl rounded-full opacity-60 group-hover:opacity-80 transition-opacity duration-700" />
                        <div className="relative w-28 h-28 bg-surface/60 backdrop-blur-xl rounded-[2rem] border border-white/20 dark:border-white/10 flex items-center justify-center shadow-2xl ring-1 ring-black/5 dark:ring-white/10 transform group-hover:scale-105 transition-transform duration-500 ease-out">
                            <Logo className="w-16 h-16 text-accent drop-shadow-lg" />
                        </div>
                        {/* Version Badge */}
                        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-surface border border-border shadow-md text-[10px] font-mono font-bold text-text-secondary whitespace-nowrap z-20">
                            v{version}
                        </div>
                    </motion.div>

                    {/* Title & Slogan */}
                    <motion.div
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2, duration: 0.5 }}
                        className="text-center space-y-3 max-w-md mx-auto"
                    >
                        <h1 className="text-4xl font-black text-text-primary tracking-tight">
                            ADNIFY
                        </h1>
                        <p className="text-sm text-text-secondary leading-relaxed font-medium opacity-80">
                            {language === 'zh'
                                ? '为下一代开发者打造的 AI 原生编辑器。'
                                : 'AI-Native Editor built for the next generation of developers.'}
                        </p>
                    </motion.div>

                    {/* Feature Pills */}
                    <motion.div 
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.3, duration: 0.5 }}
                        className="flex gap-3 mt-10"
                    >
                        <FeaturePill icon={Code2} label={language === 'zh' ? '智能补全' : 'Intelligent'} />
                        <FeaturePill icon={Cpu} label={language === 'zh' ? '深度理解' : 'Deep Context'} />
                        <FeaturePill icon={Zap} label={language === 'zh' ? '极速响应' : 'Blazing Fast'} />
                    </motion.div>
                </div>

                {/* Footer */}
                <div className="relative z-10 px-10 pb-8 w-full border-t border-border/30 bg-surface/20 backdrop-blur-md">
                    <div className="flex items-center justify-between pt-6">
                        {/* Author Info */}
                        <div className="flex items-center gap-3 group cursor-pointer">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center text-xs font-bold text-white shadow-lg ring-2 ring-white/10 group-hover:scale-110 transition-transform duration-300">
                                AD
                            </div>
                            <div className="text-left">
                                <p className="text-sm font-bold text-text-primary group-hover:text-accent transition-colors">adnaan</p>
                                <p className="text-[10px] text-text-muted font-medium">Creator & Maintainer</p>
                            </div>
                        </div>

                        {/* Social Actions */}
                        <div className="flex gap-2">
                            <SocialButton href="https://github.com/adnaan-worker/adnify" icon={Github} label="GitHub" />
                            <SocialButton href="https://gitee.com/adnaan/adnify" icon={ExternalLink} label="Gitee" />
                        </div>
                    </div>

                    {/* Copyright */}
                    <div className="mt-8 text-center">
                        <p className="text-[10px] text-text-muted/50 font-medium tracking-wide">
                            Copyright © 2025-present adnaan. All rights reserved.
                        </p>
                    </div>
                </div>
            </div>
        </Modal>
    )
}

function FeaturePill({ icon: Icon, label }: { icon: any; label: string }) {
    return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface/50 border border-border/50 text-[10px] font-bold text-text-secondary">
            <Icon className="w-3 h-3 text-accent" />
            {label}
        </div>
    )
}

function SocialButton({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary transition-all duration-200 group"
        >
            <Icon className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold">{label}</span>
        </a>
    )
}
