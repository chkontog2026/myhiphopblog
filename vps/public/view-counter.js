(() => {
  if (navigator.webdriver) return;

  let recorded = false;
  const startedAt = performance.now();
  const eventNames = ["pointerdown", "touchstart", "keydown", "scroll", "click"];

  function removeListeners() {
    for (const eventName of eventNames) {
      window.removeEventListener(eventName, recordView, true);
    }
  }

  function recordView(event) {
    if (recorded || !event.isTrusted || performance.now() - startedAt < 750) return;
    if (document.visibilityState !== "visible") return;
    recorded = true;
    removeListeners();
    fetch("/analytics/page-view", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Page-View-Intent": "1" },
      keepalive: true,
    }).catch(() => {});
  }

  for (const eventName of eventNames) {
    window.addEventListener(eventName, recordView, { capture: true, passive: true });
  }
})();
