// The contact form's endpoint, shared by the sites. It works without client JavaScript: a plain POST is answered with
// a 303 to the prerendered result page of the form it came from; the progressive script asks for JSON and stays on
// the page. A site's route hands over what is its own: its form's sources, how it reads and composes a message, and
// its secrets (`$app/env/private` belongs to the site, so its route reads them).
import { readOrigin, resultPath, type Mail, type Origin, type Sender, type Sources } from './form.ts';
import type { FormState } from './states.ts';

const SMTP_HOST = 'mail.blueboard.cz';
const SMTP_PORT = 587;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The secrets of a site's Worker, each optional so a deployment without them still answers. */
export interface Secrets {
  TURNSTILE_SECRET_KEY?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_TO?: string;
}

/** What a site's form is: where it may be posted from, and how a post becomes a message. */
export interface ContactSite<S extends Sender> {
  /** The pages that hold the form (`contact`, `support`). */
  sources: Sources<S['source']>;
  /** The posted form, validated: `undefined` when any field is missing or malformed. */
  read(data: FormData): S | undefined;
  /** The message as it is delivered. */
  compose(submission: S): Mail;
  secrets(): Secrets;
}

/** The Worker bindings this endpoint uses, both optional so a deployment without them still answers. */
interface Bindings {
  CONTACT_LIMITER?: RateLimit;
  SEND_EMAIL?: SendEmail;
}

async function bindings(): Promise<Bindings> {
  try {
    const { env } = await import('cloudflare:workers');
    return env as Bindings;
  } catch {
    return {};
  }
}

async function verified(secret: string | undefined, token: string, ip: string | null): Promise<boolean> {
  // Fail closed: without a secret nothing can be verified, so nothing is sent.
  if (!secret || !token) return false;
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body });
    const outcome = (await res.json()) as { success?: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}

async function deliver(mail: Mail, { SMTP_USER, SMTP_PASSWORD, MAIL_TO }: Secrets, env: Bindings): Promise<boolean> {
  if (!SMTP_USER || !MAIL_TO) return false;
  if (SMTP_PASSWORD) {
    try {
      const { WorkerMailer } = await import('worker-mailer');
      await WorkerMailer.send(
        {
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: false,
          startTls: true,
          credentials: { username: SMTP_USER, password: SMTP_PASSWORD },
          authType: ['plain', 'login'],
        },
        { from: SMTP_USER, to: MAIL_TO, reply: mail.replyTo, subject: mail.subject, text: mail.text },
      );
      return true;
    } catch (error) {
      console.error('contact: SMTP delivery failed', error instanceof Error ? error.message : error);
    }
  }
  if (env.SEND_EMAIL) {
    try {
      await env.SEND_EMAIL.send({
        from: SMTP_USER,
        to: MAIL_TO,
        replyTo: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
      });
      return true;
    } catch (error) {
      console.error('contact: send_email delivery failed', error instanceof Error ? error.message : error);
    }
  }
  return false;
}

/** The answer to a post: JSON for the in-page script, a redirect to the form's result page for a plain form post. */
export function answer(request: Request, origin: Origin, state: FormState): Response {
  const ok = state === 'sent';
  if (request.headers.get('accept')?.includes('application/json')) {
    return Response.json(ok ? { ok } : { ok, error: state }, {
      status: ok ? 200 : state === 'rate' ? 429 : state === 'failed' ? 502 : 400,
      headers: { 'cache-control': 'no-store' },
    });
  }
  return new Response(null, {
    status: 303,
    headers: { location: resultPath(origin, state), 'cache-control': 'no-store' },
  });
}

/** A site's `POST /api/contact`: validate, rate-limit, verify Turnstile, deliver. */
export function contactEndpoint<S extends Sender>(site: ContactSite<S>) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    let data: FormData;
    try {
      data = await request.formData();
    } catch {
      return answer(request, { locale: 'en', source: site.sources[0] }, 'invalid');
    }
    const origin = readOrigin(data, site.sources);
    const submission = site.read(data);
    if (!submission) return answer(request, origin, 'invalid');

    const ip = request.headers.get('cf-connecting-ip');
    const env = await bindings();
    if (env.CONTACT_LIMITER) {
      const { success } = await env.CONTACT_LIMITER.limit({ key: ip ?? 'unknown' });
      if (!success) return answer(request, origin, 'rate');
    }
    const secrets = site.secrets();
    if (!(await verified(secrets.TURNSTILE_SECRET_KEY, submission.token, ip))) {
      return answer(request, origin, 'verification');
    }
    return answer(request, origin, (await deliver(site.compose(submission), secrets, env)) ? 'sent' : 'failed');
  };
}

/** A site's `GET /api/contact`: the endpoint has no page of its own, so a visit goes to the form. */
export const contactRedirect = (): Response => new Response(null, { status: 303, headers: { location: '/contact' } });
