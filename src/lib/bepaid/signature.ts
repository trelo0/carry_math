import { createVerify, timingSafeEqual } from 'crypto';

/** RSA-SHA256 подпись Content-Signature (base64) по сырому телу запроса. */
export function verifyBePaidContentSignature(
  rawBody: string,
  signature: string,
  publicKey: string,
): boolean {
  try {
    const body = publicKey.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
    const pem = `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join('\n') ?? body}\n-----END PUBLIC KEY-----`;
    const verify = createVerify('SHA256');
    verify.update(rawBody, 'utf8');
    verify.end();
    return verify.verify(pem, Buffer.from(signature, 'base64'));
  } catch (error) {
    console.error('[bePaid signature]', error);
    return false;
  }
}

/** HTTP Basic (Shop ID:Secret key), которым bePaid подписывает уведомления. */
export function verifyBePaidBasicAuth(
  authorization: string | null,
  shopId: string,
  secretKey: string,
): boolean {
  if (!authorization?.startsWith('Basic ')) return false;
  const expected = Buffer.from(`${shopId}:${secretKey}`);
  const actual = Buffer.from(Buffer.from(authorization.slice(6), 'base64').toString('utf8'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
