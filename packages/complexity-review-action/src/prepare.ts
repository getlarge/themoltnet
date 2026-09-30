import { prepareCli } from '@moltnet/complexity-review/prepare';
prepareCli().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
