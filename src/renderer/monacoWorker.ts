/**
 * Monaco Editor Worker 配置
 * 配置 Monaco 使用 Web Worker 来处理语言服务
 */

import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
// Monaco 0.55+ 需要单独导入 TypeScript 语言服务
import {
  typescriptDefaults,
  javascriptDefaults,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
  JsxEmit,
} from 'monaco-editor/esm/vs/language/typescript/monaco.contribution'

// 配置 Monaco 环境
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new jsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  }
}

// 配置 TypeScript/JavaScript 语言服务
// 完全禁用内置诊断，因为我们使用外部 LSP 服务
// Monaco 内置的 TS worker 无法正确处理 Electron 的文件路径
typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true, // 也禁用语法检查，避免路径解析错误
  noSuggestionDiagnostics: true,
})

javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
})

// 禁用 eager model sync，减少 inmemory model 被提前处理的情况
typescriptDefaults.setEagerModelSync(false)
javascriptDefaults.setEagerModelSync(false)

// 配置编译选项
typescriptDefaults.setCompilerOptions({
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  jsx: JsxEmit.React,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: false,
  strict: false,
  noEmit: true,
  esModuleInterop: true,
  skipLibCheck: true,
})

javascriptDefaults.setCompilerOptions({
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  jsx: JsxEmit.React,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: false,
  noEmit: true,
  esModuleInterop: true,
  skipLibCheck: true,
})

export { monaco }
