/**
 * sanitizeHtml — backend mirror of web sanitize.ts (hermetic, no DOM).
 * WHY: persisted docxEditedHtml must be validated server-side too (defense in
 * depth — frontend DOMPurify can be bypassed via API). Uses allowlist regex
 * stripping (no DOMPurify dep on backend to keep image small).
 * Allowlist mirrors frontend sanitizeDocxHtml: b,i,em,strong,a,p,br,ul,ol,li,
 * code,pre,table,thead,tbody,tr,th,td,h1,h2,h3,span,div. Strips script/style/
 * iframe/object/embed/form/input + on* handlers + javascript:/data:text/html +
 * style attributes.
 */

const ALLOWED_TAGS = new Set([
  'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li',
  'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'h1', 'h2', 'h3', 'span', 'div',
]);

const FORBIDDEN_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input',
  'button', 'link', 'meta', 'base', 'svg', 'math', 'video', 'audio',
  'source', 'frame', 'frameset', 'applet',
]);

export function sanitizeDocxHtml(dirty: string): string {
  if (!dirty || typeof dirty !== 'string') return '';
  let out = String(dirty);
  // 1. Strip HTML comments
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // 2. Strip forbidden element blocks entirely (incl. content for script/style)
  for (const tag of FORBIDDEN_TAGS) {
    const reBlock = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    out = out.replace(reBlock, '');
    const reSelf = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    out = out.replace(reSelf, '');
  }
  // 3. Strip event-handler attributes (on*), style, formaction, xlink:href, srcdoc
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s+formaction\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s+srcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s+xlink:href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // 4. Neutralize javascript:/data:text/html/vbscript: URLs (keep safe http/https/#/)
  out = out.replace(/\s+(href|src|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_m, attr, _q, d1, d2, d3) => {
    const val = (d1 ?? d2 ?? d3 ?? '').trim();
    const low = val.toLowerCase().replace(/[\s\u0000-\u001F]+/g, '');
    if (/^(javascript|data:text\/html|vbscript|file):/i.test(low)) return ` ${attr}="#"`;
    return ` ${attr}="${val.replace(/"/g, '&quot;')}"`;
  });
  // 5. Allowlist tags: strip any tag not in ALLOWED_TAGS (keep inner text)
  out = out.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?\/?>/g, (m, tagName: string, attrs: string | undefined) => {
    const t = String(tagName).toLowerCase();
    if (ALLOWED_TAGS.has(t)) {
      if (!attrs) return m.startsWith('</') ? `</${t}>` : `<${t}>`;
      // For allowed tags, keep only safe attrs: href/target/rel/colspan/rowspan
      const isClosing = m.startsWith('</');
      if (isClosing) return `</${t}>`;
      const kept: string[] = [];
      const attrRe = /([a-zA-Z-:]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(attrs)) !== null) {
        const name = am[1].toLowerCase();
        const rawVal = am[2].replace(/^["']|["']$/g, '');
        if (['href', 'target', 'rel'].includes(name) && (t === 'a' || t === 'span' || t === 'div')) {
          if (name === 'href') {
            const low = rawVal.toLowerCase().replace(/\s+/g, '');
            if (/^(javascript|data:text\/html|vbscript):/i.test(low)) continue;
          }
          kept.push(`${name}="${rawVal.replace(/"/g, '&quot;')}"`);
        } else if (['colspan', 'rowspan'].includes(name) && ['td', 'th'].includes(t)) {
          if (/^\d{1,2}$/.test(rawVal)) kept.push(`${name}="${rawVal}"`);
        }
      }
      // Force rel/target safety on links
      if (t === 'a' && kept.some((k) => k.startsWith('href='))) {
        if (!kept.some((k) => k.startsWith('rel='))) kept.push('rel="noopener noreferrer"');
      }
      return kept.length > 0 ? `<${t} ${kept.join(' ')}>` : `<${t}>`;
    }
    return '';
  });
  return out;
}

export function isDocxHtmlSafe(html: string): boolean {
  if (!html) return true;
  const low = String(html).toLowerCase();
  if (/<script/i.test(low)) return false;
  if (/<svg/i.test(low)) return false;
  if (/\son[a-z]+\s*=/i.test(low)) return false;
  if (/javascript:/i.test(low)) return false;
  return true;
}
