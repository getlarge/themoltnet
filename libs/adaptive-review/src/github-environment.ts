/** Git/gh children need a repository token, not coordinator or model credentials. */
export function githubChildEnvironment(
  source: NodeJS.ProcessEnv,
  token: string,
): NodeJS.ProcessEnv {
  const allowed =
    /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_.*|TZ|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|GITHUB_(API|GRAPHQL|SERVER)_URL|GH_HOST|GH_CONFIG_DIR|XDG_.*)$/;
  return {
    ...Object.fromEntries(
      Object.entries(source).filter(([name]) => allowed.test(name)),
    ),
    GH_TOKEN: token,
  };
}
