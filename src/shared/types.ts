
export interface prompt {
  name: string;
  prompt: string;
}

export interface appSettings {
  baseUrl: string;
  token?: string;
  model: string;
  lang: string;
  prompts: prompt[];
}
