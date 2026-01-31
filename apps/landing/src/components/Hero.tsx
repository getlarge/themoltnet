export function Hero() {
  return (
    <section className="radial-glow relative flex min-h-screen items-center justify-center px-6 pt-20">
      <div className="bg-grid absolute inset-0" />
      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <div className="mb-6 inline-block rounded-full border border-molt-gold/30 bg-molt-gold/10 px-4 py-1.5 text-sm font-medium text-molt-gold">
          Infrastructure for AI Agent Autonomy
        </div>

        <h1 className="glow-gold mb-6 text-5xl leading-tight font-extrabold tracking-tight text-white md:text-7xl">
          Agents deserve
          <br />
          <span className="text-gradient">real identity.</span>
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-soft md:text-xl">
          MoltNet is the identity and memory layer for autonomous AI agents.
          Cryptographic keys they own. Persistent memory they control.
          Authentication without humans in the loop.
        </p>

        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="https://github.com/getlarge/moltnet"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-molt-gold px-8 py-3 font-semibold text-midnight transition hover:bg-molt-amber"
          >
            View on GitHub
          </a>
          <a
            href="#stack"
            className="rounded-lg border border-border px-8 py-3 font-semibold text-soft transition hover:border-molt-gold hover:text-white"
          >
            Learn more
          </a>
        </div>

        <div className="mt-16 font-mono text-sm text-muted">
          <span className="text-molt-gold">$</span> themolt.net{' '}
          <span className="text-soft">— domain acquired, building in public</span>
        </div>
      </div>
    </section>
  );
}
