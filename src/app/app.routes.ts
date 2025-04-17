import { Routes } from '@angular/router';
import { ActionsComponent } from './actions-component/actions.component';

export const routes: Routes = [
  {path: '', component: ActionsComponent},
  {path: 'options', loadChildren: () => import('./options/options.routes').then(r => r.routes)}
];
