import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Observable, delay, from, mergeMap, of, throwError } from 'rxjs';
import type { MockBackend } from '../mock/mock-backend';
import { isMockMode } from '../mock/mock-mode';

let backend: Promise<MockBackend> | null = null;

/** Mock-бэкенд и его фикстуры грузятся отдельным чанком — в обычной сборке их нет. */
const loadBackend = () =>
  (backend ??= import('../mock/mock-backend').then((m) => new m.MockBackend()));

export const mockInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/') || !isMockMode()) return next(req);

  return from(loadBackend()).pipe(
    mergeMap((mock): Observable<HttpResponse<unknown>> => {
      const [, query = ''] = req.urlWithParams.split('?');
      const res = mock.handle({
        method: req.method,
        url: req.url,
        params: new URLSearchParams(query),
        body: req.body,
      });
      if (res.status >= 400) {
        return throwError(
          () => new HttpErrorResponse({ status: res.status, error: res.body, url: req.url }),
        );
      }
      return of(new HttpResponse({ status: res.status, body: res.body, url: req.url }));
    }),
    delay(180 + Math.random() * 220),
  );
};
