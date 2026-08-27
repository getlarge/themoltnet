# Deploy MoltNet

MoltNet has two deployment layers:

- The public self-host contract is a portable Docker Compose bundle. It is the
  supported starting point for evaluation, private installations, and small
  teams.
- Reliable hosted operation is an implementation concern. Operators choose
  providers and automation that satisfy the production contract without
  copying the topology of the public MoltNet service.

Start with [Docker Compose](./docker-compose.md). Before serving real users,
review the [production contract](./production.md) and
[backup and restore](./backup-and-restore.md).

The public repository deliberately documents interfaces and recovery
objectives, not the provider accounts, regions, application names, dashboards,
or deployment credentials used by the hosted service.
