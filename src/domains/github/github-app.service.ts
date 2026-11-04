import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { GithubInstallationInfo, GithubRepo } from './github.types';

const API = 'https://api.github.com';

/** Тонкий клиент GitHub App API: JWT приложения, токены установок, список репозиториев. */
@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);
  private readonly tokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /** Настроен ли GitHub App на этом сервере (пустые переменные в .env — нет). */
  isConfigured(): boolean {
    return [
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
    ].every((key) => !!this.config.get<string>(key)?.trim());
  }

  installUrl(state: string): string {
    if (!this.isConfigured()) {
      // Без этого ссылка вела бы на github.com/apps//installations/new — 404.
      throw new ServiceUnavailableException(
        'GitHub App is not configured on this server yet. Set the GITHUB_APP_* variables in the server .env.',
      );
    }
    const slug = this.config.getOrThrow<string>('GITHUB_APP_SLUG').trim();
    return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
  }

  getInstallation(installationId: string): Promise<GithubInstallationInfo> {
    return this.request(`/app/installations/${installationId}`, {
      auth: `Bearer ${this.appJwt()}`,
    });
  }

  /** Токен установки живёт час; держим в памяти и обновляем за 5 минут до истечения. */
  async installationToken(installationId: string): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - Date.now() > 5 * 60_000)
      return cached.token;

    const res = await this.request<{ token: string; expires_at: string }>(
      `/app/installations/${installationId}/access_tokens`,
      { method: 'POST', auth: `Bearer ${this.appJwt()}` },
    );
    this.tokens.set(installationId, {
      token: res.token,
      expiresAt: new Date(res.expires_at).getTime(),
    });
    return res.token;
  }

  async listInstallationRepos(installationId: string): Promise<GithubRepo[]> {
    const token = await this.installationToken(installationId);
    const repos: GithubRepo[] = [];
    for (let page = 1; ; page++) {
      const res = await this.request<{
        repositories: GithubRepo[];
        total_count: number;
      }>(`/installation/repositories?per_page=100&page=${page}`, {
        auth: `token ${token}`,
      });
      repos.push(...res.repositories);
      if (res.repositories.length < 100 || repos.length >= res.total_count)
        break;
    }
    return repos;
  }

  /**
   * Подтверждение владения установкой: меняем OAuth-код из setup-редиректа на токен
   * пользователя и спрашиваем у GitHub, к каким установкам у него есть доступ.
   * Требует включённой в настройках App опции «Request user authorization (OAuth) during installation».
   */
  async userInstallationIds(code: string): Promise<string[]> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.getOrThrow<string>('GITHUB_CLIENT_ID'),
        client_secret: this.config.getOrThrow<string>('GITHUB_CLIENT_SECRET'),
        code,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as {
      access_token?: string;
      error?: string;
    };
    if (!body.access_token) {
      throw new ServiceUnavailableException(
        `GitHub OAuth: ${body.error ?? res.status}`,
      );
    }
    const data = await this.request<{ installations: { id: number }[] }>(
      '/user/installations?per_page=100',
      { auth: `token ${body.access_token}` },
    );
    return data.installations.map((i) => String(i.id));
  }

  private appJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    return this.jwt.sign(
      // iat на минуту в прошлое — защита от расхождения часов.
      {
        iat: now - 60,
        exp: now + 9 * 60,
        iss: this.config.getOrThrow<string>('GITHUB_APP_ID'),
      },
      {
        algorithm: 'RS256',
        privateKey: this.config
          .getOrThrow<string>('GITHUB_APP_PRIVATE_KEY')
          .replace(/\\n/g, '\n'),
      },
    );
  }

  /** Вызов REST API от имени установки (для PR, ревью и т.п.). */
  async asInstallation<T>(
    installationId: string,
    path: string,
    opts: { method?: string; body?: unknown; accept?: string } = {},
  ): Promise<T> {
    const token = await this.installationToken(installationId);
    return this.request<T>(path, { ...opts, auth: `token ${token}` });
  }

  /** Имя и email бота приложения для коммитов. */
  botIdentity(): { name: string; email: string } {
    const slug = this.config.get<string>('GITHUB_APP_SLUG', 'qorgan');
    return {
      name: `${slug}[bot]`,
      email: `${slug}[bot]@users.noreply.github.com`,
    };
  }

  private async request<T>(
    path: string,
    opts: { method?: string; auth: string; body?: unknown; accept?: string },
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: opts.accept ?? 'application/vnd.github+json',
        Authorization: opts.auth,
        'User-Agent': 'qorgan-app',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `GitHub ${opts.method ?? 'GET'} ${path} → ${res.status}`,
      );
      throw new ServiceUnavailableException(
        `GitHub API ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('json') ? await res.json() : await res.text()) as T;
  }
}
