# OIDC Publish Setup

Releases ship via `.github/workflows/publish.yml` using npm's OIDC trusted publisher flow — no long-lived token required.

## To publish a new version

1. Bump the version in `package.json`.
2. `git tag vX.Y.Z && git push --tags`.
3. GitHub Actions auto-publishes with `--provenance`.

## One-time npm-side setup (required before first OIDC publish)

Go to `https://www.npmjs.com/package/fidgetcoding-morgen-mcp/access` → Publishing access → add **GitHub Actions** as a trusted publisher for repo `fidgetcoding/morgen-mcp` and workflow `publish.yml`.

Without this, `npm publish --provenance` fails with: `unauthorized: The package requires ...`.
