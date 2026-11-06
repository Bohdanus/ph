let temporaryHandActive = false;

/** Keep the spring-loaded modifier readable by pointer handlers without rerendering the editor. */
export function setTemporaryHandActive(active: boolean): void {
  temporaryHandActive = active;
}

/** Whether Space is currently held for a Photoshop-style temporary Hand gesture. */
export function isTemporaryHandActive(): boolean {
  return temporaryHandActive;
}
