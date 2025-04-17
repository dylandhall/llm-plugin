import {
  AsyncPipe,
  NgClass
} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MatFormField,
  MatInput
} from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import {
  BehaviorSubject,
  filter,
  map,
  pairwise,
  skip,
  startWith,
  take,
  takeUntil,
  timer,
} from 'rxjs';
import {
  ChatMessage,
  ChatMessageState,
  ChatType,
  DefaultPrompt,
  PopupMessageType,
  PopupState
} from '../../shared/chrome.types';
import { IS_EXTENSION_CONTEXT } from '../../shared/constants';
import { getSettings } from '../../shared/settings';
import { prompt } from '../../shared/types';
import { ChromeExtensionService } from '../chrome-extension.service';

@Component({
  selector: 'app-actions-component',
  imports: [
    MatButton,
    MatFormField,
    MatInput,
    FormsModule,
    AsyncPipe,
    ReactiveFormsModule,
    NgClass,
    MatProgressSpinner,
  ],
  templateUrl: './actions.component.html',
  styleUrl: './actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionsComponent implements OnInit {
  protected readonly ChatType = ChatType;
  protected readonly DefaultPrompt = DefaultPrompt;

  public readonly showChat = signal(false);
  public readonly canChat = signal(false);

  @ViewChild('messages') private messagesContainer!: ElementRef<HTMLDivElement>;

  private readonly backgroundService: ChromeExtensionService = inject(ChromeExtensionService);
  public readonly messages$: BehaviorSubject<ChatMessage[]> = new BehaviorSubject([] as ChatMessage[]);
  public readonly chatInput = new FormControl<string>('');
  public readonly customPrompts = signal<Array<prompt>>([]);

  constructor() {

    this.backgroundService.getServiceMessages$().pipe(
      filter(v => v.type === PopupMessageType.State),
      map(v => v.payload as PopupState),
      takeUntilDestroyed(),
    ).subscribe(s => this.messages$.next(s.chatMessages ?? []));

    this.messages$.pipe(
      map(v => v.some(m => m.state === ChatMessageState.FinishedAndRendered || m.state === ChatMessageState.Finished)),
      takeUntilDestroyed(),
    ).subscribe(v => {
      this.canChat.set(v);
      if (!v && this.showChat()) this.showChat.set(false);
    });

    this.messages$.pipe(
      pairwise(),
      filter(([a,b]) => (a.length < b.length)),
      takeUntilDestroyed(),
    ).subscribe(() => this.scrollToBottom());

    // unsure if needed, but in case the background isn't ready when i first request the state
    timer(100).pipe(
      startWith(0),
      takeUntil(this.messages$.pipe(skip(1), takeUntilDestroyed(), take(1))),
      takeUntilDestroyed(),
    ).subscribe(() => {
      this.backgroundService.requestState();
    });

  }

  ngOnInit(): void {
    this.loadCustomPrompts().then();
  }

  private async loadCustomPrompts(): Promise<void> {
    const settings = await getSettings();
    this.customPrompts.set(settings.prompts?.filter(p => p.name !== DefaultPrompt.CustomContent) ?? []);
  }

  public async send(promptName: string): Promise<void> {
    if (!IS_EXTENSION_CONTEXT) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('Can\'t get tab');

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: () => window.getSelection()?.toString() ?? '' }, (selection) => {
        try {
          if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message ?? "Script error");

          const selectedText = selection?.[0]?.result?.trim() ?? '';
          if (selectedText.length > 0){
            this.backgroundService.sendSummariseContent(selectedText, promptName);
          } else {
            this.backgroundService.sendSummariseTab(tab.id ?? 1, promptName);
          }

        } catch (e) {
          console.error(e);
        }
      });
  }

  public sendChat(): void {
    if (!this.chatInput.value) return;
    this.backgroundService.sendQuestion(this.chatInput.value);
    this.chatInput.setValue('');
  }

  protected readonly ChatMessageState = ChatMessageState;

  public onKey($event: KeyboardEvent): void {
    if ($event.key === 'Enter' && !$event.shiftKey && !$event.ctrlKey) {
      $event.preventDefault();
      this.sendChat();
    }
  }

  // Helper method to scroll to the bottom
  private scrollToBottom(): void {
    try {
      const element = this.messagesContainer?.nativeElement;
      if (!element) return;
      element.scrollTop = element.scrollHeight;
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }
}
