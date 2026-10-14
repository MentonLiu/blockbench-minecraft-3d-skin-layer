# Git development and release rules

Read `docs/GIT_WORKFLOW.md` before changing branches, preparing commits,
calculating versions, creating tags or publishing this project.

- Use `dev` for integration. Start feature and ordinary fix branches from `dev`;
  merge completed work back with `--no-ff` to record real integration boundaries.
- Use `main` for code selected for version preparation and repository governance.
  The existing `0.5.0-pre` history on `main` is preserved. The latest stable release
  is identified by its tag, rather than by assuming `main` is that release.
- Use `maintenance/0.4`, based on `v0.4.0`, for compatible fixes to the stable
  0.4 line. Do not carry the 0.5 web/mobile feature into a 0.4 PATCH release.
- Use Conventional Commits. Keep published commit SHAs and existing tag targets;
  do not rebuild past branch topology or renumber released versions.
- A development commit does not automatically bump the version. Prepare versions
  once per selected change set; release an existing tag without another bump.
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
