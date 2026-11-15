---
name: git
description: Commit, gren, push og pull request med git og gh. Bruk når brukeren ber om noe med git eller GitHub.
args: "[hva som skal gjøres]"
mode: code
---
# Git and GitHub

Task: {{args}}

Commit, push and open pull requests only when the user asks for it. Looking at status, log and diff is always fine.

## Always first
`git status` and `git branch --show-current`. Know what is modified, staged and untracked, and which branch you are on, before any other command.

## Commit
1. `git diff` to read what will go in. Leave out files that do not belong: secrets, `.env`, build output, editor files, unrelated edits by others.
2. Stage by name: `git add path/one path/two`. Avoid `git add -A` unless you have checked every file.
3. Write the message the way the project does (`git log --oneline -10`). First line under about 70 characters saying what changed; a short body saying why when it is not obvious.
4. `git status` afterwards to confirm.

## Branches
- Do not create a branch unless the user or the project's instructions ask for one. When they do: `git switch -c short-topic-name`.
- Update from the remote with `git fetch` and then merge or rebase as the project does. Read conflicts in the files, resolve each one, and run the tests before continuing.

## Push and pull requests
- `git push -u origin <branch>` on first push.
- With the GitHub CLI: `gh auth status`, then `gh pr create --title "..." --body "..."`. The body says what changed, why, and how it was tested.
- Never say CI is green or a PR is merged without checking: `gh pr checks`, `gh pr view --json state,mergedAt`.
- Read the whole thread before answering an issue or review: `gh issue view N --comments`, `gh pr view N --comments`.

## Ask before these
Force push, `git reset --hard`, `git clean`, deleting branches, rebasing or amending commits that are already pushed, changing remotes, and anything in `.git/hooks`. Explain what will be lost and wait for a yes.

## If something goes wrong
Stop and show the user the exact output. `git reflog` usually has the way back; do not try several destructive commands in a row.
