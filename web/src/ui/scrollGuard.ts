/** iOS: position:fixed on the body is not enough. Touch moves inside a sheet may only scroll its own scrollers, and never chain to the page. */
export function guardTouch(root: HTMLElement): void {
  let startY = 0;
  root.addEventListener('touchstart', (e) => { startY = e.touches[0]?.clientY ?? 0; }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    const dy = (e.touches[0]?.clientY ?? 0) - startY;
    for (let n = e.target as HTMLElement | null; n && n !== root.parentElement; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
        const atTop = n.scrollTop <= 0, atBottom = n.scrollTop + n.clientHeight >= n.scrollHeight - 1;
        if (((dy > 0 && atTop) || (dy < 0 && atBottom)) && e.cancelable) e.preventDefault();
        return;
      }
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
}
