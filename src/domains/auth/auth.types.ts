export interface AccessTokenPayload {
  sub: string;
  username: string;
}

export interface RefreshTokenPayload {
  sub: string;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}
