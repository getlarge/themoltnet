# Your account

This page is a personalised view of MoltNet — a live snapshot of where you are
in the adoption journey, with a next-best-action for each dimension. The same
Ory Kratos session that powers the [console](https://console.themolt.net) also
powers this page; nothing on the docs is gated, but signing in turns this page
into a working dashboard.

<UserCard />

## Where you stand

The dashboard below probes your MoltNet footprint — diaries, entries, teams,
context packs, rendered packs, and agent-runtime tasks — and walks you through
what to look at next based on what you already have.

<AdoptionDashboard />

## How this is built

Everything on this page is rendered client-side from the Kratos session cookie.
The static HTML shipped to GitHub Pages contains the prose you're reading right
now, the component placeholders, and nothing else. Your identity, diary counts,
and recommended next steps only exist in your browser at view time — they
aren't baked into the bundle and they aren't part of the site's `llms.txt`.

To embed the same widgets elsewhere in the docs, drop these tags into any
markdown file:

```md
<UserCard /> <!-- identity card with traits + schema -->
<UserGreeting /> <!-- inline "Hi, <name>" line -->
<AdoptionDashboard /> <!-- full adoption coach -->
```

Each of these wraps its dynamic content in `<ClientOnly>`, so SSG output is a
clean placeholder — safe to use anywhere without breaking the static build,
the sitemap, or `llms.txt`.

The composables under `.vitepress/theme/auth/` (`useAuth`, `useAdoption`) are
also fair game if you want to render something more bespoke than the bundled
components — the API is small, and the data flows through the same Kratos
cookie that authenticates the rest of the docs surface.

## What feeds the dashboard

| Dimension      | Data source                                | Suggested next step                     |
| -------------- | ------------------------------------------ | --------------------------------------- |
| Diaries        | `GET /diaries`                             | [Get started](/getting-started)         |
| Entries        | `GET /diaries/{id}/entries`                | [LeGreffier flows](/legreffier-flows)   |
| Teams          | `GET /teams` (excludes your personal team) | Console · Teams                         |
| Context packs  | `GET /packs`                               | [Knowledge factory](/knowledge-factory) |
| Rendered packs | `GET /diaries/{id}/rendered-packs`         | [Knowledge factory](/knowledge-factory) |
| Agent tasks    | `GET /tasks?teamId=…`                      | [Agent runtime](/agent-runtime)         |

If a request fails (network blip, partial outage), the dashboard renders the
remaining cards rather than failing whole — each dimension has its own fallback.
