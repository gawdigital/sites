// Just enough JSON Web Token for signing in with Google and Apple, on WebCrypto: reading a token, checking an
// RS256 signature against a provider's published keys, and signing with ES256 (Apple's client secret).
// The algorithm is never taken from the token: a token that names another one is refused.
import { base64url, fromBase64url, utf8 } from './encoding.ts';

/** A public key as a provider's JWKS lists it. */
export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  /** `header.payload` as received: what the signature covers. */
  signed: string;
  signature: Uint8Array<ArrayBuffer>;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

function jsonObject(part: string): Record<string, unknown> | undefined {
  const raw = fromBase64url(part);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(decoder.decode(raw));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** A compact JWS taken apart, nothing verified yet; `undefined` when it is not one. */
export function decodeJwt(token: string): DecodedJwt | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [h, p, s] = parts as [string, string, string];
  const header = jsonObject(h);
  const claims = jsonObject(p);
  const signature = fromBase64url(s);
  if (!header || !claims || !signature || signature.length === 0) return undefined;
  return { header, claims, signed: `${h}.${p}`, signature };
}

export type SignatureFailure = 'unsupported-alg' | 'unknown-key' | 'bad-signature';

/**
 * Checks an RS256 signature against a key set: the token must say RS256 and name (`kid`) an RSA signing key of
 * the set. `undefined` when the signature holds.
 */
export async function verifyRs256(jwt: DecodedJwt, keys: readonly Jwk[]): Promise<SignatureFailure | undefined> {
  if (jwt.header.alg !== 'RS256') return 'unsupported-alg';
  const kid = jwt.header.kid;
  const jwk = typeof kid === 'string' ? keys.find((k) => k.kid === kid && k.kty === 'RSA' && (k.use ?? 'sig') === 'sig') : undefined;
  if (!jwk?.n || !jwk.e || (jwk.alg !== undefined && jwk.alg !== 'RS256')) return 'unknown-key';
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, algorithm, false, ['verify']);
  } catch {
    return 'unknown-key';
  }
  return (await crypto.subtle.verify(algorithm, key, jwt.signature, utf8(jwt.signed))) ? undefined : 'bad-signature';
}

/** A compact JWS signed with ES256 (ECDSA, P-256, SHA-256); WebCrypto's `r‖s` signature is the JWS form already. */
export async function signEs256(header: Record<string, unknown>, claims: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const part = (value: Record<string, unknown>): string => base64url(utf8(JSON.stringify(value)));
  const signed = `${part({ ...header, alg: 'ES256' })}.${part(claims)}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signed));
  return `${signed}.${base64url(new Uint8Array(signature))}`;
}

/**
 * A P-256 private key from its PKCS#8 PEM text (the `.p8` file Apple issues, kept as a Cloudflare secret), for
 * `signEs256`. Not extractable.
 */
export async function importEs256PrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = fromBase64url(body.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  if (!der || der.length === 0) throw new TypeError('auth: not a PKCS#8 PEM private key');
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
