/**
 * Monaco 编辑器配置
 * 集中管理所有 Monaco 编辑器的选项配置
 */

import type { editor } from 'monaco-editor'
import { getEditorConfig } from '@renderer/settings'
import { LargeFileInfo, getLargeFileEditorOptions } from '@/renderer/services/largeFileService'

/**
 * 获取 Monaco 编辑器的完整配置选项
 */
export function getMonacoEditorOptions(
  largeFileInfo?: LargeFileInfo | null
): editor.IStandaloneEditorConstructionOptions {
  const config = getEditorConfig()

  const baseOptions: editor.IStandaloneEditorConstructionOptions = {
    // 字体和外观
    fontSize: config.fontSize,
    fontFamily: config.fontFamily,
    fontLigatures: true,
    lineHeight: 1.6,
    tabSize: config.tabSize,
    wordWrap: config.wordWrap,
    
    // 小地图
    minimap: {
      enabled: config.minimap,
      scale: config.minimapScale,
      renderCharacters: false,
    },
    
    // 滚动和布局
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    padding: { top: 24, bottom: 16 },
    automaticLayout: true,
    
    // 光标
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    cursorStyle: 'line',
    cursorWidth: 2,
    
    // 行号和高亮
    lineNumbers: config.lineNumbers,
    renderLineHighlight: 'all',
    renderLineHighlightOnlyWhenFocus: false,
    roundedSelection: false,
    glyphMargin: true, // 启用断点区域
    
    // 代码补全和建议
    inlineSuggest: { enabled: true },
    suggest: {
      showKeywords: true,
      showSnippets: true,
      showClasses: true,
      showFunctions: true,
      showVariables: true,
      showModules: true,
      showProperties: true,
      showEvents: true,
      showOperators: true,
      showUnits: true,
      showValues: true,
      showConstants: true,
      showEnumMembers: true,
      showStructs: true,
      showTypeParameters: true,
      showWords: true,
      showColors: true,
      showFiles: true,
      showReferences: true,
      showFolders: true,
      showInterfaces: true,
      showIssues: true,
      showUsers: false,
      insertMode: 'insert',
      filterGraceful: true,
      snippetsPreventQuickSuggestions: false,
      localityBonus: true,
      shareSuggestSelections: true,
      showStatusBar: true,
      preview: true,
      previewMode: 'subwordSmart',
    },
    quickSuggestions: {
      other: true,
      comments: false,
      strings: true,
    },
    acceptSuggestionOnCommitCharacter: true,
    acceptSuggestionOnEnter: 'on',
    tabCompletion: 'on',
    wordBasedSuggestions: 'matchingDocuments',
    
    // 参数提示
    parameterHints: { enabled: true, cycle: true },
    
    // 代码折叠
    folding: true,
    foldingStrategy: 'auto',
    foldingHighlight: true,
    foldingImportsByDefault: true,
    showFoldingControls: 'mouseover',
    unfoldOnClickAfterEndOfLine: true,
    
    // 括号匹配和高亮
    matchBrackets: 'always',
    bracketPairColorization: {
      enabled: config.bracketPairColorization,
      independentColorPoolPerBracketType: true,
    },
    guides: {
      bracketPairs: true,
      bracketPairsHorizontal: 'active',
      highlightActiveBracketPair: true,
      indentation: true,
      highlightActiveIndentation: true,
    },
    
    // 渲染选项
    renderWhitespace: 'selection',
    renderControlCharacters: true,
    
    // 选区高亮
    selectionHighlight: true,
    occurrencesHighlight: 'singleFile',
    
    // 滚动和导航
    stickyScroll: { enabled: true, maxLineCount: 5 },
    scrollbar: {
      vertical: 'auto',
      horizontal: 'auto',
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false,
    },
    
    // 内联提示
    inlayHints: { enabled: 'on', fontSize: 11, padding: true },
    
    // 链接和跳转
    links: true,
    colorDecorators: true,
    gotoLocation: {
      multiple: 'goto',
      multipleDefinitions: 'goto',
      multipleTypeDefinitions: 'goto',
      multipleDeclarations: 'goto',
      multipleImplementations: 'goto',
      multipleReferences: 'goto',
    },
    
    // 查找和替换
    find: {
      addExtraSpaceOnTop: true,
      autoFindInSelection: 'multiline',
      seedSearchStringFromSelection: 'selection',
      loop: true,
    },
    
    // 多光标
    multiCursorModifier: 'alt',
    multiCursorMergeOverlapping: true,
    multiCursorPaste: 'spread',
    
    // 拖放
    dragAndDrop: true,
    dropIntoEditor: { enabled: true },
    
    // 其他高级功能
    linkedEditing: true,
    renameOnType: true,
    smartSelect: { selectLeadingAndTrailingWhitespace: true },
    copyWithSyntaxHighlighting: true,
    emptySelectionClipboard: true,
    columnSelection: false,
    
    // 禁用内置右键菜单（使用自定义菜单）
    contextmenu: false,
  }

  // 如果是大文件，合并大文件特殊配置
  if (largeFileInfo) {
    return {
      ...baseOptions,
      ...getLargeFileEditorOptions(largeFileInfo),
    }
  }

  return baseOptions
}

/**
 * 获取 Diff 编辑器配置
 */
export function getMonacoDiffEditorOptions(): editor.IDiffEditorConstructionOptions {
  const config = getEditorConfig()

  return {
    fontSize: config.fontSize,
    fontFamily: config.fontFamily,
    fontLigatures: true,
    renderSideBySide: true,
    readOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
  }
}

/**
 * 获取只读预览编辑器配置
 */
export function getMonacoPreviewOptions(): editor.IStandaloneEditorConstructionOptions {
  const config = getEditorConfig()

  return {
    fontSize: config.fontSize,
    fontFamily: config.fontFamily,
    fontLigatures: true,
    readOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'off',
    folding: false,
    contextmenu: false,
  }
}
