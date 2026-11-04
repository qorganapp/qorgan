import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '../api/auth';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  return (
    auth.isAuthenticated() ||
    inject(Router).createUrlTree(['/sign-in'], { queryParams: { returnUrl: state.url } })
  );
};

export const guestGuard: CanActivateFn = () =>
  !inject(Auth).isAuthenticated() || inject(Router).createUrlTree(['/']);
