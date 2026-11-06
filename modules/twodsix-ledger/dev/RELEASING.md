# Releasing the ledger module

Do these in order. The release workflow checks the marked steps and stops if one is missing.

1. **Test** with the module in a real Foundry (`dev/ledger-switch.sh local`), including what changed since the last release.
2. **`npx vitest run`** and **`npx eslint modules/twodsix-ledger`** must be clean.
3. **CHANGELOG.md**: rename `## Unreleased` to `## <version>`, and make sure every change is in it. *(checked)*
4. **MANUAL.md**: go through it against what changed. New or changed functions, settings, buttons and rules must be in the
   text, and anything that no longer works must be removed. Then set the line `**Applies to version: <version>**`. *(checked)*
5. **module.json**: set `version` and the `download` URL (`.../releases/download/ledger-v<version>/twodsix-ledger.zip`).
   *(checked)*
6. **README.md**: update it only if install, requirements or the short feature list changed.
7. Commit and push to `experiment/ledger-module`, then tag that commit and push the tag:

   ```bash
   git pull
   git tag ledger-v<version> <commit>
   git push origin ledger-v<version>
   ```

8. Watch **Actions** for a green run, and look at the release: `twodsix-ledger.zip` and `module.json` are attached, and
   the text has the manifest URL, the manual link and **What changed**.
9. In Foundry, **Check for Update** and try the module.

A tag that is placed on the wrong commit is moved with `git tag -d`, `git push origin :refs/tags/<tag>` and a new tag.
