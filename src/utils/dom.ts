/** Type-safe getElementById that throws if the element is missing. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required DOM element #${id} not found`);
  return element as T;
}

export function setStatus(element: HTMLElement, type: string, msg: string): void {
  element.className = `status-message ${type}`;
  element.textContent = msg;
}
