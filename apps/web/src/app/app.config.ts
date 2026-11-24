import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { Auth } from './core/api/auth';
import { authInterceptor } from './core/http/auth.interceptor';
import { mockInterceptor } from './core/http/mock.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    // authInterceptor раньше mock: тогда и в демо-режиме работает та же логика токенов.
    provideHttpClient(withInterceptors([authInterceptor, mockInterceptor])),
    // До первого рендера пробуем восстановить сессию по refresh-cookie.
    provideAppInitializer(() => inject(Auth).restore()),
  ],
};
