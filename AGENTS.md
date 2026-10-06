# MY BLOG project instructions

## Production deployment is part of implementation

- The production site is `https://myhiphopblog.ypotitloi.gr`.
- The VPS SSH target is `root@89.167.23.230` and key-based authentication is configured.
- The production application root is `/opt/myhiphopblog`.
- The PM2 application name is `myhiphopblog`.
- The production application is the Express app in the local `vps/` directory. Make production-facing changes in `vps/` when applicable.

For every user request that changes this project's production behavior, deployment is part of the definition of done. After implementing the change:

1. Run the relevant local checks. For changes under `vps/`, always run `npm run check` and `npm test` from `vps/`.
2. If the checks pass, deploy automatically to the production VPS without asking for a separate confirmation.
3. Deploy only the files intentionally changed for the current request. Never upload the whole dirty working tree or unrelated user changes.
4. Before overwriting each existing remote file, create a timestamped backup on the VPS under `/opt/myhiphopblog/backups/` while preserving its relative path or an unambiguous filename.
5. Copy each selected local `vps/` file to its matching path below `/opt/myhiphopblog/`. Create required remote directories when necessary.
6. Never deploy local instruction files, temporary folders, `.env` files, secrets, databases, uploads, build artifacts, or unrelated untracked files.
7. If `vps/package.json` or `vps/package-lock.json` changed, install production dependencies on the VPS using `npm ci --omit=dev` from `/opt/myhiphopblog` before restarting.
8. Restart only the blog service with `pm2 restart myhiphopblog`. Use `--update-env` only when the environment configuration was intentionally changed.
9. Verify that PM2 reports `myhiphopblog` as `online`, that `https://myhiphopblog.ypotitloi.gr/health` succeeds, and that the requested behavior is visible on the live site. Use a targeted HTTP or browser check when the change is user-facing.
10. Report implementation, test, deployment, and live-verification results in the final response. A production-facing change is not complete when it exists only locally.

Do not deploy when the user explicitly says the work should remain local, asks only for analysis/review/explanation/diagnosis without requesting a change, or when tests fail. If deployment fails, investigate safe in-scope causes and clearly report the remaining blocker instead of claiming completion.
