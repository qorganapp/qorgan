import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  /** Фокус вопроса: репозиторий пространства. Не указан или null — всё пространство. */
  @IsOptional()
  @IsUUID()
  repositoryId?: string | null;
}

export class AgentSettingsDto {
  @IsOptional()
  @IsBoolean()
  agentTriage?: boolean;

  @IsOptional()
  @IsBoolean()
  agentAutoFix?: boolean;

  @IsOptional()
  @IsBoolean()
  agentPrReview?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxOpenAgentPrs?: number;
}
