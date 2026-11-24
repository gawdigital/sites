import { describe, expect, test } from 'bun:test';

import { MAX_LINK, validateLink, type LinkRejection, type LinkResult } from './links.ts';
import { DEFAULT_FILE_SETTINGS } from './settings.ts';

const listed = DEFAULT_FILE_SETTINGS;
const any = { linkHosts: [] };
const no = (reason: LinkRejection): LinkResult => ({ ok: false, reason });

describe('a pasted link', () => {
  test('the documented services pass, subdomains included', () => {
    expect(validateLink('https://we.tl/t-AbCdEf123', listed)).toEqual({ ok: true, url: 'https://we.tl/t-AbCdEf123', host: 'we.tl' });
    expect(validateLink('https://wetransfer.com/downloads/abc/def?t_exp=1#x', listed)).toEqual({
      ok: true,
      url: 'https://wetransfer.com/downloads/abc/def?t_exp=1#x',
      host: 'wetransfer.com',
    });
    expect(validateLink('https://drive.google.com/drive/folders/1AbC?usp=sharing', listed)).toMatchObject({ ok: true, host: 'drive.google.com' });
    expect(validateLink('https://www.dropbox.com/scl/fo/abc/h?rlkey=k&dl=0', listed)).toMatchObject({ ok: true, host: 'www.dropbox.com' });
  });

  test('it is normalised: trimmed, the host lower-cased, a missing scheme read as https', () => {
    expect(validateLink('  HTTPS://WE.TL/t-AbC \n', listed)).toEqual({ ok: true, url: 'https://we.tl/t-AbC', host: 'we.tl' });
    expect(validateLink('we.tl/t-AbC', listed)).toEqual({ ok: true, url: 'https://we.tl/t-AbC', host: 'we.tl' });
    expect(validateLink('https://we.tl./t-AbC', listed)).toEqual({ ok: true, url: 'https://we.tl/t-AbC', host: 'we.tl' });
    expect(validateLink('https://example.com', any)).toEqual({ ok: true, url: 'https://example.com/', host: 'example.com' });
  });

  test('https only', () => {
    for (const link of ['http://we.tl/t-AbC', 'ftp://we.tl/x', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'mailto:name@example.com'])
      expect(validateLink(link, any)).toEqual(no('scheme'));
  });

  test('no credentials', () => {
    for (const link of ['https://user:secret@we.tl/t-AbC', 'https://user@we.tl/t-AbC', 'user@we.tl/t-AbC', 'https://we.tl@example.com/'])
      expect(validateLink(link, any)).toEqual(no('credentials'));
  });

  test('a public host name on the default port', () => {
    for (const link of ['https://localhost/x', 'https://192.168.1.10/x', 'https://[::1]/x', 'https://intranet/x', 'https://we.tl:8443/x', 'we.tl:8443/x', 'https://2130706433/'])
      expect(validateLink(link, any)).toEqual(no('host'));
    expect(validateLink('https://we.tl:443/x', any)).toMatchObject({ ok: true, url: 'https://we.tl/x' });
    expect(validateLink('https://příklad.example/x', any)).toMatchObject({ ok: true, host: 'xn--pklad-zsa96e.example' });
  });

  test('with a list in the settings, only its hosts and their subdomains', () => {
    for (const link of ['https://example.com/file.zip', 'https://notdropbox.com/x', 'https://dropbox.com.example.com/x', 'https://google.com/x'])
      expect(validateLink(link, listed)).toEqual(no('host-not-allowed'));
    expect(validateLink('https://files.example.com/a', { linkHosts: [' .Example.com '] })).toMatchObject({ ok: true });
    expect(validateLink('https://example.com/a', { linkHosts: [''] })).toEqual(no('host-not-allowed'));
  });

  test('empty, too long, or not a link', () => {
    expect(validateLink('', any)).toEqual(no('empty'));
    expect(validateLink('   ', any)).toEqual(no('empty'));
    expect(validateLink(`https://we.tl/${'a'.repeat(MAX_LINK)}`, any)).toEqual(no('too-long'));
    for (const link of ['https://we.tl/a b', 'https://we.tl/a\u0000b', 'https://we.tl\\@example.com', 'https://', 'see https://we.tl/t-AbC'])
      expect(validateLink(link, any)).toEqual(no('invalid'));
    expect(validateLink('just some words', any)).toEqual(no('invalid'));
    expect(validateLink('hello', any)).toEqual(no('host'));
  });
});
