export type TelegramChannel = string;

export type TelegramNewsItem = {
  source: 'telegram';
  channel: TelegramChannel;
  messageId: number;
  publishedAt: string;
  url: string;
  text: string;
  imageUrl: string | null;
  hasMedia: boolean;
};

export type TelegramConfig = {
  apiId: number;
  apiHash: string;
  stringSession: string;
  channels: TelegramChannel[];
  useWSS: boolean;
  connectionRetries: number;
};

export type OllamaConfig = {
  baseUrl: string;
  model: string;
};

export type OutputConfig = {
  fetchedNewsFile: string;
};

export type PromptsConfig = {
  pickHotNewsPrompt: string;
  rewriteAsMarxPrompt: string;
  digestAsMarxPrompt: string;
};

export type TelegramNewsPipelineConfig = {
  telegram: TelegramConfig;
  ollama: OllamaConfig;
  output: OutputConfig;
  prompts: PromptsConfig;
};
