export {};

// Register before page load completes, then mount only after IPC mocks exist.
window.addEventListener(
  'desktop-e2e:mount',
  () => {
    void import('@moltnet/agent-desktop/main');
  },
  { once: true },
);
