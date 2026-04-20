import type {TelegramNewsPipelineConfig} from './types.js';

type OllamaChatParams = {
  config: TelegramNewsPipelineConfig;
  prompt: string;
  responseFormat?: 'json' | 'text' | Record<string, unknown>;
};

type OllamaGenerateParams = {
  config: TelegramNewsPipelineConfig;
  prompt: string;
  responseFormat?: 'json' | 'text' | Record<string, unknown>;
};

function normalizeBaseUrl(raw: string) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

export async function ollamaChat(params: OllamaChatParams) {
  const baseUrl = normalizeBaseUrl(params.config.ollama.baseUrl);
  const model = String(params.config.ollama.model || '').trim();
  const prompt = String(params.prompt || '').trim();

  if (!baseUrl) throw new Error('ollama.baseUrl is empty in telegram-news config');
  if (!model) throw new Error('ollama.model is empty in telegram-news config');
  if (!prompt) throw new Error('Prompt is empty');

  const format =
    params.responseFormat === 'json'
      ? 'json'
      : params.responseFormat && typeof params.responseFormat === 'object'
      ? params.responseFormat
      : undefined;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      ...(format ? {format} : {}),
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText} ${raw.slice(0, 500)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Ollama returned invalid JSON: ${raw.slice(0, 500)}`);
  }

  const content = String(parsed?.message?.content || '').trim();
  if (!content) {
    throw new Error('Ollama returned empty message content');
  }

  return content;
}

export async function ollamaGenerate(params: OllamaGenerateParams) {
  const baseUrl = normalizeBaseUrl(params.config.ollama.baseUrl);
  const model = String(params.config.ollama.model || '').trim();
  const prompt = String(params.prompt || '').trim();

  if (!baseUrl) throw new Error('ollama.baseUrl is empty in telegram-news config');
  if (!model) throw new Error('ollama.model is empty in telegram-news config');
  if (!prompt) throw new Error('Prompt is empty');

  const format =
    params.responseFormat === 'json'
      ? 'json'
      : params.responseFormat && typeof params.responseFormat === 'object'
      ? params.responseFormat
      : undefined;

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      prompt,
      ...(format ? {format} : {}),
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText} ${raw.slice(0, 500)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Ollama returned invalid JSON: ${raw.slice(0, 500)}`);
  }

  const content = String(parsed?.response || '').trim();
  if (!content) {
    throw new Error('Ollama returned empty response');
  }

  return content;
}

function stripCodeFence(raw: string) {
  const fenced = String(raw || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : String(raw || '').trim();
}

export function parseJsonFromModelText(raw: string) {
  const candidate = stripCodeFence(raw);
  try {
    return JSON.parse(candidate);
  } catch {
    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    throw new Error(`Model returned invalid JSON: ${candidate.slice(0, 500)}`);
  }
}
