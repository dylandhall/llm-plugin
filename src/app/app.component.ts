import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ActionsComponent } from './actions-component/actions.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  imports: [RouterOutlet],
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'llm-plugin';
}
