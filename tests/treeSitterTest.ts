import * as path from 'path'
import { TreeSitterChunker } from '../src/main/indexing/treeSitterChunker'

async function test() {
  const chunker = new TreeSitterChunker()
  await chunker.init()

  const tsContent = `
import { Foo } from 'bar'

export class TestClass {
  constructor() {
    console.log('init')
  }

  public async methodOne() {
    const x = 1
    return x + 1
  }
}

function helper() {
  return 'helper'
}
`

  console.log('Testing TypeScript chunking...')
  const chunks = await chunker.chunkFile('test.ts', tsContent, process.cwd())
  
  console.log(`Generated ${chunks.length} chunks:`)
  chunks.forEach(c => {
    console.log(`[${c.type}] lines ${c.startLine}-${c.endLine}: ${c.symbols?.join(', ')}`)
    console.log(c.content.trim())
    console.log('---')
  })
}

test().catch(console.error)
