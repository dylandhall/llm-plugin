import MarkdownIt from 'markdown-it';
import {
  BehaviorSubject,
  catchError,
  debounceTime,
  EMPTY,
  expand,
  filter,
  from,
  map,
  of,
  scan,
  startWith,
  Subject,
  takeUntil,
  throttleTime,
  withLatestFrom
} from 'rxjs';
import {
  ApiMessage,
  AskQuestionRequest,
  ChatMessage,
  ChatMessageState,
  ChatType,
  DefaultPrompt,
  PluginState,
  PopupMessage,
  PopupMessagePayload,
  PopupMessageType,
  PopupState,
  Role,
  SummariseContentRequest,
  SummariseTabRequest,
  WorkerRequest,
  WorkerRequestPayload,
  WorkerRequestType
} from '../shared/chrome.types';
import {
  IS_EXTENSION_CONTEXT,
  PORT_NAME,
  STATE_KEY
} from '../shared/constants';
import { getSettings } from '../shared/settings';
import { appSettings } from '../shared/types';
import Port = chrome.runtime.Port;

interface StateUpdate<StateType> {
  updateMethod?: (existingState: StateType) => StateType;
  updateObject?: StateType;
}

const suspendEvent$ = new Subject<void>();
const currentState$ = new BehaviorSubject<PopupState>(getDefaultState());
const stateUpdates$ = new Subject<StateUpdate<PopupState>>();
const messages$ = new Subject<WorkerRequest<WorkerRequestPayload>>();
const markdownProcessor = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true
});

let popupPort: Port | null = null;

function getDefaultState() : PopupState {
  return {state: PluginState.Ready, chatMessages:[], apiMessages: []};
}

function updateState(updatedState: PopupState) {
  stateUpdates$.next({updateObject:updatedState});
}
function updateFromCurrent(updateMethod: (existing: PopupState) => PopupState): void {
  stateUpdates$.next({updateMethod: updateMethod});
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, [...bytes.subarray(i, i + chunkSize)]);
  }
  return btoa(binary);
}

async function saveStateToStorage(state: PopupState): Promise<void> {
  if (!IS_EXTENSION_CONTEXT) return;

  const MAX_CHUNK_SIZE = 6500;
  const stateJson = JSON.stringify(state);

  try {
    const cs = new CompressionStream('gzip');
    const compressedStream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(stateJson));
        ctrl.close();
      }
    }).pipeThrough(cs);

    const arrayBuffer = await new Response(compressedStream).arrayBuffer();

    const base64Compressed = bufferToBase64(arrayBuffer);

    const chunks: Record<string,string> = {};
    const chunkCount = Math.ceil(base64Compressed.length / MAX_CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      const slice = base64Compressed.slice(
        i * MAX_CHUNK_SIZE,
        (i + 1) * MAX_CHUNK_SIZE
      );
      chunks[`${STATE_KEY}_chunk_${i}`] = slice;
    }

    const metaKey = `${STATE_KEY}_meta`;
    const metadata = {
      timestamp: Date.now(),
      chunks: chunkCount,
      length: base64Compressed.length,
    };

    const oldMeta = (await chrome.storage.sync.get(metaKey))[metaKey];
    const oldCount = oldMeta?.chunks ?? 0;

    await chrome.storage.sync.set({
      ...chunks,
      [metaKey]: metadata,
    });

    // 7. Remove any leftover old chunks
    if (oldCount > chunkCount) {
      const toRemove = [];
      for (let i = chunkCount; i < oldCount; i++) {
        toRemove.push(`${STATE_KEY}_chunk_${i}`);
      }
      await chrome.storage.sync.remove(toRemove);
    }
  } catch (err) {
    console.error('Error saving state:', err);
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getStateFromStorage(): Promise<PopupState | null> {
  if (!IS_EXTENSION_CONTEXT) return null;

  const metaKey = `${STATE_KEY}_meta`;
  try {
    // this is ridiculous but gzip compresses the state and chunks it
    // to fit in chrome browser's storage limits
    const { [metaKey]: meta } = await chrome.storage.sync.get(metaKey);
    if (!meta?.chunks || typeof meta.chunks !== 'number') return null;

    const chunkKeys = Array.from(
      { length: meta.chunks },
      (_, i) => `${STATE_KEY}_chunk_${i}`
    );
    const stored = await chrome.storage.sync.get(chunkKeys);

    // 3. Reassemble the base64 string
    const base64 = chunkKeys.map(k => stored[k] || '').join('');

    // 4. Decode to compressed bytes
    const compressedBytes = base64ToUint8Array(base64);

    // 5. Decompress via DecompressionStream
    const ds = new Response(compressedBytes)
      .body!
      .pipeThrough(new DecompressionStream('gzip'));

    // 6. Read the decompressed JSON text
    const stateJson = await new Response(ds).text();

    // 7. Parse and return
    return JSON.parse(stateJson) as PopupState;
  } catch (err) {
    console.error('Error restoring state from storage:', err);
    return null;
  }
}

function extractTabContent(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        injectImmediately: false,
        target: { tabId: tabId },
        func: () => {
          try {
            const clonedBody = document.body.cloneNode(true);
            if (clonedBody instanceof HTMLElement) {
              const selectorsToRemove = "header, footer, nav, aside, .ad, .advertisement, .popup, .modal, .sidebar, script, style, link, [aria-hidden='true'], noscript, iframe, svg, canvas, video, audio, button, input, select, textarea";
              clonedBody.querySelectorAll(selectorsToRemove).forEach(el => el.remove());

              const mainContentSelectors = 'main, article, [role="main"], #main, #content, .main, .content, .post-body, .entry-content';
              let mainContentElement = clonedBody.querySelector(mainContentSelectors);

              let text = mainContentElement ? mainContentElement.textContent : clonedBody.innerText;

              return text?.replace(/\s\s+/g, ' ').trim() ?? '';
            } else {
              console.error("clonedBody is not an HTMLElement");
            }
          } catch (e) {
            console.error("error during content extraction", e);
            return document.body.innerText.replace(/\s\s+/g, ' ').trim();
          }
          return '';
        }
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.error("scripting error:", chrome.runtime.lastError.message);
          return reject(`failed to execute content extraction script: ${chrome.runtime.lastError.message}`);
        }
        if (results && results[0] && typeof results[0].result === 'string') {
          if (results[0].result.trim().length > 0) {
            resolve(results[0].result);
          } else {
            // Attempt fallback if primary extraction yields empty string
            chrome.scripting.executeScript(
              { target: { tabId: tabId }, func: () => document.body.innerText.replace(/\s\s+/g, ' ').trim() },
              (fallbackResults) => {
                if (chrome.runtime.lastError || !fallbackResults || !fallbackResults[0] || typeof fallbackResults[0].result !== 'string') {
                  console.error("fallback content extraction failed:", chrome.runtime.lastError?.message);
                  return reject("failed to extract any content");
                }
                if (fallbackResults[0].result.trim().length === 0) {
                  console.error("fallback body.innerText extraction empty");
                  return reject("page contains no text");
                }
                resolve(fallbackResults[0].result);
              }
            );
          }
        } else {
          console.error("content extraction script returned unexpected result:", results);
          reject("script did not return valid text.");
        }
      }
    );
  });
}

// Function to safely send messages to the potentially closed popup
function safeSendMessage<T extends PopupMessagePayload>(message: PopupMessage<T>) {
  if (!IS_EXTENSION_CONTEXT || !popupPort) return;

  try {
    popupPort.postMessage(message);
  } catch (error) {
    console.warn('issue posting message', message, error);
    popupPort = null;
  }
}

async function hitApi(settings: appSettings, messages: ApiMessage[], isNewPrimary: boolean): Promise<void> {
  updateFromCurrent(s => ({
    state: PluginState.Requested,
    apiMessages: messages,
    chatMessages: isNewPrimary
      ? [{id: 1, state: ChatMessageState.Requested, type: ChatType.Primary, role: Role.Assistant }]
      : [
          ...s.chatMessages?.filter(c => c.state === ChatMessageState.Finished || c.state === ChatMessageState.FinishedAndRendered) ?? [],
          {
            id: (s.chatMessages?.length ?? 0) + 1,
            state: ChatMessageState.Requested,
            type: (s.chatMessages?.some(c => c.state === ChatMessageState.Finished || c.state === ChatMessageState.FinishedAndRendered) ?? false) ? ChatType.Chat : ChatType.Primary,
            role: Role.Assistant
          }
        ]
  }));

  let response: Response;
  try {
    response = await fetch(settings.baseUrl, {
      method: "POST",
      mode: 'cors',
      headers: settings.token?.length ?? 0 > 0
        ? { "Content-Type": "application/json", "Authorization": `Bearer ${settings.token}` }
        : { "Content-Type": "application/json", },
      body: JSON.stringify({
        model: settings.model,
        messages: messages,
        temperature: 0.3,
        max_tokens: settings.maxTokens ?? -1,
        stream: true,
      }),
    });
  } catch (error) {
    console.error('Failed to contact LLM service:', error);
    safeSendMessage({ type: PopupMessageType.Error, payload: "Unable to reach the LLM service. Check that it is running and that the browser has permission to access it." });
    updateFromCurrent(s => ({state: PluginState.Ready, apiMessages: s.apiMessages?.slice(-1) ?? [], chatMessages: s.chatMessages?.filter(c => c.state != ChatMessageState.Streaming) ?? []}));
    throw error;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    safeSendMessage({ type: PopupMessageType.Error, payload: `API Error ${response.status}: ${response.statusText}` });
    updateFromCurrent(s => ({state: PluginState.Ready, apiMessages: s.apiMessages?.slice(-1) ?? [], chatMessages: s.chatMessages?.filter(c => c.state != ChatMessageState.Streaming) ?? []}));

    throw new Error(`API Error: ${response.status} - ${errorBody}`);
  }
  if (!response.body) {
    safeSendMessage({ type: PopupMessageType.Error, payload: "API response body is missing." });
    updateFromCurrent(s => ({state: PluginState.Ready, apiMessages: s.apiMessages?.slice(-1) ?? [], chatMessages: s.chatMessages?.filter(c => c.state != ChatMessageState.Streaming) ?? []}));

    throw new Error("Response body is null.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  from(reader.read()).pipe(
    expand(({done}) => {
      if (done) {
        return EMPTY;
      }
      return from(reader.read());
    }),
    map(({done, value}) => {
      if (done) return null;

      let responseText = '';

      const buffer = decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.substring(6).trim();
          if (jsonStr === "[DONE]" || !jsonStr) continue;

          try {
            const parsedData = JSON.parse(jsonStr);
            if (parsedData?.choices?.[0]?.delta?.content) {
              const contentChunk = parsedData.choices[0].delta.content;
              responseText += contentChunk;
            }
          } catch (error) {
            console.warn("failed to parse JSON chunk:", jsonStr, error);
          }
        }
      }

      return responseText;
    }),
    filter(v => v!=null),
    scan((a,v) => a + v, ''),
    takeUntil(messages$),
  ).subscribe({
    next: v => {
      if (v) {
        updateFromCurrent(s => ({
          state: PluginState.StreamingResponse,
          chatMessages: s.chatMessages?.map(c => (c.state === ChatMessageState.Streaming || c.state === ChatMessageState.Requested ? ({...c, state: ChatMessageState.Streaming, content: v }) : c))
            ?? [{id: 1, state: ChatMessageState.Streaming, content: v, type: ChatType.Primary, role: Role.Assistant}]
        }));
      }
    },
    error: e => console.error('error streaming result', e),
    complete: () => {
      reader.cancel('finished or no longer reading').then();
      updateFromCurrent(s => ({state: PluginState.Ready, chatMessages: s.chatMessages?.map(c => (c.state === ChatMessageState.Streaming || c.state === ChatMessageState.Requested ? ({...c, state: ChatMessageState.Finished }) : c)) ?? []}));
    },
  });
}

async function summariseUserContent(content: string, systemPromptName: string | null = null): Promise<void> {
  try {
    if ((content?.length ?? 0) < 1) return;

    const settings = await getSettings();
    const prompt = settings.prompts.find(p => p.name === (systemPromptName ?? 'CustomContent')) ?? settings.prompts[0];

    const systemCommand = prompt.prompt.replace(/{lang}/g, settings.lang);

    content = 'Please process this information according to your system prompt:\n\n' + content.trim();

    const messages = [{ role: Role.System, content: systemCommand }, { role: Role.User, content: content }];

    await hitApi(settings, messages, true);

  } catch (error) {
    console.error('error summarising content', error);
  }
}

async function summariseTabContent(tabId: number, promptName?: string): Promise<void> {
  try {
    const settings = await getSettings();
    const prompt = settings.prompts.find(p => p.name === promptName) ?? settings.prompts[0];

    let content = await extractTabContent(tabId);
    if ((content?.trim().length ?? 0) < 1) return;

    const systemCommand = prompt.prompt.replace(/{lang}/g, settings.lang);

    content = 'Please process this information according to your system prompt:\n\n' + content.trim();

    const messages = [{ role: Role.System, content: systemCommand }, { role: Role.User, content }];

    await hitApi(settings, messages, true);

  } catch (e) {
    console.error('error summarising tab', e);
  }
}

stateUpdates$.pipe(
  scan((acc, val) => {
    const isUpdateMethod = val.updateObject == null;

    if (isUpdateMethod && val.updateMethod == null)
      return acc;

    const updateObj = isUpdateMethod && val.updateMethod != null
      ? val.updateMethod(acc)
      : val.updateObject;

    return ({ ...acc, ...updateObj });
  }, ({ ...getDefaultState() })),
  debounceTime(1),
  startWith(getDefaultState()),
  catchError(() => of(getDefaultState())),
  takeUntil(suspendEvent$),
).subscribe(v => currentState$.next(v));

currentState$.pipe(
  throttleTime(500, undefined, { leading: true, trailing: true }),
  takeUntil(suspendEvent$),
).subscribe(s => safeSendMessage({ type: PopupMessageType.State, payload: s } as PopupMessage<PopupState>));

if (IS_EXTENSION_CONTEXT) {
  currentState$.pipe(
    throttleTime(5000, undefined, { leading: true, trailing: true }),
    takeUntil(suspendEvent$),
  ).subscribe(async s => {
    try {
      await saveStateToStorage(s);
    } catch (e) {
      console.error('error saving state', e);
    }
  });
}

messages$.pipe(
  filter(m => m.type == WorkerRequestType.SummariseContent),
  map(v => v.payload as SummariseContentRequest),
  catchError((e) => of(null)),
  filter(v => v != null),
  takeUntil(suspendEvent$),
).subscribe(async v => {
  try {
    await summariseUserContent(v.content);
  } catch (e) {
    console.error(e);
  }
});

messages$.pipe(
  filter(m => m.type == WorkerRequestType.ClearChat),
  catchError((e) => of(null)),
  takeUntil(suspendEvent$),
).subscribe(() => {
  updateState(getDefaultState());
});

messages$.pipe(
  filter(m => m.type == WorkerRequestType.SummariseTab),
  map(v => v.payload as SummariseTabRequest),
  catchError((e) => of(null)),
  filter(v => v != null),
  takeUntil(suspendEvent$),
).subscribe(v => summariseTabContent(v.tabId, v.promptName));

messages$.pipe(
  filter(m => m.type == WorkerRequestType.AskQuestion),
  map(v => v.payload as AskQuestionRequest),
  catchError((e) => of(null)),
  filter(v => v?.content != null),
  map(v => <AskQuestionRequest>v),
  withLatestFrom(currentState$),
  filter(([,s]) => (s.apiMessages?.length ?? 0) > 1),
  takeUntil(suspendEvent$),
).subscribe(async ([{content},state]) => {
  const settings = await getSettings();

  const newSystemPrompt = (settings.prompts.find(p => p.name === DefaultPrompt.CustomContent)?.prompt ?? settings.prompts[0]?.prompt ?? '').replace(/{lang}/g, settings.lang);

  const messages: ApiMessage[] =
    [
      {
        role: Role.System,
        content: newSystemPrompt,
      },
      ...(state.apiMessages ?? []).filter(m => m.role !== Role.System),
      {
        role: Role.User,
        content: (content ?? '')  + '\n\n',
      }
    ];

  const chatMessages: ChatMessage[] =
    [...(state.chatMessages ?? []),
      {
        role: Role.User,
        content: (content ?? ''),
        state: ChatMessageState.FinishedAndRendered,
        type: ChatType.Chat,
        id: (state?.chatMessages?.length ?? 0) + 1,
      }
    ];

  updateState(({chatMessages, apiMessages: messages, state: PluginState.Requested}));

  await hitApi(settings, messages, false);
});


messages$.pipe(
  filter(m => m.type == WorkerRequestType.GetState),
  withLatestFrom(currentState$),
  map(([,s]) => s),
  catchError((e) => of(null)),
  filter(v => v != null),
  takeUntil(suspendEvent$),
).subscribe(v => safeSendMessage({type: PopupMessageType.State, payload: v} as PopupMessage<PopupState>));

getStateFromStorage().then(v => {if (v != null) { updateState(v); } }).catch(e => console.log('no existing state', e));

currentState$.pipe(
  filter(s => s.chatMessages?.some(m => m.state === ChatMessageState.Finished) ?? false),
  takeUntil(suspendEvent$),
).subscribe(s => {
  const messagesToProcess = s.chatMessages?.filter(c => c.state === ChatMessageState.Finished && c.content != null && c.content.length > 0) ?? [];
  for (let i = 0; i < messagesToProcess.length; i++) {
    const message = messagesToProcess[i];
    const html = markdownProcessor.render(message.content ?? '');
    updateFromCurrent(cs => ({chatMessages: cs.chatMessages?.map(c => c.id === message.id && c.state === ChatMessageState.Finished ? ({...c, content: html, state: ChatMessageState.FinishedAndRendered }) : c) ?? []}));
  }
});

if (IS_EXTENSION_CONTEXT) {
  chrome.runtime.onConnect.addListener((port: Port) => {
    if (port.name !== PORT_NAME) return;
    popupPort = port;
    port.onMessage.addListener((message) => {
      messages$.next(message)
    });
    // port.onDisconnect.addListener(() => console.log('worker disconnect'));
  });

  chrome.runtime.onSuspend.addListener(() => {
    suspendEvent$.next();
    suspendEvent$.complete();
  });
}
