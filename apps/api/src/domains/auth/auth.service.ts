import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, timingSafeEqual } from 'node:crypto';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import {
  AccessTokenPayload,
  AuthTokens,
  RefreshTokenPayload,
} from './auth.types';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';

const BCRYPT_ROUNDS = 10;

type JwtExpiresIn = NonNullable<
  Parameters<JwtService['signAsync']>[1]
>['expiresIn'];

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signUp(dto: SignUpDto): Promise<AuthTokens> {
    if (await this.users.findByUsername(dto.username)) {
      throw new ConflictException('Username is already taken');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.users.create(dto.username, passwordHash);
    return this.issueTokens(user);
  }

  async signIn(dto: SignInDto): Promise<AuthTokens> {
    const user = await this.users.findByUsernameWithPassword(dto.username);
    const valid =
      user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid username or password');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string | undefined): Promise<AuthTokens> {
    if (!refreshToken) throw new UnauthorizedException();

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.users.findByIdWithRefreshHash(payload.sub);
    if (!user?.refreshTokenHash) throw new UnauthorizedException();

    const expected = Buffer.from(user.refreshTokenHash, 'hex');
    const actual = Buffer.from(this.hashToken(refreshToken), 'hex');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      // Валидный, но уже использованный токен — возможная кража: обрываем сессию.
      await this.users.setRefreshTokenHash(user.id, null);
      throw new UnauthorizedException();
    }

    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.users.setRefreshTokenHash(userId, null);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      username: user.username,
    };
    const refreshPayload: RefreshTokenPayload = { sub: user.id };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'JWT_ACCESS_TTL',
        ) as JwtExpiresIn,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'JWT_REFRESH_TTL',
        ) as JwtExpiresIn,
      }),
    ]);

    await this.users.setRefreshTokenHash(user.id, this.hashToken(refreshToken));
    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);
    return {
      accessToken,
      refreshToken,
      refreshExpiresAt: new Date(exp * 1000),
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
