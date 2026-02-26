/**
 * 上下文相关类型定义
 */

/** 上下文项类型 */
export type ContextItemType =
  | 'File'
  | 'CodeSelection'
  | 'Folder'
  | 'Codebase'
  | 'Git'
  | 'Terminal'
  | 'Symbols'
  | 'Web'
  | 'Problems'
  | 'Skill'

export interface FileContext {
  type: 'File'
  uri: string
}

export interface CodeSelectionContext {
  type: 'CodeSelection'
  uri: string
  range: [number, number]
}

export interface FolderContext {
  type: 'Folder'
  uri: string
}

export interface CodebaseContext {
  type: 'Codebase'
  query?: string
}

export interface GitContext {
  type: 'Git'
}

export interface TerminalContext {
  type: 'Terminal'
}

export interface SymbolsContext {
  type: 'Symbols'
}

export interface WebContext {
  type: 'Web'
  query?: string
}

export interface ProblemsContext {
  type: 'Problems'
  uri?: string
}

export interface SkillContext {
  type: 'Skill'
  skillId: string
  name: string
}

/** 上下文项联合类型 */
export type ContextItem =
  | FileContext
  | CodeSelectionContext
  | FolderContext
  | CodebaseContext
  | GitContext
  | TerminalContext
  | SymbolsContext
  | WebContext
  | ProblemsContext
  | SkillContext
