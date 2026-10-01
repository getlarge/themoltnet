import { main } from '@moltnet/complexity-review/main';
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
