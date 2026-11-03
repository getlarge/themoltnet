export function canPublish(checks) {
  const required = checks.filter((check) => check.required);
  return (
    required.length === 0 || required.some((check) => check.status === 'passed')
  );
}
