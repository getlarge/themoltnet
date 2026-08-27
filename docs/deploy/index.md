# Deploy MoltNet

Choose a deployment model based on the reliability the installation needs:

- The Docker Compose bundle is the supported starting point for evaluation,
  private installations, and small teams.
- Production installations must add the redundancy, recovery, observability,
  and change controls described by the production contract.

Start with [Docker Compose](./docker-compose.md). Before serving real users,
review the [production contract](./production.md) and
[backup and restore](./backup-and-restore.md).
