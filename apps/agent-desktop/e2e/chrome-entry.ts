export {};

// Only the E2E Vite configuration serves this entry. Mount after IPC mocks exist.
await new Promise<void>((resolve) => {
  window.addEventListener('desktop-e2e:mount', () => resolve(), { once: true });
});
await import('../src/main.js');
