import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api.types';
import { Auth } from '../../core/api/auth';
import { isMockMode } from '../../core/mock/mock-mode';
import { Icon } from '../../shared/icon';
import { MODULE_LIST } from '../../shared/module-meta';
import { SectionBadge } from '../../shared/section-badge';

@Component({
  selector: 'app-auth-page',
  imports: [FormsModule, RouterLink, Icon, SectionBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.scss',
})
export class AuthPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Из data маршрута: sign-in | sign-up */
  readonly mode = input<'sign-in' | 'sign-up'>('sign-in');
  readonly returnUrl = input<string>();

  protected readonly modules = MODULE_LIST;
  protected readonly isSignUp = computed(() => this.mode() === 'sign-up');
  protected readonly demo = isMockMode();

  protected username = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const request = this.isSignUp()
      ? this.auth.signUp(this.username.trim(), this.password)
      : this.auth.signIn(this.username.trim(), this.password);
    request.subscribe({
      next: () => void this.router.navigateByUrl(this.safeReturnUrl()),
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(e, 'Could not sign in. Try again.'));
      },
    });
  }

  /** Только относительные пути внутри приложения — без open redirect. */
  private safeReturnUrl(): string {
    const url = this.returnUrl() ?? this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
    return url.startsWith('/') && !url.startsWith('//') ? url : '/';
  }
}
