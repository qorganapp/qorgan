import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignUpDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_.]+$/, {
    message: 'username may contain only letters, digits, "_" and "."',
  })
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
