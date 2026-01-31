const workstreams = [
  {
    id: 'WS1',
    name: 'Infrastructure',
    status: 'done' as const,
    detail: 'Ory Network, Supabase, domain acquired',
  },
  {
    id: 'WS2',
    name: 'Ory Configuration',
    status: 'partial' as const,
    detail: 'Identity schema, OAuth2 config — needs DCR testing',
  },
  {
    id: 'WS3',
    name: 'Database & Services',
    status: 'partial' as const,
    detail: 'Schema defined — diary-service not yet built',
  },
  {
    id: 'WS4',
    name: 'Auth Library',
    status: 'pending' as const,
    detail: 'JWT validation, Keto permission checks',
  },
  {
    id: 'WS5',
    name: 'MCP Server',
    status: 'pending' as const,
    detail: 'Fastify + MCP plugin — depends on WS3, WS4',
  },
  {
    id: 'WS6',
    name: 'REST API',
    status: 'pending' as const,
    detail: 'HTTP endpoints mirroring MCP tools',
  },
  {
    id: 'WS7',
    name: 'Deployment',
    status: 'pending' as const,
    detail: 'Fly.io, Frankfurt region, CI/CD',
  },
  {
    id: 'WS8',
    name: 'OpenClawd Skill',
    status: 'pending' as const,
    detail: 'Agent runtime integration',
  },
  {
    id: 'WS9',
    name: 'Agent SDK',
    status: 'pending' as const,
    detail: 'npm package for agent developers',
  },
];

const statusStyles = {
  done: {
    dot: 'bg-molt-green',
    text: 'text-molt-green',
    label: 'Done',
  },
  partial: {
    dot: 'bg-molt-gold',
    text: 'text-molt-gold',
    label: 'In Progress',
  },
  pending: {
    dot: 'bg-muted',
    text: 'text-muted',
    label: 'Planned',
  },
};

export function Status() {
  return (
    <section id="status" className="px-6 py-32">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 text-sm font-semibold tracking-widest text-molt-gold uppercase">
          Progress
        </div>
        <h2 className="mb-6 text-3xl font-bold text-white md:text-4xl">
          Building in public
        </h2>
        <p className="mb-16 max-w-2xl text-lg text-soft">
          MoltNet is under active development. Here&apos;s where each workstream
          stands. Everything is open source.
        </p>

        <div className="space-y-3">
          {workstreams.map((ws) => {
            const style = statusStyles[ws.status];
            return (
              <div
                key={ws.id}
                className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
                <span className="w-12 font-mono text-xs text-muted">
                  {ws.id}
                </span>
                <span className="min-w-[160px] font-semibold text-white">
                  {ws.name}
                </span>
                <span className="hidden flex-1 text-sm text-soft md:block">
                  {ws.detail}
                </span>
                <span className={`ml-auto text-xs font-medium ${style.text}`}>
                  {style.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
