/**
 * Monaco Editor Worker 类型声明
 */

declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/css/css.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/html/html.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/typescript/ts.worker?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/typescript/monaco.contribution' {
  import type { IDisposable } from 'monaco-editor'
  
  export interface LanguageServiceDefaults {
    setCompilerOptions(options: any): void
    setDiagnosticsOptions(options: any): void
    setEagerModelSync(value: boolean): void
    addExtraLib(content: string, filePath?: string): IDisposable
  }
  
  export const typescriptDefaults: LanguageServiceDefaults
  export const javascriptDefaults: LanguageServiceDefaults
  
  export const ScriptTarget: {
    ESNext: number
    ES2020: number
    ES2019: number
    ES2018: number
    ES2017: number
    ES2016: number
    ES2015: number
    ES5: number
    ES3: number
  }
  
  export const ModuleKind: {
    ESNext: number
    ES2020: number
    ES2015: number
    CommonJS: number
    AMD: number
    UMD: number
    System: number
    None: number
  }
  
  export const ModuleResolutionKind: {
    NodeJs: number
    Classic: number
  }
  
  export const JsxEmit: {
    React: number
    ReactNative: number
    Preserve: number
    None: number
  }
}
