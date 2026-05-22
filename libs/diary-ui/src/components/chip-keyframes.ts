/**
 * Singleton injection for the chip enter animation. Hoisted out of the
 * per-instance Chip render so the keyframes rule lives once in the document
 * instead of being re-injected on every chip mount. The check is idempotent
 * and SSR-safe (no-op when `document` is undefined).
 */

const STYLE_ID = 'diary-ui-chip-keyframes';

const CSS = `
@keyframes diary-ui-chip-in {
  from { opacity: 0; transform: translateY(-1px); }
  to   { opacity: 1; transform: translateY(0); }
}
.diary-ui-chip {
  animation: diary-ui-chip-in 140ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .diary-ui-chip { animation: none; }
}
`;

let injected = false;

export function ensureChipKeyframes(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) {
    injected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}
