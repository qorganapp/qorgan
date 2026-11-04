import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { createHmac } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { GithubAppService } from './github-app.service';
import { GithubService } from './github.service';
import { verifyWebhookSignature } from './webhook-signature';

const STATE_PURPOSE = 'github-install';

@Controller('github')
export class GithubController {
  private readonly logger = new Logger(GithubController.name);

  constructor(
    private readonly github: GithubService,
    private readonly app: GithubAppService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Ссылка на установку App; state связывает редирект обратно с текущим пользователем. */
  @Get('install-url')
  async installUrl(@CurrentUser() user: AuthUser) {
    const state = await this.jwt.signAsync(
      { sub: user.id, purpose: STATE_PURPOSE },
      { secret: this.stateSecret(), expiresIn: '15m' },
    );
    return { url: this.app.installUrl(state) };
  }

  /** Setup URL GitHub App. Браузерный редирект — без Bearer, поэтому авторизация через state. */
  @Public()
  @Get('setup')
  async setup(
    @Query('installation_id') installationId: string | undefined,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    if (!installationId || !/^\d+$/.test(installationId) || !code || !state) {
      throw new BadRequestException(
        'installation_id, code and state are required',
      );
    }
    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        purpose: string;
      }>(state, {
        secret: this.stateSecret(),
      });
      if (payload.purpose !== STATE_PURPOSE) throw new Error('wrong purpose');
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired state');
    }
    await this.github.link(userId, installationId, code);
    res.redirect(
      `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/repositories?installed=1`,
    );
  }

  @Get('installations')
  installations(@CurrentUser() user: AuthUser) {
    return this.github.listForUser(user.id);
  }

  @Post('installations/:id/sync')
  @HttpCode(HttpStatus.NO_CONTENT)
  sync(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.github.syncOwned(user.id, id);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ) {
    const secret = this.config.getOrThrow<string>('GITHUB_WEBHOOK_SECRET');
    if (!verifyWebhookSignature(secret, req.rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }
    if (!event) throw new BadRequestException('Missing X-GitHub-Event');
    try {
      await this.github.handleWebhook(event, req.body);
    } catch (e) {
      // GitHub не ретраит вебхуки сам; логируем и отвечаем 5xx, чтобы было видно в Recent Deliveries.
      this.logger.error(`Webhook ${event} failed: ${(e as Error).message}`);
      throw e;
    }
    return { ok: true };
  }

  /**
   * Отдельный ключ, производный от JWT_ACCESS_SECRET: state попадает в URL, и подписанный
   * тем же ключом он прошёл бы AccessTokenGuard как access-токен.
   */
  private stateSecret() {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    )
      .update('qorgan:github-install-state')
      .digest('hex');
  }
}
