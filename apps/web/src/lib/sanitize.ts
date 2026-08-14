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
