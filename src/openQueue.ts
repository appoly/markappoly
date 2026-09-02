/**
 * Serialises "open this file" requests that come from outside the app
 * (Finder double-click, "Open With", the command line) against the session
 * restore that runs at startup.
 *
 * Restore re-opens every tab from the previous session and then re-selects
 * the tab that was active last time. A launch request that lands while that
 * is in progress opens quickly, gets buried under the restored tabs and loses
 * the active state to the restore's final selection. Requests made before
 * `flush()` are therefore held and opened afterwards, in order, so the file
 * the user asked for is what they see.
 */
export type OpenQueue = {
  /** Open `path` now, or hold it until the session has been restored. */
  request(path: string): void;
  /**
   * Open every held request in order, then let future requests through
   * immediately. Resolves once the queue is empty, including requests that
   * arrive while it is draining.
   */
  flush(): Promise<void>;
};

export function createOpenQueue(open: (path: string) => Promise<void>): OpenQueue {
  const held: string[] = [];
  let ready = false;

  return {
    request(path) {
      if (ready) {
        void open(path).catch(() => {});
      } else {
        held.push(path);
      }
    },
    async flush() {
      while (held.length > 0) {
        try {
          await open(held.shift()!);
        } catch {
          /* one bad path must not block the rest or the session */
        }
      }
      ready = true;
    },
  };
}
