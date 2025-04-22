import {
  Component,
  OnInit,
  inject,
  ChangeDetectionStrategy
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import {
  MatButton,
  MatIconButton
} from '@angular/material/button';
import {
  MatFormField,
  MatLabel,
  MatInput
} from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { defaultAppSettings } from '../../shared/defaults';
import { getSettings, saveSettings } from '../../shared/settings';
import { appSettings } from '../../shared/types';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-options',
  standalone: true,
  imports: [
    MatInput,
    MatFormField,
    MatLabel,
    MatButton,
    MatIconModule,
    ReactiveFormsModule,
    MatCardModule,
    MatDividerModule,
    MatIconButton
  ],
  templateUrl: './options.component.html',
  styleUrl: './options.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionsComponent implements OnInit {
  private formBuilder = inject(FormBuilder);

  settingsForm: FormGroup = this.formBuilder.group({
    baseUrl: ['', Validators.required],
    model: ['', Validators.required],
    lang: ['', Validators.required],
    maxTokens: [-1, Validators.required],
    token: [],
    prompts: this.formBuilder.array([])
  });

  get promptsArray() {
    return this.settingsForm.get('prompts') as FormArray;
  }

  ngOnInit() {
    this.loadSettings().then();
  }

  async loadSettings() {
    const settings = await getSettings();

    this.patchSettings(settings);

    while (this.promptsArray.length) {
      this.promptsArray.removeAt(0);
    }

    settings.prompts.forEach(prompt => {
      this.promptsArray.push(
        this.formBuilder.group({
          name: [prompt.name, Validators.required],
          prompt: [prompt.prompt, Validators.required]
        })
      );
    });
  }

  addPrompt() {
    this.promptsArray.push(
      this.formBuilder.group({
        name: ['', Validators.required],
        prompt: ['', Validators.required]
      })
    );
  }

  removePrompt(index: number) {
    this.promptsArray.removeAt(index);
  }

  async send() {
    if (this.settingsForm.valid) {
      const settings: appSettings = this.settingsForm.value;
      await saveSettings(settings);
    }
  }


  resetToDefaults() {
    this.patchSettings(defaultAppSettings);

    // Clear existing prompts
    while (this.promptsArray.length) {
      this.promptsArray.removeAt(0);
    }

    // Add default prompts to form array
    defaultAppSettings.prompts.forEach(prompt => {
      this.promptsArray.push(
        this.formBuilder.group({
          name: [prompt.name, Validators.required],
          prompt: [prompt.prompt, Validators.required]
        })
      );
    });
  }

  private patchSettings(appSettings: appSettings): void {
    this.settingsForm.patchValue({
      baseUrl: appSettings.baseUrl,
      model: appSettings.model,
      lang: appSettings.lang,
      maxTokens: appSettings.maxTokens ?? -1,
      token: appSettings.token,
    });
  }
}
