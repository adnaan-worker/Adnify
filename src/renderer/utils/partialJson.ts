/**
 * 尝试从不完整的 JSON 字符串中提取特定字段的字符串值
 * 用于流式展示工具调用的代码内容
 */
export function extractPartialString(jsonBuffer: string, keys: string[]): string | null {
    if (!jsonBuffer) return null;

    for (const key of keys) {
        // 匹配 key 的开始，例如 "code": "
        // 注意：这里假设 JSON 格式相对标准，没有过多的空白干扰，或者已格式化
        // 更加健壮的实现需要完整的 tokenizer
        const keyPattern = `"${key}"\s*:\s*"`;
        const regex = new RegExp(keyPattern);
        const match = regex.exec(jsonBuffer);

        if (match) {
            const startIdx = match.index + match[0].length;
            let result = '';
            let isEscaped = false;
            
            // 从值开始的位置向后遍历
            for (let i = startIdx; i < jsonBuffer.length; i++) {
                const char = jsonBuffer[i];
                
                if (isEscaped) {
                    // 处理转义字符
                    if (char === 'n') result += '\n';
                    else if (char === 't') result += '\t';
                    else if (char === 'r') result += ''; // 忽略 CR
                    else if (char === '"') result += '"';
                    else if (char === '\\') result += '\\';
                    else result += char; // 其他转义保留原样（简化处理）
                    
                    isEscaped = false;
                } else {
                    if (char === '\\') {
                        isEscaped = true;
                    } else if (char === '"') {
                        // 遇到未转义的引号，说明值结束了
                        return result;
                    } else {
                        result += char;
                    }
                }
            }
            
            // 如果循环结束还没遇到引号，说明流还在传输中，返回当前已累积的内容
            return result;
        }
    }

    return null;
}
