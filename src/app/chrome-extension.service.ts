import {
  Injectable,
  NgZone,
  OnDestroy
} from '@angular/core';
import {
  filter,
  map,
  Observable,
  ReplaySubject,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap
} from 'rxjs';
import {
  AskQuestionRequest,
  PopupMessage,
  PopupMessagePayload,
  SummariseContentRequest,
  SummariseTabRequest,
  WorkerRequest,
  WorkerRequestPayload,
  WorkerRequestType
} from '../shared/chrome.types';
import {
  IS_EXTENSION_CONTEXT,
  PORT_NAME
} from '../shared/constants';
import Port = chrome.runtime.Port; // Adjust path if needed

@Injectable({
  providedIn: 'root',
})
export class ChromeExtensionService implements OnDestroy {

  private readonly port$ = new Subject<Port>();

  // if there are messages queued between the first message adding the port and the port
  // setting up the pipe to handle subsequent messages, this will handle that.
  private readonly messages$ = new ReplaySubject<{isHandled?: boolean, message: WorkerRequest<WorkerRequestPayload>}>(5, 500);
  private readonly serviceMessage$ = new Subject<PopupMessage<PopupMessagePayload>>();

  public getServiceMessages$(): Observable<PopupMessage<PopupMessagePayload>> {
    return this.serviceMessage$.asObservable();
  }

  private readonly onDisconnect$ = new Subject<void>();

  constructor(private zone: NgZone) {
    if (!IS_EXTENSION_CONTEXT) return;

    const messageToSend$ = new Subject<{port: Port, message: WorkerRequest<WorkerRequestPayload>}>();

    messageToSend$.subscribe(({port, message}) => {
      try {
        port.postMessage(message);
      }
      catch (e) {
        console.warn('issue sending message: ', message, 'error:', chrome.runtime.lastError);
        this.messages$.next({message});
      }
    });

    this.port$.pipe(
      switchMap(port =>
        this.messages$.pipe(
          // tap(v => console.log(v, 'message in port pipe')),
          filter(m => m.isHandled !== true),
          // i hate mutating objects, but this is a bit of fun
          tap(m => m.isHandled = true),
          map(message => ({port, message: message.message})),
          takeUntil(this.onDisconnect$),
        )),
      takeUntil(this.destroy$),
    ).subscribe(v => messageToSend$.next(v));

    this.onDisconnect$.pipe(
      switchMap(() => this.messages$),
      filter(v => v.isHandled !== true),
      // tap(v => console.log(v, 'message in disconnected pipe')),
      take(1),
      takeUntil(this.port$),
      takeUntil(this.destroy$),
    ).subscribe(m => {
      const port = chrome.runtime.connect({ name: PORT_NAME });
      console.log('message got port', port);
      m.isHandled = true;
      this.port$.next(port);
      messageToSend$.next({port:port, message: m.message});
    });

    this.port$.subscribe(p => {
      p.onMessage.addListener(this.handleMessage);
      p.onDisconnect.addListener(this.handleDisconnect);
    });

    this.port$.pipe(
      switchMap(p => this.destroy$.pipe(map(() => p))),
      take(1),
      takeUntil(this.onDisconnect$),
    ).subscribe(p => {
      this.zone.run(() => {
        this.handleDisconnect(p);
        p.disconnect();
      });
    });

    // set up message/connect listener
    this.onDisconnect$.next();
  }

  private readonly destroy$: Subject<void> = new Subject<void>();
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public sendSummariseContent(content: string, prompt: string): void {
    this.sendPayload({payload: {content, lang:'English', promptName: prompt} as SummariseContentRequest, type: WorkerRequestType.SummariseContent});
  }

  public sendSummariseTab(tabId: number, prompt: string): void {
    this.sendPayload({payload: {tabId, lang:'English', promptName: prompt} as SummariseTabRequest, type: WorkerRequestType.SummariseTab});
  }

  public sendQuestion(followUp: string): void {
    this.sendPayload({payload: {lang:'English', content: followUp} as AskQuestionRequest, type: WorkerRequestType.AskQuestion});
  }

  public requestState(): void {
    this.sendPayload({payload: {}, type: WorkerRequestType.GetState});
  }

  private sendPayload<T extends WorkerRequestPayload>(message: WorkerRequest<T>):void {
    // console.log('sendPayload', message);
    this.messages$.next({message});
  }

  private handleMessage = (message: any): void => {
    const portMessage = message as PopupMessage<WorkerRequestPayload>;
    if (portMessage == null) return;

    this.zone.run(() => this.serviceMessage$.next(message as PopupMessage<any>));
  };

  private handleDisconnect = (p?: chrome.runtime.Port): void => {
    p?.onDisconnect.removeListener(this.handleDisconnect);
    p?.onMessage.removeListener(this.handleMessage);
    this.onDisconnect$.next();
  };

  // /** Get localized string */
  // getI18nMessage(messageName: string, substitutions?: any): string {
  //   if (!IS_EXTENSION_CONTEXT) return messageName; // Return key if not in extension
  //   try {
  //     return chrome.i18n.getMessage(messageName, substitutions);
  //   } catch (e) {
  //     console.error(`Error getting i18n message for key "${messageName}"`, e);
  //     return messageName; // Return the key as fallback on error
  //   }
  // }
}
