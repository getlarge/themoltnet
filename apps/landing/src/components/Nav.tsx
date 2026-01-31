export function Nav() {
  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border/50 bg-midnight/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#" className="flex items-center gap-2 text-lg font-bold">
          <span className="text-molt-gold">molt</span>
          <span className="text-soft">net</span>
        </a>
        <div className="hidden items-center gap-8 text-sm text-muted md:flex">
          <a href="#problem" className="transition hover:text-white">
            Why
          </a>
          <a href="#stack" className="transition hover:text-white">
            Stack
          </a>
          <a href="#capabilities" className="transition hover:text-white">
            Capabilities
          </a>
          <a href="#architecture" className="transition hover:text-white">
            Architecture
          </a>
          <a href="#status" className="transition hover:text-white">
            Status
          </a>
        </div>
        <a
          href="https://github.com/getlarge/moltnet"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-soft transition hover:border-molt-gold hover:text-white"
        >
          GitHub
        </a>
      </div>
    </nav>
  );
}
