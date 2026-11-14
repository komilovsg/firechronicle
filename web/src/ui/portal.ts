/**
 * Overlays (select popovers and sheets, popovers, toasts, the assistant) must live inside the fullscreen subtree,
 * otherwise they render behind it. This resolves the right root and re-parents open overlays when it changes.
 */
export function portalRoot(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.querySelector<HTMLElement>('.fs-overlay:not([hidden])') ?? document.body;
}
/** Append an overlay to the current root and mark it so it follows fullscreen changes. */
export function mountPortal(el: HTMLElement): void { el.dataset.portal = '1'; portalRoot().append(el); }
export function repark(): void { const r = portalRoot(); document.querySelectorAll<HTMLElement>('[data-portal]').forEach((e) => { if (e.parentElement !== r) r.append(e); }); }
document.addEventListener('fullscreenchange', repark);
/** True when the page itself (not a fullscreen overlay) is the visible root, so body scroll lock makes sense. */
export const lockableBody = (): boolean => portalRoot() === document.body;
