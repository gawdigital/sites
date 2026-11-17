// The contact form's endpoint. It works without client JavaScript: a plain POST is answered with a 303 to the
// prerendered result page of the form it came from; the progressive script asks for JSON and stays on the page.
import { MAIL_TO, SMTP_PASSWORD, SMTP_USER, TURNSTILE_SECRET_KEY } from '$app/env/private';
import type { RequestHandler } from './$types';

import type { FormState } from '#lib/forms.ts';
import { compose, readOrigin, readSubmission, resultPath, type Mail, type Origin } from '#lib/server/contact.ts';

export const prerender = false;

const SMTP_HOST = 'mail.blueboard.cz';
const SMTP_PORT = 587;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

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

async function verified(token: string, ip: string | null): Promise<boolean> {
  // Fail closed: without a secret nothing can be verified, so nothing is sent.
  if (!TURNSTILE_SECRET_KEY || !token) return false;
  const body = new FormData();
  body.set('secret', TURNSTILE_SECRET_KEY);
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

async function deliver(mail: Mail, env: Bindings): Promise<boolean> {
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

function answer(request: Request, origin: Origin, state: FormState): Response {
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

export const POST: RequestHandler = async ({ request }) => {
  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return answer(request, { locale: 'en', source: 'contact' }, 'invalid');
  }
  const origin = readOrigin(data);
  const submission = readSubmission(data);
  if (!submission) return answer(request, origin, 'invalid');

  const ip = request.headers.get('cf-connecting-ip');
  const env = await bindings();
  if (env.CONTACT_LIMITER) {
    const { success } = await env.CONTACT_LIMITER.limit({ key: ip ?? 'unknown' });
    if (!success) return answer(request, origin, 'rate');
  }
  if (!(await verified(submission.token, ip))) return answer(request, origin, 'verification');
  return answer(request, origin, (await deliver(compose(submission), env)) ? 'sent' : 'failed');
};

export const GET: RequestHandler = () => new Response(null, { status: 303, headers: { location: '/contact' } });
