# E2E tests

Run the end-to-end suite in Docker:

```bash
pnpm test:e2e
```

The runner builds an isolated Docker image, packs the package, installs that tarball into temporary projects, and invokes the CLI through real `npx -y @asnd/skill-creator`. Generated wrapper scripts also call real `npx`; the tests set npm offline mode after the package install so wrappers must resolve the locally installed package instead of the registry.

For debugging only, you can run the scripts in the current environment with isolated temp `HOME`/config directories:

```bash
E2E_INSIDE_DOCKER=1 bash e2e/run.sh --inside
```
