// The plugin sandbox doesn't expose every web API that a window does, so fall
// back to the main window's copy. In Node (tests) everything is on globalThis.
export function webGlobal<T>(name: string): T {
  const own = (globalThis as any)[name];
  if (own) return own;
  return (Zotero.getMainWindow() as any)[name];
}
