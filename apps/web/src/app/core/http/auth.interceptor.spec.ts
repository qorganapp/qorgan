import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Auth } from '../api/auth';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let auth: Auth;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
  });

  afterEach(() => ctrl.verify());

  function signIn(token: string) {
    auth.signIn('alice', 'pw').subscribe();
    ctrl.expectOne('/api/auth/sign-in').flush({ accessToken: token });
    ctrl.expectOne('/api/auth/me').flush({ id: '1', username: 'alice', createdAt: '' });
  }

  it('attaches the bearer token to API calls but not to session endpoints', () => {
    signIn('t1');
    http.get('/api/repositories').subscribe();
    expect(ctrl.expectOne('/api/repositories').request.headers.get('Authorization')).toBe(
      'Bearer t1',
    );
  });

  it('refreshes once for several parallel 401s and retries all of them', () => {
    signIn('old');
    const results: unknown[] = [];
    http.get('/api/repositories').subscribe((r) => results.push(r));
    http.get('/api/github/installations').subscribe((r) => results.push(r));

    ctrl.expectOne('/api/repositories').flush(null, { status: 401, statusText: 'Unauthorized' });
    ctrl
      .expectOne('/api/github/installations')
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    const refresh = ctrl.match('/api/auth/refresh');
    expect(refresh).toHaveLength(1);
    refresh[0].flush({ accessToken: 'new' });

    const retried = ctrl.match((r) => r.headers.get('Authorization') === 'Bearer new');
    expect(retried).toHaveLength(2);
    retried.forEach((r) => r.flush([]));
    expect(results).toHaveLength(2);
  });

  it('logs out and redirects to sign-in when refresh fails', () => {
    signIn('old');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    let failed = false;
    http.get('/api/repositories').subscribe({ error: () => (failed = true) });

    ctrl.expectOne('/api/repositories').flush(null, { status: 401, statusText: 'Unauthorized' });
    ctrl.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(failed).toBe(true);
    expect(auth.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/sign-in'], expect.anything());
  });

  it('passes through non-401 errors untouched', () => {
    signIn('t');
    let status = 0;
    http.get('/api/repositories').subscribe({ error: (e) => (status = e.status) });
    ctrl.expectOne('/api/repositories').flush(null, { status: 500, statusText: 'Boom' });
    ctrl.expectNone('/api/auth/refresh');
    expect(status).toBe(500);
  });
});
