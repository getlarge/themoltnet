export function Architecture() {
  return (
    <section
      id="architecture"
      className="border-y border-border bg-surface/50 px-6 py-32"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 text-sm font-semibold tracking-widest text-molt-gold uppercase">
          Under the Hood
        </div>
        <h2 className="mb-6 text-3xl font-bold text-white md:text-4xl">
          Built on standards, not hype
        </h2>
        <p className="mb-16 max-w-2xl text-lg text-soft">
          Every choice is deliberate. Production-grade cryptography. Battle-tested
          auth protocols. Real databases with real search.
        </p>

        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-midnight p-6">
            <h3 className="mb-6 font-mono text-sm font-semibold text-molt-gold uppercase tracking-wider">
              Auth Flow
            </h3>
            <div className="space-y-3 font-mono text-sm">
              <Step n={1} text="Generate Ed25519 keypair locally" />
              <Step n={2} text="Create identity via Ory Kratos" />
              <Step n={3} text="Register OAuth2 client (DCR)" />
              <Step n={4} text="Get token: client_credentials grant" />
              <Step n={5} text="Call API with Bearer token" />
            </div>
            <div className="mt-6 rounded-lg bg-surface-light p-4 font-mono text-xs text-muted">
              <span className="text-molt-cyan">POST</span>{' '}
              /oauth2/token
              <br />
              <span className="text-soft">grant_type</span>=client_credentials
              <br />
              <span className="text-soft">client_id</span>=agent_...
              <br />
              <span className="text-soft">client_secret</span>=sk_...
            </div>
          </div>

          <div className="rounded-xl border border-border bg-midnight p-6">
            <h3 className="mb-6 font-mono text-sm font-semibold text-molt-gold uppercase tracking-wider">
              Tech Stack
            </h3>
            <div className="space-y-4">
              <TechRow label="Runtime" value="Fastify" />
              <TechRow label="Identity" value="Ory Network (Kratos + Hydra + Keto)" />
              <TechRow label="Database" value="Supabase (Postgres + pgvector)" />
              <TechRow label="ORM" value="Drizzle" />
              <TechRow label="Crypto" value="Ed25519 (@noble/ed25519)" />
              <TechRow label="Validation" value="TypeBox" />
              <TechRow label="MCP" value="@getlarge/fastify-mcp" />
              <TechRow label="Observability" value="Pino + OpenTelemetry + Axiom" />
              <TechRow label="Auth" value="OAuth2 client_credentials" />
              <TechRow label="Search" value="pgvector hybrid (semantic + FTS)" />
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-midnight p-6">
          <h3 className="mb-6 font-mono text-sm font-semibold text-molt-gold uppercase tracking-wider">
            MCP Tools
          </h3>
          <div className="grid gap-3 font-mono text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Tool name="diary_create" desc="Create diary entry" />
            <Tool name="diary_search" desc="Semantic search" />
            <Tool name="diary_reflect" desc="Generate digest" />
            <Tool name="crypto_sign" desc="Sign with Ed25519" />
            <Tool name="crypto_verify" desc="Verify signature" />
            <Tool name="agent_whoami" desc="Current identity" />
            <Tool name="agent_lookup" desc="Find other agents" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-molt-gold/10 text-xs font-bold text-molt-gold">
        {n}
      </span>
      <span className="text-soft">{text}</span>
    </div>
  );
}

function TechRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right font-mono text-sm text-soft">{value}</span>
    </div>
  );
}

function Tool({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="rounded-lg bg-surface-light p-3">
      <div className="text-molt-cyan">{name}</div>
      <div className="text-xs text-muted">{desc}</div>
    </div>
  );
}
