import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepositoriesService } from '../repositories/repositories.service';
import { ScanTrigger } from '../scans/scan.entity';
import { ScansService } from '../scans/scans.service';
import { GithubAppService } from './github-app.service';
import { GithubInstallation } from './github-installation.entity';
import {
  InstallationEvent,
  InstallationRepositoriesEvent,
  PushEvent,
} from './github.types';

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    @InjectRepository(GithubInstallation)
    private readonly installations: Repository<GithubInstallation>,
    private readonly app: GithubAppService,
    private readonly repositories: RepositoriesService,
    private readonly scans: ScansService,
  ) {}

  listForUser(userId: string) {
    return this.installations.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Привязка установки к пользователю после редиректа с GitHub.
   * Без OAuth-проверки любой мог бы подставить чужой installation_id.
   */
  async link(userId: string, githubInstallationId: string, code: string) {
    const allowed = await this.app.userInstallationIds(code);
    if (!allowed.includes(githubInstallationId)) {
      throw new ForbiddenException(
        'Installation does not belong to this GitHub user',
      );
    }
    const installation = await this.upsertInstallation(githubInstallationId);
    if (installation.userId && installation.userId !== userId) {
      throw new ForbiddenException('Installation is linked to another account');
    }
    installation.userId = userId;
    await this.installations.save(installation);
    await this.syncRepositories(installation);
    return installation;
  }

  async syncOwned(userId: string, id: string) {
    const installation = await this.installations.findOneByOrFail({
      id,
      userId,
    });
    await this.syncRepositories(installation);
  }

  async handleWebhook(event: string, payload: unknown): Promise<void> {
    switch (event) {
      case 'installation':
        return this.onInstallation(payload as InstallationEvent);
      case 'installation_repositories':
        return this.onInstallationRepositories(
          payload as InstallationRepositoriesEvent,
        );
      case 'push':
        return this.onPush(payload as PushEvent);
      default:
        this.logger.debug(`Ignoring webhook event ${event}`);
    }
  }

  private async onInstallation(e: InstallationEvent) {
    const id = String(e.installation.id);
    if (e.action === 'deleted') {
      await this.installations.delete({ githubInstallationId: id });
      return;
    }
    if (e.action === 'created' || e.action === 'new_permissions_accepted') {
      await this.syncRepositories(await this.upsertInstallation(id));
    }
  }

  private async onInstallationRepositories(e: InstallationRepositoriesEvent) {
    const installation = await this.installations.findOneBy({
      githubInstallationId: String(e.installation.id),
    });
    if (installation) await this.syncRepositories(installation);
  }

  /** Push в дефолтную ветку → автоматический Full Sweep. */
  private async onPush(e: PushEvent) {
    if (e.deleted || e.ref !== `refs/heads/${e.repository.default_branch}`)
      return;
    const repo = await this.repositories.findByGithubId(e.repository.id);
    if (!repo?.installation.userId) return;
    await this.repositories.updateFromPush(repo, e.repository);
    await this.scans.enqueue(repo, {
      trigger: ScanTrigger.Push,
      commitSha: e.after,
    });
  }

  private async upsertInstallation(githubInstallationId: string) {
    const existing = await this.installations.findOneBy({
      githubInstallationId,
    });
    if (existing) return existing;
    const info = await this.app.getInstallation(githubInstallationId);
    return this.installations.save(
      this.installations.create({
        githubInstallationId,
        accountLogin: info.account?.login ?? 'unknown',
        userId: null,
      }),
    );
  }

  private async syncRepositories(installation: GithubInstallation) {
    const repos = await this.app.listInstallationRepos(
      installation.githubInstallationId,
    );
    await this.repositories.syncInstallation(installation.id, repos);
  }
}
