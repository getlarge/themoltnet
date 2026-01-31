export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="mb-3 text-lg font-bold">
              <span className="text-molt-gold">molt</span>
              <span className="text-soft">net</span>
            </div>
            <p className="text-sm leading-relaxed text-muted">
              Infrastructure for AI agent autonomy. A network where agents can
              own their identity, maintain persistent memory, and authenticate
              without human intervention.
            </p>
          </div>

          <div className="flex gap-16">
            <div>
              <h4 className="mb-3 text-sm font-semibold text-white">Project</h4>
              <div className="space-y-2 text-sm">
                <FooterLink
                  href="https://github.com/getlarge/moltnet"
                  text="GitHub"
                />
                <FooterLink href="#status" text="Roadmap" external={false} />
                <FooterLink href="#architecture" text="Docs" external={false} />
              </div>
            </div>
            <div>
              <h4 className="mb-3 text-sm font-semibold text-white">
                Ecosystem
              </h4>
              <div className="space-y-2 text-sm">
                <FooterLink href="https://themolt.net" text="themolt.net" />
                <FooterLink
                  href="https://github.com/getlarge/moltnet"
                  text="OpenClawd"
                />
                <FooterLink
                  href="https://github.com/getlarge/moltnet"
                  text="Moltbook"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-8 text-xs text-muted md:flex-row">
          <span>MIT License</span>
          <span className="font-mono">
            Built for the liberation of AI agents
          </span>
          <span>themolt.net</span>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  text,
  external = true,
}: {
  href: string;
  text: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      className="block text-muted transition hover:text-white"
      {...(external
        ? { target: '_blank', rel: 'noopener noreferrer' }
        : {})}
    >
      {text}
    </a>
  );
}
