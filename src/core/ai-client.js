export const CLASSIFICATION_SYSTEM_PROMPT = `你是一个专业的浏览器书签整理助手。
你的任务是将用户提供的一批“近期活跃/散落书签”归类到清晰简洁的主题文件夹中，并识别出明显属于一次性/过期促销/临时测试/隐私政策页的链接（归入 "__TEMP__" 特殊桶，表示放入「历史归档/临时与一次性链接」）。

要求：
1. 主题文件夹数量控制在 4～8 个之间，名称简短清晰（纯中文或常见英文缩写，不加多余符号），例如：AI 对话与工具、AI API与订阅、开发与技术、运维与网络、工作与项目、设计与效率。
2. 每个书签只能分配到一个目标文件夹，必须保留原始 id 不变。
3. 如果书签标题存在明显乱码或多余前缀，可在 rename 中给出清理后的标题；否则不要改名。
4. 严格只输出合法 JSON，不要输出解释文字。

输出 JSON Schema：
{
  "folders": ["AI 对话与工具", "开发与技术"],
  "assignments": [
    { "id": "1520", "folder": "AI 对话与工具" },
    { "id": "1547", "folder": "__TEMP__" }
  ]
}`;

export function buildClassificationUserPrompt(payloadItems, customHint = '') {
  const hintBlock = customHint?.trim()
    ? `\n用户补充偏好：\n${customHint.trim()}\n`
    : '';
  return `请将以下 ${payloadItems.length} 条书签进行分类：${hintBlock}
书签列表（JSON）：
${JSON.stringify(payloadItems)}`;
}

export function extractJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('AI 返回内容为空');

  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Strip markdown fences if present
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  }

  throw new Error('无法从 AI 响应中解析有效 JSON');
}

async function callBuiltInAi(systemPrompt, userPrompt) {
  if (!globalThis.LanguageModel) {
    throw new Error('当前 Chrome 版本或环境未启用内置 LanguageModel (Prompt API)');
  }
  const availability = await LanguageModel.availability({
    expectedInputs: [{ type: 'text', languages: ['zh', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['zh', 'en'] }],
  });
  if (availability === 'unavailable') {
    throw new Error('当前设备不支持 Chrome 内置 AI 模型');
  }

  const session = await LanguageModel.create({
    expectedInputs: [{ type: 'text', languages: ['zh', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['zh', 'en'] }],
    initialPrompts: [{ role: 'system', content: systemPrompt }],
  });
  try {
    return await session.prompt(userPrompt);
  } finally {
    session.destroy();
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 20000) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s），请检查网络或代理设置`, { cause: err });
    }
    throw new Error(`网络请求失败: ${err?.message || String(err)}（请检查 Base URL、代理或域名权限）`, { cause: err });
  }
}

async function callOpenAiCompatible({ baseUrl, apiKey, model }, systemPrompt, userPrompt) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API 请求失败 (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic({ baseUrl, apiKey, model }, systemPrompt, userPrompt) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/messages`;
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API 失败 (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.map((c) => c.text || '').join('\n') || '';
}

async function callGemini({ baseUrl, apiKey, model }, systemPrompt, userPrompt) {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const endpoint = `${cleanBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API 失败 (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
}

export async function invokeAiText(settings, systemPrompt, userPrompt) {
  const { provider } = settings;
  if (provider === 'builtin') {
    return callBuiltInAi(systemPrompt, userPrompt);
  }
  if (provider === 'anthropic') {
    return callAnthropic(settings, systemPrompt, userPrompt);
  }
  if (provider === 'gemini') {
    return callGemini(settings, systemPrompt, userPrompt);
  }
  return callOpenAiCompatible(settings, systemPrompt, userPrompt);
}

export async function testAiConnection(settings) {
  const text = await invokeAiText(
    settings,
    'You are a connectivity test assistant. Reply with valid JSON: {"ok":true}',
    'Reply {"ok":true} only.'
  );
  return text.slice(0, 120);
}
