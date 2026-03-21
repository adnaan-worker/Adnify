
// Inline implementation of partialJson.ts for testing

function parsePartialJson(jsonString: string): Record<string, unknown> | null {
    if (!jsonString || jsonString.trim().length === 0) {
        return null
    }

    // Try direct parse
    try {
        return JSON.parse(jsonString)
    } catch {
        // Continue to fix
    }

    // Try fix and parse
    try {
        const fixed = fixPartialJson(jsonString)
        return JSON.parse(fixed)
    } catch {
        // Fallback to extract known fields
        return extractKnownFields(jsonString)
    }
}

function fixPartialJson(jsonString: string): string {
    let result = jsonString.trim()

    if (!result.startsWith('{')) {
        result = '{' + result
    }

    result = fixStringContent(result)

    let braceCount = 0
    let bracketCount = 0
    let inString = false
    let escaped = false

    for (let i = 0; i < result.length; i++) {
        const char = result[i]

        if (escaped) {
            escaped = false
            continue
        }

        if (char === '\\' && inString) {
            escaped = true
            continue
        }

        if (char === '"') {
            inString = !inString
            continue
        }

        if (!inString) {
            if (char === '{') braceCount++
            else if (char === '}') braceCount--
            else if (char === '[') bracketCount++
            else if (char === ']') bracketCount--
        }
    }

    if (inString) {
        result += '"'
    }

    while (bracketCount > 0) {
        result += ']'
        bracketCount--
    }
    while (braceCount > 0) {
        result += '}'
        braceCount--
    }

    return result
}

function fixStringContent(jsonString: string): string {
    let result = ''
    let inString = false
    let escaped = false

    for (let i = 0; i < jsonString.length; i++) {
        const char = jsonString[i]
        const charCode = char.charCodeAt(0)

        if (escaped) {
            result += char
            escaped = false
            continue
        }

        if (char === '\\') {
            escaped = true
            result += char
            continue
        }

        if (char === '"') {
            inString = !inString
            result += char
            continue
        }

        if (inString) {
            if (char === '\n') {
                result += '\\n'
            } else if (char === '\r') {
                result += '\\r'
            } else if (char === '\t') {
                result += '\\t'
            } else if (charCode < 32) {
                result += `\\u${charCode.toString(16).padStart(4, '0')}`
            } else {
                result += char
            }
        } else {
            result += char
        }
    }

    return result
}

function extractKnownFields(jsonString: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    const pathMatch = jsonString.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (pathMatch) {
        result.path = unescapeString(pathMatch[1])
    }

    const contentMatch = jsonString.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (contentMatch) {
        result.content = unescapeString(contentMatch[1])
    }

    const oldStringMatch = jsonString.match(/"old_string"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (oldStringMatch) {
        result.old_string = unescapeString(oldStringMatch[1])
    }

    const newStringMatch = jsonString.match(/"new_string"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (newStringMatch) {
        result.new_string = unescapeString(newStringMatch[1])
    }

    const commandMatch = jsonString.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (commandMatch) {
        result.command = unescapeString(commandMatch[1])
    }

    const queryMatch = jsonString.match(/"query"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (queryMatch) {
        result.query = unescapeString(queryMatch[1])
    }

    const patternMatch = jsonString.match(/"pattern"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (patternMatch) {
        result.pattern = unescapeString(patternMatch[1])
    }

    return result
}

function unescapeString(str: string): string {
    return str
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
}

// Test Cases
const testCases = [
    // Case 1: Simple incomplete content
    '{"path": "test.ts", "content": "import React',

    // Case 2: Incomplete content with escapes
    '{"path": "test.ts", "content": "console.log(\\"Hello',

    // Case 3: Incomplete old_string/new_string
    '{"path": "test.ts", "old_string": "const a = 1;", "new_string": "const a = 2',

    // Case 4: Deeply nested or complex
    '{"path": "test.ts", "content": "function test() {\\n  return \\"string\\";\\n',
];

testCases.forEach((json, index) => {
    console.log(`\n--- Test Case ${index + 1} ---`);
    console.log('Input:', json);
    const result = parsePartialJson(json);
    console.log('Result:', JSON.stringify(result, null, 2));
});
