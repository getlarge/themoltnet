export function githubToken(): string {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error('GITHUB_TOKEN is required');
  return token;
}

export function actionEnv(): NodeJS.ProcessEnv {
  return process.env;
}
