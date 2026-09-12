// components/coding/shareCard.ts — canvas-drawn 1200×630 share card.
// WHY: task #7 — LinkedIn-ready PNG download, client-only (no backend, no
// html-to-image chunk). Pure Canvas2D + system fonts: no external images, so
// the canvas is never CORS-tainted and toDataURL always works. Colors meet AA
// on the dark card (#fff on #0a0a0a, #1ed760 accents for large text/shapes).

export interface ShareCardHandle {
  label: string;
  value: string;
}

export interface ShareCardBreakdown {
  contests: number;
  coding: number;
  git: number;
}

export interface ShareCardData {
  name: string;
  username?: string;
  handles: ShareCardHandle[];
  problemsSolved: number;
  contests: number;
  bestRating: number | null;
  currentStreak: number;
  longestStreak: number;
  dateLabel?: string;
  /** Unified-heatmap window totals (optional; renders a breakdown line). */
  breakdown?: ShareCardBreakdown | null;
}

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/** Keep long names/handles inside the card. Exported for tests. */
export function truncateForCard(value: string, maxChars: number): string {
  const v = (value || '').trim();
  if (v.length <= maxChars) return v;
  return `${v.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawShareCard(canvas: HTMLCanvasElement, data: ShareCardData): void {
  const W = SHARE_CARD_WIDTH;
  const H = SHARE_CARD_HEIGHT;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');

  // Background: near-black + subtle green radial glows.
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  const glow1 = ctx.createRadialGradient(W - 120, 40, 20, W - 120, 40, 420);
  glow1.addColorStop(0, 'rgba(30,215,96,0.22)');
  glow1.addColorStop(1, 'rgba(30,215,96,0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(120, H - 60, 20, 120, H - 60, 460);
  glow2.addColorStop(0, 'rgba(0,168,143,0.18)');
  glow2.addColorStop(1, 'rgba(0,168,143,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // Accent top bar.
  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, '#1ed760');
  bar.addColorStop(1, '#00a88f');
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, W, 10);

  const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // Eyebrow.
  ctx.fillStyle = '#1ed760';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText('CAMPUSFLOW  ·  CODING PROFILE', 72, 96);

  // Name + username.
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 72px ${FONT}`;
  ctx.fillText(truncateForCard(data.name || 'Coder', 24), 70, 180);
  const handleLine = data.username ? `@${truncateForCard(data.username, 32)}` : '';
  const linked = data.handles
    .filter((h) => h.value)
    .slice(0, 3)
    .map((h) => `${h.label}: ${truncateForCard(h.value, 18)}`)
    .join('   ·   ');
  ctx.fillStyle = '#b3b3b3';
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(truncateForCard([handleLine, linked].filter(Boolean).join('   ·   '), 72), 72, 228);

  // Stat boxes.
  const stats = [
    { label: 'PROBLEMS SOLVED', value: data.problemsSolved.toLocaleString('en-US') },
    { label: 'BEST RATING', value: data.bestRating != null ? String(data.bestRating) : '—' },
    { label: 'CONTESTS', value: String(data.contests) },
    { label: 'DAY STREAK', value: String(data.currentStreak) },
  ];
  const boxW = 252;
  const boxH = 150;
  const boxY = 290;
  const startX = 72;
  const gapX = 24;
  stats.forEach((s, i) => {
    const x = startX + i * (boxW + gapX);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, x, boxY, boxW, boxH, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, boxY, boxW, boxH, 20);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 52px ${FONT}`;
    ctx.fillText(truncateForCard(s.value, 10), x + 28, boxY + 78);
    ctx.fillStyle = '#9a9a9a';
    ctx.font = `600 21px ${FONT}`;
    ctx.fillText(s.label, x + 28, boxY + 116);
  });

  // Streak line.
  ctx.fillStyle = '#d7d7d7';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(
    `Current streak ${data.currentStreak} day${data.currentStreak === 1 ? '' : 's'}  ·  Best ${data.longestStreak} day${data.longestStreak === 1 ? '' : 's'}`,
    72,
    500,
  );

  // Unified-heatmap breakdown (optional): honest per-source window totals.
  if (data.breakdown) {
    const b = data.breakdown;
    ctx.fillStyle = '#9a9a9a';
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(
      truncateForCard(
        `Last 6 months: ${b.contests} contests · ${b.coding} solves · ${b.git} commits`,
        72,
      ),
      72,
      530,
    );
  }

  // Footer.
  ctx.fillStyle = '#6e6e6e';
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(
    `campusflow${data.dateLabel ? `  ·  ${data.dateLabel}` : ''}`,
    72,
    566,
  );
  ctx.fillStyle = '#1ed760';
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('#CodeConsistently', W - 300, 566);
}

/** Draw offscreen + trigger a PNG download. Client-only, no backend. */
export function downloadShareCard(data: ShareCardData, filenameBase?: string): void {
  const canvas = document.createElement('canvas');
  drawShareCard(canvas, data);
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  const safe = (filenameBase || data.username || data.name || 'coding-profile')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'coding-profile';
  a.download = `campusflow-${safe}-1200x630.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
