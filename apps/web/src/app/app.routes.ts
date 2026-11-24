import { ResolveFn, Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { MODULES, isScanModule } from './shared/module-meta';

const moduleTitle: ResolveFn<string> = (route) => {
  const id = route.paramMap.get('module');
  return isScanModule(id) ? `${MODULES[id].title} · Qorgan` : 'Qorgan';
};

export const routes: Routes = [
  {
    path: 'sign-in',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    data: { mode: 'sign-in' },
    title: 'Sign in · Qorgan',
  },
  {
    path: 'sign-up',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    data: { mode: 'sign-up' },
    title: 'Create account · Qorgan',
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'space' },
      {
        path: 'space',
        loadComponent: () => import('./features/space/space-page').then((m) => m.SpacePage),
        title: 'Overview · Qorgan',
      },
      {
        path: 'sweep',
        loadComponent: () => import('./features/full-sweep/full-sweep').then((m) => m.FullSweep),
        title: 'Full Sweep · Qorgan',
      },
      {
        path: 'modules/:module',
        loadComponent: () => import('./features/module/module-page').then((m) => m.ModulePage),
        title: moduleTitle,
      },
      {
        path: 'agent',
        loadComponent: () => import('./features/agent/agent-page').then((m) => m.AgentPage),
        title: 'Agent · Qorgan',
      },
      {
        path: 'repositories',
        loadComponent: () =>
          import('./features/repositories/repositories-page').then((m) => m.RepositoriesPage),
        title: 'Repositories · Qorgan',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
