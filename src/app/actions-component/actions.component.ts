import {
  AsyncPipe,
  NgClass
} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
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
  debounceTime,
  filter,
  map,
  pairwise,
  startWith,
} from 'rxjs';
import {
  ChatMessage,
  ChatMessageState,
  ChatType,
  DefaultPrompt,
  PopupMessageType,
  PopupState,
  Role
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
  public readonly canClear = signal(false);

  @ViewChild('messages', {static: true}) private messagesContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('chatInputElem', {static: false}) private chatInputElem!: ElementRef<HTMLDivElement>;

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
      map(v =>
          ({hasFinished: v.some(m => m.state === ChatMessageState.FinishedAndRendered || m.state === ChatMessageState.Finished), hasAny: v.length > 0})),
      takeUntilDestroyed(),
    ).subscribe(({hasFinished, hasAny}) => {
      this.canChat.set(hasFinished);
      this.canClear.set(hasAny);
      if (!hasFinished && this.showChat()) this.showChat.set(false);
    });

    this.messages$.pipe(
      startWith([] as ChatMessage[]),
      pairwise(),
      filter(([a,b]) =>
        (a.length < b.length)
        || (a.filter(m => m.state === ChatMessageState.FinishedAndRendered).length < b.filter(m => m.state === ChatMessageState.FinishedAndRendered).length)),
      debounceTime(10),
      takeUntilDestroyed(),
    ).subscribe(() => this.scrollToBottom());

    this.backgroundService.requestState();
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

  @HostListener('window:keydown', ['$event'])
  public onGlobalKey($event: KeyboardEvent): void {
    if ($event.ctrlKey && ($event.key === 'b' || $event.key === 'B')) {
      $event.preventDefault();
      this.showChat.set(!this.showChat());
      if (this.showChat()) {
        setTimeout(() => this.chatInputElem?.nativeElement?.focus(), 1);
      }
    }
  }

  private scrollToBottom(): void {
    try {
      const element = this.messagesContainer?.nativeElement;
      if (!element) return;
      element.scrollTop = element.scrollHeight;
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }

  public clearChat(): void {
    this.backgroundService.clearChat();
  }

  protected readonly Role = Role;

  public openChat() {
    this.showChat.set(true);
    setTimeout(() => this.chatInputElem?.nativeElement?.focus(), 1);
  }
}
