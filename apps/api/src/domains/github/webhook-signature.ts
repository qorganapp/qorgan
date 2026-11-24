import { createHmac, timingSafeEqual } from 'node:crypto';

/** Проверка X-Hub-Signature-256 (HMAC-SHA256 от сырого тела запроса). */
export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer | undefined,
  signature: string | undefined,
): boolean {
  if (!secret || !rawBody || !signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  );
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
