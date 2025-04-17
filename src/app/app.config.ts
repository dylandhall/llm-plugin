import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import {
  provideRouter,
  withHashLocation
} from '@angular/router';
import { routes } from './app.routes';
import { ChromeExtensionService } from './chrome-extension.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withHashLocation()),
    ChromeExtensionService
  ]
};
