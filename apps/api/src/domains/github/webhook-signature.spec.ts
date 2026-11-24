import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './webhook-signature';

describe('verifyWebhookSignature', () => {
  const body = Buffer.from('{"zen":"Keep it logically awesome."}');
  const sign = (secret: string) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature('s3cret', body, sign('s3cret'))).toBe(true);
  });

  it('rejects wrong secret, missing body, missing or malformed header', () => {
    expect(verifyWebhookSignature('s3cret', body, sign('other'))).toBe(false);
    expect(verifyWebhookSignature('s3cret', undefined, sign('s3cret'))).toBe(
      false,
    );
    expect(verifyWebhookSignature('s3cret', body, undefined)).toBe(false);
    expect(verifyWebhookSignature('s3cret', body, 'sha1=abc')).toBe(false);
    expect(verifyWebhookSignature('', body, sign(''))).toBe(false);
  });
});
