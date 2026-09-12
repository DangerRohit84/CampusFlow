import DOMPurify from 'dompurify';

/**
 * Sanitize HTML string to prevent XSS attacks.
 * Strips all potentially dangerous HTML while keeping safe formatting.
 */
export function sanitizeHTML(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}

/**
 * Sanitize and convert markdown-like bold and newlines to HTML.
 * Used for rendering AI-generated text content safely.
 */
export function sanitizeMarkdown(dirty: string): string {
  const withBasicFormatting = dirty
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
  return sanitizeHTML(withBasicFormatting);
}

/**
 * Sanitize DOCX-converted HTML (mammoth output + contentEditable persist path).
 * C1 fix: user-uploaded DOCX → mammoth HTML rendered raw was stored XSS.
 * Allowlist mirrors backend sanitizeHtml.ts: rich-text + tables only, no
 * event handlers / style / script / svg / iframe. Used for BOTH render
 * (displayHtml) AND persist (newHtml onBlur → docxEditedHtml) paths.
 */
export function sanitizeDocxHtml(dirty: string): string {
  if (!dirty || typeof dirty !== 'string') return '';
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan'],
    FORBID_ATTR: ['style', 'onabort', 'onblur', 'onchange', 'onclick', 'ondblclick', 'onerror', 'onfocus', 'oninput', 'onkeydown', 'onkeypress', 'onkeyup', 'onload', 'onmousedown', 'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout', 'onmouseover', 'onmouseup', 'onsubmit', 'onunload'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base', 'svg', 'math', 'video', 'audio', 'source', 'frame', 'frameset', 'applet'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}
