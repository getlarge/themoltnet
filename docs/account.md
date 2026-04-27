# Your account

These docs read your MoltNet identity straight from the same Ory Kratos session
the [console](https://console.themolt.net) uses, so anything you sign into over
on the console will show up here too. Nothing on this site is gated — this page
is just a window into the session you already have.

<UserCard />

## How this works

The page above is rendered by a Vue component (`UserCard`) registered in the
VitePress theme. On mount it calls `toSession()` against
`https://auth.themolt.net` with credentials, exactly like the console does. If
there's a `.themolt.net`-scoped Kratos cookie, you'll see your identity; if
not, you'll get a "Log in" button that bounces through Kratos and brings you
right back here.

To embed your identity anywhere else in the docs, drop the component into any
markdown file:

```md
<UserCard />
```

The same `useAuth` composable that backs `<UserCard>` is available to any
custom component under `.vitepress/theme/` if you want to render something
more bespoke.
