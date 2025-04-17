import {
  Component,
  inject
} from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MatFormField,
  MatInput
} from '@angular/material/input';
import { ChromeExtensionService } from '../chrome-extension.service';

@Component({
  selector: 'app-options',
  imports: [
    MatInput,
    MatFormField,
    MatButton,
  ],
  templateUrl: './options.component.html',
  styleUrl: './options.component.scss'
})
export class OptionsComponent {
  protected readonly modelInput = new FormControl<string>('');

  private readonly chromeService = inject(ChromeExtensionService);
  public send(): void {
  }
}
