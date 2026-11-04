import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  finalize,
  firstValueFrom,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';
import { Me } from './api.types';

interface TokenResponse {
  accessToken: string;
}

/**
 * Access-токен живёт только в памяти (signal), refresh — в httpOnly cookie на /api/auth.
 * После перезагрузки страницы сессия восстанавливается через POST /api/auth/refresh.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly token = signal<string | null>(null);
  readonly user = signal<Me | null>(null);
  readonly isAuthenticated = computed(() => this.token() !== null);

  private refreshing$: Observable<string | null> | null = null;

  accessToken(): string | null {
    return this.token();
  }

  signIn(username: string, password: string): Observable<Me> {
    return this.authenticate('/api/auth/sign-in', { username, password });
  }

  signUp(username: string, password: string): Observable<Me> {
    return this.authenticate('/api/auth/sign-up', { username, password });
  }

  /** Один refresh на всех: параллельные 401 ждут один и тот же запрос. */
  refresh(): Observable<string | null> {
    this.refreshing$ ??= this.http
      .post<TokenResponse>('/api/auth/refresh', {}, { withCredentials: true })
      .pipe(
        map((res) => res.accessToken),
        tap((token) => this.token.set(token)),
        catchError(() => {
          this.clear();
          return of(null);
        }),
        finalize(() => (this.refreshing$ = null)),
        shareReplay(1),
      );
    return this.refreshing$;
  }

  /** Вызывается при старте приложения. Ошибки не пробрасываются: нет сессии — значит гость. */
  async restore(): Promise<void> {
    const token = await firstValueFrom(this.refresh());
    if (token) await firstValueFrom(this.loadMe()).catch(() => this.clear());
  }

  logout(): void {
    this.http
      .post('/api/auth/logout', {}, { withCredentials: true })
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        this.clear();
        void this.router.navigateByUrl('/sign-in');
      });
  }

  /** Сессия умерла (refresh не удался) — на экран входа. */
  expire(): void {
    this.clear();
    void this.router.navigate(['/sign-in'], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  private authenticate(url: string, body: object): Observable<Me> {
    return this.http.post<TokenResponse>(url, body, { withCredentials: true }).pipe(
      tap((res) => this.token.set(res.accessToken)),
      switchMap(() => this.loadMe()),
    );
  }

  private loadMe(): Observable<Me> {
    return this.http.get<Me>('/api/auth/me').pipe(tap((me) => this.user.set(me)));
  }

  private clear(): void {
    this.token.set(null);
    this.user.set(null);
  }
}
