import { IsString, MaxLength, MinLength } from 'class-validator';

export class SignInDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;
}
