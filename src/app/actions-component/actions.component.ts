import { ChangeDetection } from '@angular/cli/lib/config/workspace-schema';
import {
  AsyncPipe,
  NgClass
} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
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
import {
  BehaviorSubject,
  filter,
  map,
  tap
} from 'rxjs';
import {
  ChatMessage,
  ChatType,
  DefaultPrompt,
  PopupMessageType,
  PopupState
} from '../../shared/chrome.types';
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
    NgClass
  ],
  templateUrl: './actions.component.html',
  styleUrl: './actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionsComponent implements OnInit {
  protected readonly ChatType = ChatType;
  protected readonly DefaultPrompt = DefaultPrompt;
  public showChat = signal<boolean>(false);
  private readonly backgroundService: ChromeExtensionService = inject(ChromeExtensionService);
  public messages$: BehaviorSubject<ChatMessage[]> = new BehaviorSubject([] as ChatMessage[]);
  public chatInput = new FormControl<any>('');

  constructor() {
    this.backgroundService.getServiceMessages$().pipe(
      filter(v => v.type === PopupMessageType.State),
      tap(v => console.log('popup message received', v)),
      map(v => v.payload as PopupState),
      takeUntilDestroyed(),
    ).subscribe(s => this.messages$.next(s.chatMessages ?? []));
  }

  ngOnInit(): void {
    this.backgroundService.requestState();
  }

  public async send(promptName: DefaultPrompt): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('Can\'t get tab');

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: () => window.getSelection()?.toString() ?? '' }, (selection) => {
        try { // Add try block inside callback for error handling
          if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message || "Script execution failed.");

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

  }
}
