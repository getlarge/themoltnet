// Generated from https://ollama.com/v1/models and https://ollama.com/api/show by the
// provider-catalog generator. Do not edit manually.
// Regenerate with generate:ollama-cloud.

export type OllamaCloudModel = {
  id: string;
  contextWindow: number;
  vision: boolean;
  tools: boolean;
  thinkingLevels?: readonly string[];
  defaultThinkingLevel?: string;
};

export const ollamaCloudModelData: readonly OllamaCloudModel[] = [
  {
    id: 'deepseek-v4-pro:0813',
    contextWindow: 1048576,
    vision: false,
    tools: true,
    thinkingLevels: ['off', 'low', 'high', 'max'],
    defaultThinkingLevel: 'low',
  },
  {
    id: 'deepseek-v4.1-flash',
    contextWindow: 1048576,
    vision: true,
    tools: true,
    thinkingLevels: ['off', 'low', 'high', 'max'],
    defaultThinkingLevel: 'high',
  },
  {
    id: 'gemma4:31b',
    contextWindow: 262144,
    vision: true,
    tools: true,
    thinkingLevels: ['off', 'on'],
    defaultThinkingLevel: 'off',
  },
  {
    id: 'glm-5.2',
    contextWindow: 1048576,
    vision: false,
    tools: true,
    thinkingLevels: ['off', 'high', 'max'],
    defaultThinkingLevel: 'high',
  },
  {
    id: 'glm-5.3',
    contextWindow: 1048576,
    vision: false,
    tools: true,
    thinkingLevels: ['low', 'high', 'max'],
    defaultThinkingLevel: 'max',
  },
  {
    id: 'glm-5.3-flash',
    contextWindow: 1048576,
    vision: true,
    tools: true,
    thinkingLevels: ['low', 'high', 'max'],
    defaultThinkingLevel: 'max',
  },
  {
    id: 'gpt-oss:120b',
    contextWindow: 131072,
    vision: false,
    tools: true,
    thinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'medium',
  },
  {
    id: 'gpt-oss:20b',
    contextWindow: 131072,
    vision: false,
    tools: true,
    thinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'medium',
  },
  {
    id: 'kimi-k2.6',
    contextWindow: 262144,
    vision: true,
    tools: true,
    thinkingLevels: ['off', 'on'],
    defaultThinkingLevel: 'on',
  },
  {
    id: 'kimi-k2.7-code',
    contextWindow: 262144,
    vision: true,
    tools: true,
    thinkingLevels: ['off', 'on'],
    defaultThinkingLevel: 'on',
  },
  {
    id: 'kimi-k3',
    contextWindow: 1048576,
    vision: true,
    tools: true,
    thinkingLevels: ['off', 'low', 'high', 'max'],
    defaultThinkingLevel: 'max',
  },
  {
    id: 'minimax-m2.7',
    contextWindow: 196608,
    vision: false,
    tools: true,
    thinkingLevels: ['on'],
    defaultThinkingLevel: 'on',
  },
  {
    id: 'minimax-m3',
    contextWindow: 512000,
    vision: true,
    tools: true,
    thinkingLevels: ['on'],
    defaultThinkingLevel: 'on',
  },
  {
    id: 'mistral-large-3:675b',
    contextWindow: 262144,
    vision: true,
    tools: true,
  },
  {
    id: 'nemotron-3-nano:30b',
    contextWindow: 262144,
    vision: false,
    tools: true,
    thinkingLevels: ['off', 'on'],
    defaultThinkingLevel: 'on',
  },
  {
    id: 'nemotron-3-super',
    contextWindow: 262144,
    vision: false,
    tools: true,
    thinkingLevels: ['off', 'on'],
    defaultThinkingLevel: 'on',
  },
  {
    id: 'nemotron-3-ultra',
    contextWindow: 262144,
    vision: false,
    tools: true,
    thinkingLevels: ['off', 'on'],
    defaultThinkingLevel: 'on',
  },
];
