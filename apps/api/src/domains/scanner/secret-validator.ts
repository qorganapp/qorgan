import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretFinding } from './adapters/types';
import { validateSecrets } from './secret-probes';

@Injectable()
export class SecretValidator {
  private readonly logger = new Logger(SecretValidator.name);
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.get('SECRET_VALIDATION_ENABLED', 'false') === 'true';
  }

  validate(findings: SecretFinding[]): Promise<void> {
    return validateSecrets(findings, {
      enabled: this.enabled,
      onError: (provider, e) =>
        this.logger.warn(`${provider} probe failed: ${e.message}`),
    });
  }
}
