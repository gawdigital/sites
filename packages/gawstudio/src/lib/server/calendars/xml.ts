// A tiny, tolerant XML reader for WebDAV multistatus answers (Workers have no DOMParser). Elements are known
// by their local name only, since the namespace prefix is the server's choice (`D:href`, `d:href`, plain `href`
// under a default namespace). It reads elements, attributes, text, CDATA and the standard entities; it does not
// validate, and it skips declarations, comments and doctypes.

export interface XmlNode {
  /** The local name, without its namespace prefix. */
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** The element's own text (its children's text is theirs), entities decoded. */
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body] ?? whole;
  });
}

/** Text as it may stand between tags or in a quoted attribute. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const local = (name: string): string => name.slice(name.indexOf(':') + 1);

/** The document as a tree under a nameless root. An unclosed element is closed at the end. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '', attributes: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const top = (): XmlNode => stack[stack.length - 1] ?? root;
  const tag = /<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  const attribute = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let i = 0;

  const skipPast = (end: string): void => {
    const at = text.indexOf(end, i);
    i = at < 0 ? text.length : at + end.length;
  };

  while (i < text.length) {
    if (text[i] !== '<') {
      const next = text.indexOf('<', i);
      const end = next < 0 ? text.length : next;
      top().text += decodeEntities(text.slice(i, end));
      i = end;
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i);
      top().text += text.slice(i + 9, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end + 3;
    } else if (text.startsWith('<!--', i)) {
      skipPast('-->');
    } else if (text.startsWith('<?', i)) {
      skipPast('?>');
    } else if (text.startsWith('<!', i)) {
      skipPast('>');
    } else if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      const name = local(text.slice(i + 2, end < 0 ? text.length : end).trim());
      // Close up to the matching element; a stray closing tag closes nothing.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth]?.name === name) {
          stack.length = depth;
          break;
        }
      }
      i = end < 0 ? text.length : end + 1;
    } else {
      tag.lastIndex = i;
      const m = tag.exec(text);
      if (!m) {
        // Not a tag after all: keep the character as text and go on.
        top().text += '<';
        i++;
        continue;
      }
      const node: XmlNode = { name: local(m[1] ?? ''), attributes: {}, children: [], text: '' };
      for (const a of (m[2] ?? '').matchAll(attribute)) {
        node.attributes[local(a[1] ?? '')] = decodeEntities(a[2] ?? a[3] ?? '');
      }
      top().children.push(node);
      if (m[3] !== '/') stack.push(node);
      i = tag.lastIndex;
    }
  }
  return root;
}

/** The first child of that local name. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** Every descendant of that local name, in document order. */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const c of node.children) {
    if (c.name === name) found.push(c);
    found.push(...descendants(c, name));
  }
  return found;
}

/** One `<response>` of a multistatus: the resource, and its properties that were found (a 2xx `propstat`). */
export interface DavResponse {
  href: string;
  /** The status of the response as a whole, where the server gives one instead of `propstat`s. */
  status?: number;
  props: Record<string, XmlNode>;
}

const statusOf = (node: XmlNode | undefined): number | undefined => {
  const code = /\s(\d{3})(\s|$)/.exec(node?.text ?? '')?.[1];
  return code === undefined ? undefined : Number(code);
};

/** The responses of a `207 Multi-Status` body; empty when the text holds none. */
export function parseMultistatus(text: string): DavResponse[] {
  return descendants(parseXml(text), 'response').map((response) => {
    const props: Record<string, XmlNode> = {};
    for (const propstat of response.children.filter((c) => c.name === 'propstat')) {
      const status = statusOf(child(propstat, 'status'));
      if (status !== undefined && (status < 200 || status > 299)) continue;
      for (const prop of child(propstat, 'prop')?.children ?? []) props[prop.name] = prop;
    }
    return { href: child(response, 'href')?.text.trim() ?? '', status: statusOf(child(response, 'status')), props };
  });
}
