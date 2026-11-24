import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { GithubRepo } from '../github/github.types';
import { GitRepository } from './git-repository.entity';

@Injectable()
export class RepositoriesService {
  constructor(
    @InjectRepository(GitRepository)
    private readonly repos: Repository<GitRepository>,
  ) {}

  listOwned(userId: string): Promise<GitRepository[]> {
    return this.repos.find({
      where: { installation: { userId } },
      order: { fullName: 'ASC' },
    });
  }

  async findOwned(id: string, userId: string): Promise<GitRepository> {
    const repo = await this.repos.findOne({
      where: { id, installation: { userId } },
    });
    // 404, а не 403: не раскрываем, что чужой репозиторий существует.
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }

  findWithInstallation(id: string): Promise<GitRepository | null> {
    return this.repos.findOne({
      where: { id },
      relations: { installation: true },
    });
  }

  findByGithubId(githubRepoId: number): Promise<GitRepository | null> {
    return this.repos.findOne({
      where: { githubRepoId: String(githubRepoId) },
      relations: { installation: true },
    });
  }

  /** Приводит список репозиториев установки к тому, что вернул GitHub. */
  async syncInstallation(
    installationId: string,
    repos: GithubRepo[],
  ): Promise<void> {
    if (repos.length) {
      await this.repos.upsert(
        repos.map((r) => ({
          githubRepoId: String(r.id),
          fullName: r.full_name,
          defaultBranch: r.default_branch,
          private: r.private,
          installationId,
        })),
        ['githubRepoId'],
      );
    }
    await this.repos.delete({
      installationId,
      githubRepoId: Not(
        In(repos.length ? repos.map((r) => String(r.id)) : ['-1']),
      ),
    });
  }

  async updateAgentSettings(
    id: string,
    settings: Partial<
      Pick<
        GitRepository,
        'agentTriage' | 'agentAutoFix' | 'agentPrReview' | 'maxOpenAgentPrs'
      >
    >,
  ): Promise<GitRepository> {
    await this.repos.update(id, settings);
    return this.repos.findOneByOrFail({ id });
  }

  async updateFromPush(repo: GitRepository, gh: GithubRepo): Promise<void> {
    if (
      repo.fullName === gh.full_name &&
      repo.defaultBranch === gh.default_branch
    )
      return;
    await this.repos.update(repo.id, {
      fullName: gh.full_name,
      defaultBranch: gh.default_branch,
    });
    repo.fullName = gh.full_name;
    repo.defaultBranch = gh.default_branch;
  }
}
