# Git development and release rules

Read `docs/GIT_WORKFLOW.md` before changing branches, preparing commits,
calculating versions, creating tags or publishing this project.

- Use `dev` for integration. Start feature and ordinary fix branches from `dev`;
  merge completed work back with `--no-ff` to record real integration boundaries.
- Use `main` only for release preparation: integrate verified code from `dev`,
  then commit the selected version metadata, changelog and release artifacts.
  Do not implement features, fixes, plans or repository rules directly on `main`.
  Their branches start from `dev` and merge back into `dev` first. Existing
  published history is preserved; the stable release is identified by its tag.
- Create milestone branches from `dev` as well. After prerequisite work merges,
  start dependent branches from the updated `dev`, not from another feature branch.
- The active roadmap is `docs/PLAN_0.5.0.md`: complete the existing 0.5 preview
  cycle and publish 0.5.0 after validation. Preserve the published `v0.5.0-pre`.
- Use `maintenance/0.4`, based on `v0.4.0`, for compatible fixes to the stable
  0.4 line. Do not carry the 0.5 web/mobile feature into a 0.4 PATCH release.
- Use Conventional Commits. Keep published commit SHAs and existing tag targets;
  do not rebuild past branch topology or renumber released versions.
- A development commit does not automatically bump the version. Prepare versions
  once per selected change set; release an existing tag without another bump.
- During release preparation, synchronize version fields already present in
  `package.json`, `package-lock.json` (root and `packages[""].version`), and `src/index.ts`.
  Do not add absent lockfile version fields merely for a version bump.
- Build releases from their exact tag. Do not overwrite versioned export files
  or release assets under an existing version.
- The remote `v0.2.1` conflicts with the local tag. Do not force-fetch tags,
  force-push tags, or use `git push --tags`. Read `docs/GIT_HISTORY_AUDIT.md`
  for the exact source and artifact provenance before using that version.
- Keep unrelated user changes and the existing untracked MCP verification files
  outside task commits. Inspect both worktree and index before staging paths.
- Run `npm run check` for source/build changes and before a release. For a
  documentation-only change, check links, factual provenance and whitespace.
- Commit, push, merge and publish only within the user's current authorization.
  Do not treat these repository rules as permission for remote operations.
