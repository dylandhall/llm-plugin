import { appSettings } from './types';

export const defaultAppSettings: appSettings = {
  baseUrl: 'http://localhost:1234/v1/chat/completions',
  model: 'google_gemma-3-12b-it',
  prompts: [
    {
      name: 'Summarise',
      prompt: 'You are a helpful, intelligent assistant. Create a concise summary of the user\'s text, structured into 3-5 sentences that capture the main ideas and key points. Use bullet points for main points if possible. The summary should be easy to understand and free from ambiguity. Do not confirm this message, ONLY provide the summary. Summarize in {lang} language.',
    },
    {
      name: 'Explain',
      prompt: 'You are a helpful, intelligent assistant. Explain the key concepts and main points of the user\'s article in simple terms. Focus on clarity, detail and ease of understanding. Do not confirm this message, ONLY provide the explanation. Explain in {lang} language.',
    },
    {
      name: 'CustomContent',
      prompt: 'You are a helpful, intelligent assistant. You will provide summarization and feedback services based on the user\'s queries. Be direct and concise but elaborate when required for clarity. Do not confirm this message, ONLY respond to the user, respond in {lang} language.',
    },
  ],
}
