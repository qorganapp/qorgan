import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { Repository, SpaceDetail, SpaceListItem } from '../api/api.types';
import { QorganApi } from '../api/qorgan-api';
import { RepoContext } from './repo-context';
import { SpaceContext } from './space-context';

const repo = (id: string): Repository => ({
  id,
  githubRepoId: id,
  fullName: `acme/${id}`,
  defaultBranch: 'main',
  private: true,
  installationId: 'i',
  createdAt: '',
  agentTriage: true,
  agentAutoFix: true,
  agentPrReview: true,
  maxOpenAgentPrs: 3,
});

const item = (id: string, repositoryCount = 0): SpaceListItem => ({
  id,
  name: id,
  repositoriesChangedAt: '',
  createdAt: '',
  updatedAt: '',
  repositoryCount,
});

const detail = (id: string, repos: string[]): SpaceDetail => {
  const { repositoryCount: _count, ...space } = item(id);
  return { ...space, repositories: repos.map(repo) };
};

describe('SpaceContext', () => {
  let api: {
    spaces: ReturnType<typeof vi.fn>;
    space: ReturnType<typeof vi.fn>;
    repositories: ReturnType<typeof vi.fn>;
    createSpace: ReturnType<typeof vi.fn>;
    deleteSpace: ReturnType<typeof vi.fn>;
    removeSpaceRepository: ReturnType<typeof vi.fn>;
  };
  let spaces: SpaceContext;
  let repos: RepoContext;

  beforeEach(() => {
    localStorage.clear();
    api = {
      spaces: vi.fn(() => of([item('core', 2), item('web', 1)])),
      space: vi.fn((id: string) => of(detail(id, id === 'core' ? ['a', 'b'] : ['c']))),
      repositories: vi.fn(() => of([repo('a'), repo('b'), repo('c')])),
      createSpace: vi.fn((name: string, ids: string[]) => of(detail(name, ids))),
      deleteSpace: vi.fn(() => of(undefined)),
      removeSpaceRepository: vi.fn(() => of(detail('core', ['a']))),
    };
    TestBed.configureTestingModule({ providers: [{ provide: QorganApi, useValue: api }] });
    spaces = TestBed.inject(SpaceContext);
    repos = TestBed.inject(RepoContext);
    repos.load();
  });

  it('selects the first space and scopes repositories to it', () => {
    spaces.load();
    expect(spaces.selected()?.id).toBe('core');
    expect(repos.scoped().map((r) => r.id)).toEqual(['a', 'b']);
    expect(repos.selected()?.id).toBe('a');
  });

  it('switches spaces, remembers the choice and re-scopes the selected repository', () => {
    spaces.load();
    repos.select('b');
    spaces.select('web');
    expect(localStorage.getItem('qorgan.selectedSpace')).toBe('web');
    expect(repos.scoped().map((r) => r.id)).toEqual(['c']);
    // «b» не входит в новое пространство — выбран первый его репозиторий.
    expect(repos.selected()?.id).toBe('c');
  });

  it('ignores a slow response for a space that is no longer selected', () => {
    const slow = new Subject<SpaceDetail>();
    api.space.mockImplementation((id: string) => (id === 'core' ? slow : of(detail(id, ['c']))));
    spaces.load();
    spaces.select('web');
    slow.next(detail('core', ['a', 'b']));
    expect(spaces.detail()?.id).toBe('web');
  });

  it('selects a newly created space and keeps counts in sync after changes', () => {
    spaces.load();
    spaces.create('ops', ['c']).subscribe();
    expect(spaces.selected()?.id).toBe('ops');
    expect(spaces.spaces().find((s) => s.id === 'ops')?.repositoryCount).toBe(1);

    spaces.select('core');
    spaces.removeRepository('core', 'b').subscribe();
    expect(spaces.selected()?.repositoryCount).toBe(1);
    expect(repos.scoped().map((r) => r.id)).toEqual(['a']);
  });

  it('falls back to another space when the selected one is deleted', () => {
    spaces.load();
    spaces.remove('core').subscribe();
    expect(spaces.selected()?.id).toBe('web');
    expect(spaces.detail()?.id).toBe('web');
  });
});
