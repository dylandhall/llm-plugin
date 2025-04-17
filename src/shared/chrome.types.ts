// src/app/core/chrome-extension/chrome-types.ts (or similar location)

export enum ConnectionStatus {
  Connecting = 'CONNECTING',
  Connected = 'CONNECTED',
  Disconnected = 'DISCONNECTED',
}

export enum DefaultPrompt {
  Summarise = 'Summarise',
  Explain = 'Explain',
  CustomContent = 'CustomContent',
}

export interface WorkerRequestPayload {

}

export interface SummariseContentRequest extends WorkerRequestPayload {
  promptName?: string;
  userPrompt?: string;
  content: string;
}

export interface SummariseTabRequest extends WorkerRequestPayload {
  promptName?: string;
  userPrompt?: string;
  tabId: number;
}

export interface AskQuestionRequest extends WorkerRequestPayload {
  content: string;
}

export enum WorkerRequestType {
  SummariseTab,
  SummariseContent,
  GetState,
  AskQuestion,
}

export interface WorkerRequest<T extends WorkerRequestPayload> {
  type: WorkerRequestType;
  payload?: T;
}

export enum Role {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
}

export enum PluginState {
  Ready,
  Requested,
  StreamingResponse,
}

export enum ChatType {
  Primary,
  Chat,
}

export enum ChatMessageState {
  Requested,
  Streaming,
  Finished,
  FinishedAndRendered,
}

export interface ApiMessage {
  role: Role;
  content?: string;
}

export interface ChatMessage extends ApiMessage {
  type: ChatType;
  state: ChatMessageState;
  id: number;
}

export interface PopupMessagePayload {

}

export interface PopupState extends PopupMessagePayload {
  state?: PluginState;
  apiMessages?: ApiMessage[];
  chatMessages?: ChatMessage[];
}

export enum PopupMessageType {
  Error,
  State,
  Complete,
  Update,
}

export interface PopupMessage<T extends PopupMessagePayload> {
  type: PopupMessageType,
  payload?: T;
}
