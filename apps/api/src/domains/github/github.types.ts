export interface GithubRepo {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
}

export interface GithubInstallationInfo {
  id: number;
  account: { login: string } | null;
}

export interface InstallationEvent {
  action:
    | 'created'
    | 'deleted'
    | 'suspend'
    | 'unsuspend'
    | 'new_permissions_accepted';
  installation: GithubInstallationInfo;
}

export interface InstallationRepositoriesEvent {
  action: 'added' | 'removed';
  installation: GithubInstallationInfo;
}

export interface PushEvent {
  ref: string;
  after: string;
  deleted: boolean;
  repository: GithubRepo;
  installation?: { id: number };
}

export interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    draft: boolean;
    merged: boolean;
    head: { sha: string };
    base: { ref: string };
    user: { login: string; type: string };
  };
  repository: GithubRepo;
}
