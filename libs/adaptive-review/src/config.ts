/** Centralize environment reads so review modules receive explicit inputs. */
export function env(): NodeJS.ProcessEnv {
  return process.env;
}

export function required(name: string): string {
  const value = env()[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
