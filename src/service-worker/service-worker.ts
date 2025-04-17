import {
  BehaviorSubject,
  catchError,
  debounceTime,
  EMPTY,
  expand,
  filter,
  from,
  map,
  Observable,
  of,
  scan,
  startWith,
  Subject,
  takeUntil,
  throwError,
  withLatestFrom
} from 'rxjs';
import {
  ApiMessage,
  ChatMessageState,
  ChatType,
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

const currentState$ = new BehaviorSubject<PopupState>(getDefaultState());
const stateUpdates$ = new Subject<StateUpdate<PopupState>>();
const messages$ = new Subject<WorkerRequest<WorkerRequestPayload>>();
currentState$.subscribe(console.log);
let popupPort: Port | null = null;

function getDefaultState() : PopupState {
  return { state: PluginState.Ready };
}

function updateState(updatedState: PopupState) {
  stateUpdates$.next({updateObject:updatedState});
}
function updateFromCurrent(updateMethod: (existing: PopupState) => PopupState): void {
  stateUpdates$.next({updateMethod: updateMethod});
}

function getStateFromStorage(): Promise<PopupState> {
  return new Promise((resolve, reject) => {
    if (!IS_EXTENSION_CONTEXT) reject('Not running as extension');
    chrome.storage.sync.get([STATE_KEY], (items) => {
      if (items[STATE_KEY] != null)
        resolve(items[STATE_KEY]);
      else reject();
    });
  });
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
            console.error("CS: Error during content extraction script:", e);
            return document.body.innerText.replace(/\s\s+/g, ' ').trim();
          }
          return '';
        }
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.error("BG: Scripting Error:", chrome.runtime.lastError.message);
          return reject(`Failed to execute content extraction script: ${chrome.runtime.lastError.message}`);
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
                  console.error("BG: Fallback content extraction failed:", chrome.runtime.lastError?.message);
                  return reject("Failed to extract any meaningful content.");
                }
                if (fallbackResults[0].result.trim().length === 0) {
                  console.error("BG: Even fallback body.innerText extraction yielded empty string.");
                  return reject("Page seems to contain no extractable text.");
                }
                resolve(fallbackResults[0].result);
              }
            );
          }
        } else {
          console.error("BG: Content extraction script returned unexpected result:", results);
          reject("Failed to extract content: script did not return valid text.");
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
    // if (currentAbortController) {
    //   currentAbortController.abort();
    //   currentAbortController = null;
    // }
  }
}

async function hitApi(settings: appSettings, messages: ApiMessage[], isNewPrimary: boolean): Promise<void> {
  updateFromCurrent(s => ({
    state: PluginState.Requested,
    apiMessages: messages,
    chatMessages: isNewPrimary
      ? [{id: 1, state: ChatMessageState.Requested, type: s.chatMessages?.length ?? 0 > 0 ? ChatType.Primary : ChatType.Chat, role: Role.Assistant }]
      : [...s.chatMessages?.filter(c => c.state === ChatMessageState.Finished || c.state === ChatMessageState.FinishedAndRendered) ?? [], {id: (s.chatMessages?.length ?? 0) + 1, state: ChatMessageState.Requested, type: s.chatMessages?.length ?? 0 > 0 ? ChatType.Primary : ChatType.Chat, role: Role.Assistant }]
  }));

  const response = await fetch(settings.baseUrl, {
    method: "POST",
    headers: settings.token?.length ?? 0 > 0
      ? { "Content-Type": "application/json", "Authorization": `Bearer ${settings.token}` }
      : { "Content-Type": "application/json", },
    body: JSON.stringify({
      model: settings.model,
      messages: messages,
      temperature: 0.3,
      max_tokens: -1,
      stream: true,
    }),
  });

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

  // Process stream
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

      // Decode the current chunk
      const buffer = decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // buffer = lines.pop() ?? '';

      // Process each line in the chunk
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
            console.warn("BG: Failed to parse JSON chunk:", jsonStr, error);
          }
        }
      }

      return responseText;
    }),
    scan((a,v) => a + v, ''),
    takeUntil(messages$),
  ).subscribe({
    next: v => {
      if (v) {
        updateFromCurrent(s => ({
          chatMessages: s.chatMessages?.map(c => (c.state === ChatMessageState.Streaming || c.state === ChatMessageState.Requested ? ({...c, content: v }) : c))
            ?? [{id: 1, state: ChatMessageState.Streaming, content: v, type: ChatType.Primary, role: Role.Assistant}]
        }));
      }
    },
    error: e => console.error(e),
    complete: () => {
      reader.cancel('finished or no longer reading').then();
      updateFromCurrent(s => ({state: PluginState.Ready, chatMessages: s.chatMessages?.map(c => (c.state === ChatMessageState.Streaming || c.state === ChatMessageState.Requested ? ({...c, state: ChatMessageState.Finished }) : c)) ?? []}));
    },
  });
}

async function summariseUserContent(content: string, lang: string, systemPromptName: string | null = null): Promise<void> {
  try {
    const settings = await getSettings();
    const prompt = settings.prompts.find(p => p.name === (systemPromptName ?? 'CustomContent')) ?? settings.prompts[0];

    if (content && content.trim().length > 0) {
      // safeSendMessage({ type: "context", payload: content });
    } else {
      const errorMsg =  'No content provided.';
      safeSendMessage({ type: PopupMessageType.Error, payload: errorMsg });
      throw new Error(errorMsg);
    }

    const systemCommand = prompt.prompt.replace(/{lang}/g, lang);

    const messages = [{ role: Role.System, content: systemCommand }, { role: Role.User, content: content.trim() }];

    await hitApi(settings, messages, true);

  } catch (error) {
    console.error('error summarising content', error);
    return;
  }
}

async function summariseTabContent(tabId: number, lang: string, promptName?: string) {
  try {
    const settings = await getSettings();
    const prompt = settings.prompts.find(p => p.name === promptName) ?? settings.prompts[0];

    const content = await extractTabContent(tabId);
    if (content && content.trim().length > 0) {
      // safeSendMessage({ type: "context", payload: content }); // Send web context
    } else {
      console.warn("Extracted web content is empty.");
    }

    const systemCommand = prompt.prompt.replace(/{lang}/g, lang);

    const messages = [{ role: Role.System, content: systemCommand }, { role: Role.User, content: content.trim() }];

    return await hitApi(settings, messages, true);

  } catch (e) {
    console.error('error summarising tab', e);
    return '';
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

    console.log('update state', updateObj, acc, isUpdateMethod);
    return ({ ...acc, ...updateObj });
  }, ({ ...getDefaultState() })),
  debounceTime(1),
  startWith(getDefaultState()),
  catchError(() => of(getDefaultState())),
).subscribe(v => currentState$.next(v));

currentState$.subscribe(s => safeSendMessage({type: PopupMessageType.State, payload: s} as PopupMessage<PopupState>));
messages$.subscribe(s => console.log('message received', s));

messages$.pipe(
  filter(m => m.type == WorkerRequestType.SummariseContent),
  map(v => v.payload as SummariseContentRequest),
  catchError((e) => of(null)),
  filter(v => v != null),
).subscribe(async v => {
  try {
    const fullResult = await summariseUserContent(v.content, v.lang);
    console.log(fullResult);
  } catch (e) {
    console.error(e);
  }
});

messages$.pipe(
  filter(m => m.type == WorkerRequestType.SummariseTab),
  map(v => v.payload as SummariseTabRequest),
  catchError((e) => of(null)),
  filter(v => v != null),
).subscribe(v => summariseTabContent(v.tabId, v.lang, v.promptName));

messages$.pipe(
  filter(m => m.type == WorkerRequestType.GetState),
  withLatestFrom(currentState$),
  map(([,s]) => s),
  catchError((e) => of(null)),
  filter(v => v != null),
).subscribe(v => safeSendMessage({type: PopupMessageType.State, payload: v} as PopupMessage<PopupState>));

getStateFromStorage().then(v => {if (v != null) { updateState(v); } }).catch(e => console.log('no existing state'));

if (IS_EXTENSION_CONTEXT) {
  chrome.runtime.onConnect.addListener((port: Port) => {
    if (port.name !== PORT_NAME) return;
    popupPort = port;
    port.onMessage.addListener((message) => {
      console.log('message listener', message);
      messages$.next(message)
    });
    port.onDisconnect.addListener(() => console.log('disconnect'));
  });
}
