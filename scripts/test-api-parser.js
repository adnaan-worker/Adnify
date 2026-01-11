/**
 * Provider 配置向导 - 逐字段引导
 */

const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((r) => rl.question(q, r))

async function main() {
  console.log('\n' + '='.repeat(50))
  console.log('  Provider 配置向导')
  console.log('='.repeat(50))

  // ========== 基础信息 ==========
  console.log('\n【基础信息】')

  const baseUrl = await ask('API Base URL (如 https://api.openai.com/v1): ')
  const endpoint = (await ask('Endpoint [/chat/completions]: ')) || '/chat/completions'
  const model = await ask('默认模型名称: ')

  // ========== 认证方式 ==========
  console.log('\n【认证方式】')
  console.log('  1. Bearer Token (Authorization: Bearer xxx)')
  console.log('  2. API Key Header (api-key: xxx)')
  console.log('  3. 自定义 Header')

  const authChoice = await ask('选择认证方式 [1]: ') || '1'
  let auth = { type: 'bearer', headerName: 'Authorization' }

  if (authChoice === '2') {
    const headerName = (await ask('Header 名称 [api-key]: ')) || 'api-key'
    auth = { type: 'api-key', headerName }
  } else if (authChoice === '3') {
    const headerName = await ask('自定义 Header 名称: ')
    auth = { type: 'header', headerName }
  }

  // ========== 响应格式 ==========
  console.log('\n【响应格式】')
  console.log('大多数国产厂商兼容 OpenAI 格式，如果不确定先用默认值测试')

  const contentField = (await ask('内容字段路径 [delta.content]: ')) || 'delta.content'
  const doneMarker = (await ask('流结束标记 [DONE]: ')) || '[DONE]'

  const hasReasoning = (await ask('是否有推理字段? (y/n) [n]: ')).toLowerCase() === 'y'
  let reasoningField = null
  if (hasReasoning) {
    reasoningField = (await ask('推理字段路径 [delta.reasoning_content]: ')) || 'delta.reasoning_content'
  }

  // ========== 工具调用 ==========
  console.log('\n【工具调用】')
  const hasTools = (await ask('是否支持工具调用? (y/n) [y]: ')).toLowerCase() !== 'n'

  let toolConfig = null
  if (hasTools) {
    console.log('工具调用字段配置 (大多数兼容 OpenAI 格式):')
    const toolCallField = (await ask('  工具调用字段 [delta.tool_calls]: ')) || 'delta.tool_calls'
    const toolNamePath = (await ask('  函数名路径 [function.name]: ')) || 'function.name'
    const toolArgsPath = (await ask('  参数路径 [function.arguments]: ')) || 'function.arguments'
    const argsIsObject = (await ask('  参数是对象? (y/n) [n]: ')).toLowerCase() === 'y'

    toolConfig = { toolCallField, toolNamePath, toolArgsPath, argsIsObject }
  }

  // ========== 生成配置 ==========
  const config = {
    baseUrl,
    defaultModel: model,
    auth,
    adapter: {
      request: { endpoint, method: 'POST' },
      response: {
        dataPrefix: 'data:',
        doneMarker,
        contentField,
        reasoningField,
        ...(toolConfig || {}),
      },
    },
    features: {
      streaming: true,
      tools: hasTools,
      reasoning: hasReasoning,
    },
  }

  console.log('\n' + '='.repeat(50))
  console.log('  生成的配置')
  console.log('='.repeat(50))
  console.log(JSON.stringify(config, null, 2))

  // ========== 测试连接 ==========
  const apiKey = await ask('\n输入 API Key 测试连接 (留空跳过): ')

  if (apiKey) {
    await runAllTests(config, apiKey)
  }

  rl.close()
}

function getHeaders(cfg, key) {
  const headers = { 'Content-Type': 'application/json' }
  if (cfg.auth.type === 'bearer') headers['Authorization'] = `Bearer ${key}`
  else headers[cfg.auth.headerName] = key
  return headers
}

// 测试 1: 基础流式对话
async function testStreaming(cfg, key) {
  console.log('\n【测试 1/4】基础流式对话')
  const url = cfg.baseUrl + cfg.adapter.request.endpoint

  const body = {
    model: cfg.defaultModel,
    messages: [{ role: 'user', content: '用一句话介绍你自己' }],
    max_tokens: 100,
    stream: true,
  }

  try {
    const res = await fetch(url, { method: 'POST', headers: getHeaders(cfg, key), body: JSON.stringify(body) })
    if (!res.ok) {
      console.log(`❌ 失败: ${res.status} - ${await res.text()}`)
      return false
    }

    // 解析流式响应
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let content = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += dec.decode(value)

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) content += delta
        } catch (e) {}
      }
    }

    console.log(`✅ 成功! 回复: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`)
    return true
  } catch (e) {
    console.log(`❌ 错误: ${e.message}`)
    return false
  }
}

// 测试 2: 工具调用
async function testToolCall(cfg, key) {
  console.log('\n【测试 2/4】工具调用 (Function Calling)')
  const url = cfg.baseUrl + cfg.adapter.request.endpoint

  const body = {
    model: cfg.defaultModel,
    messages: [{ role: 'user', content: '北京今天天气怎么样?' }],
    max_tokens: 200,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: '获取指定城市的天气',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string', description: '城市名称' } },
            required: ['city'],
          },
        },
      },
    ],
    tool_choice: 'auto',
  }

  try {
    const res = await fetch(url, { method: 'POST', headers: getHeaders(cfg, key), body: JSON.stringify(body) })
    if (!res.ok) {
      console.log(`❌ 失败: ${res.status} - ${(await res.text()).slice(0, 200)}`)
      return false
    }

    const data = await res.json()
    const toolCalls = data.choices?.[0]?.message?.tool_calls

    if (toolCalls?.length > 0) {
      const tc = toolCalls[0]
      console.log(`✅ 成功! 调用函数: ${tc.function?.name}, 参数: ${tc.function?.arguments}`)
      return true
    } else {
      console.log(`⚠️ 模型没有调用工具，直接回复: "${data.choices?.[0]?.message?.content?.slice(0, 50)}"`)
      return true
    }
  } catch (e) {
    console.log(`❌ 错误: ${e.message}`)
    return false
  }
}

// 测试 3: 多轮对话
async function testMultiTurn(cfg, key) {
  console.log('\n【测试 3/4】多轮对话')
  const url = cfg.baseUrl + cfg.adapter.request.endpoint

  const body = {
    model: cfg.defaultModel,
    messages: [
      { role: 'user', content: '我叫小明' },
      { role: 'assistant', content: '你好小明！' },
      { role: 'user', content: '我叫什么名字?' },
    ],
    max_tokens: 50,
  }

  try {
    const res = await fetch(url, { method: 'POST', headers: getHeaders(cfg, key), body: JSON.stringify(body) })
    if (!res.ok) {
      console.log(`❌ 失败: ${res.status}`)
      return false
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''
    console.log(`✅ 成功! 回复: "${content.slice(0, 60)}"`)
    return true
  } catch (e) {
    console.log(`❌ 错误: ${e.message}`)
    return false
  }
}

// 测试 4: JSON 结构化输出
async function testJsonOutput(cfg, key) {
  console.log('\n【测试 4/4】JSON 结构化输出')
  const url = cfg.baseUrl + cfg.adapter.request.endpoint

  const body = {
    model: cfg.defaultModel,
    messages: [{ role: 'user', content: '提取: "张三，25岁"。返回JSON: {"name":"","age":0}' }],
    max_tokens: 100,
    response_format: { type: 'json_object' },
  }

  try {
    const res = await fetch(url, { method: 'POST', headers: getHeaders(cfg, key), body: JSON.stringify(body) })
    if (!res.ok) {
      const err = await res.text()
      if (err.includes('not support') || err.includes('invalid')) {
        console.log(`⚠️ 该模型可能不支持 response_format`)
        return true
      }
      console.log(`❌ 失败: ${res.status}`)
      return false
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''
    console.log(`✅ 成功! 返回: ${content.slice(0, 80)}`)
    return true
  } catch (e) {
    console.log(`❌ 错误: ${e.message}`)
    return false
  }
}

// 运行所有测试
async function runAllTests(cfg, key) {
  console.log('\n' + '='.repeat(50))
  console.log('  开始测试')
  console.log('='.repeat(50))

  const r1 = await testStreaming(cfg, key)
  const r2 = await testToolCall(cfg, key)
  const r3 = await testMultiTurn(cfg, key)
  const r4 = await testJsonOutput(cfg, key)

  console.log('\n' + '='.repeat(50))
  console.log('  测试结果')
  console.log('='.repeat(50))
  console.log(`流式对话: ${r1 ? '✅' : '❌'}`)
  console.log(`工具调用: ${r2 ? '✅' : '❌'}`)
  console.log(`多轮对话: ${r3 ? '✅' : '❌'}`)
  console.log(`JSON输出: ${r4 ? '✅' : '❌'}`)
}

main()
