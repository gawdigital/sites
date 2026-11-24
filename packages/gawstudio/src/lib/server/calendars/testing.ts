// A scripted `fetch` for the provider tests: it records every request and answers from a list, in order.

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  redirect: string | undefined;
}

export type Reply = { status?: number; headers?: Record<string, string>; body?: string; json?: unknown };

export function scripted(replies: Reply[]): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const queue = [...replies];
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    requests.push({
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      redirect: init?.redirect,
    });
    const reply = queue.shift();
    if (!reply) throw new Error(`No reply scripted for request ${requests.length}`);
    const status = reply.status ?? 200;
    const body = reply.json === undefined ? reply.body : JSON.stringify(reply.json);
    // A Response of these statuses may not carry a body.
    return new Response([204, 304].includes(status) ? null : (body ?? ''), { status, headers: reply.headers });
  };
  return { fetch: fake as typeof fetch, requests };
}
