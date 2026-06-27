if (process.env.NX_DRY_RUN === 'true') {
  console.log('Skipping Docker pre-version build during nx release dry-run.');
  process.exit(0);
}

console.log(
  'Docker release pre-version build is intentionally disabled in this spike. ' +
    'Wire this to targeted CI image builds before enabling Nx Release in production.',
);
