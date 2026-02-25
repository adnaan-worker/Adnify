import { motion } from 'framer-motion'
import { Sparkles, Code, FileText, Bug, ArrowRight } from 'lucide-react'
import { useStore } from '@store'
import { Logo } from '../common/Logo'

interface EmptyChatSuggestionsProps {
    onSelectSuggestion: (text: string) => void
}

export default function EmptyChatSuggestions({ onSelectSuggestion }: EmptyChatSuggestionsProps) {
    const { language } = useStore()

    const suggestions = [
        {
            icon: <Sparkles className="w-4 h-4 text-purple-500" />,
            title: language === 'zh' ? '解释当前项目' : 'Explain this project',
            prompt: 'Please explain the overall architecture and purpose of the current project.',
            iconBg: 'bg-purple-500/10'
        },
        {
            icon: <Code className="w-4 h-4 text-accent" />,
            title: language === 'zh' ? '生成新功能' : 'Generate feature',
            prompt: "I want to build a new feature. Let's start by discussing the requirements and architecture.",
            iconBg: 'bg-accent/10'
        },
        {
            icon: <FileText className="w-4 h-4 text-emerald-500" />,
            title: language === 'zh' ? '添加注释或文档' : 'Add documentation',
            prompt: 'Generate comprehensive comments and documentation for the active file.',
            iconBg: 'bg-emerald-500/10'
        },
        {
            icon: <Bug className="w-4 h-4 text-orange-500" />,
            title: language === 'zh' ? '帮我找出隐藏的 Bug' : 'Find hidden bugs',
            prompt: 'Review the current codebase or active file for any potential bugs, edge cases, or security issues.',
            iconBg: 'bg-orange-500/10'
        }
    ]

    return (
        <div className="flex flex-col items-center justify-center p-6 select-none z-10 w-full max-w-md mx-auto my-auto min-h-[65vh]">
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="relative mb-10 flex flex-col items-center w-full"
            >
                {/* Subtle outer glow */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-accent/20 blur-[50px] rounded-full w-40 h-40 pointer-events-none" />

                <div className="relative w-14 h-14 bg-gradient-to-b from-surface to-background rounded-2xl border border-border/50 flex items-center justify-center shadow-sm mb-6">
                    <Logo className="w-7 h-7 text-text-primary opacity-80" />
                </div>

                <h1 className="text-xl font-semibold text-text-primary tracking-tight mb-2">
                    {language === 'zh' ? '今天想构建什么？' : 'What to build today?'}
                </h1>
                <p className="text-xs text-text-muted max-w-[260px] text-center leading-relaxed">
                    {language === 'zh' ? '选择下方建议，或直接告诉我你的初步想法' : 'Choose a suggestion below, or tell me your initial thoughts directly.'}
                </p>
            </motion.div>

            <div className="flex flex-col gap-2 w-full relative z-10">
                {suggestions.map((item, index) => (
                    <motion.button
                        key={index}
                        initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ delay: index * 0.08 + 0.1, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                        onClick={() => onSelectSuggestion(item.prompt)}
                        className="group relative flex items-center gap-4 py-3 px-4 rounded-xl border border-transparent bg-transparent hover:bg-surface-hover hover:border-border/60 transition-all duration-300 w-full text-left overflow-hidden shadow-sm hover:shadow-md hover:shadow-black/5"
                    >
                        {/* Hover reveal gradient */}
                        <div className="absolute inset-0 bg-gradient-to-r from-accent/0 via-accent/5 to-accent/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out pointer-events-none" />

                        <div className={`p-2 rounded-xl ${item.iconBg} transition-colors shrink-0`}>
                            {item.icon}
                        </div>

                        <div className="flex-1 min-w-0">
                            <span className="text-[13px] font-medium text-text-secondary group-hover:text-text-primary transition-colors block truncate">
                                {item.title}
                            </span>
                        </div>

                        <div className="shrink-0 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 ease-out">
                            <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-accent" />
                        </div>
                    </motion.button>
                ))}
            </div>
        </div>
    )
}
