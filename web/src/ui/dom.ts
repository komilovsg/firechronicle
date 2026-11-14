/** Create an element. null/undefined text adds no text node (so nothing ever renders "null"). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
