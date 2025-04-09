# Contributing to ts-orm

First off, thanks for your interest in contributing to `ts-orm` – your time and effort help make this project better for everyone.

This project is maintained with a focus on clarity, consistency, and practical functionality. To help keep things smooth and collaborative, please follow the guidelines below.

---

## Ground Rules

1. **Post an Issue Before You Code**
   - Open an issue describing the feature, fix, or change you'd like to work on.
   - Provide as much context as possible (why it's needed, possible approaches, etc.).
   - Wait for discussion/approval before starting implementation.

2. **Branch Naming Convention**
   - Name your branch based on the issue number and topic.
   - Example: `12-add-schema-helper` or `45-fix-update-response`.

3. **Keep PRs Focused**
   - A pull request should resolve **one** issue or feature.
   - Don’t include unrelated changes, formatting, or refactoring in a PR unless it’s part of the issue.

4. **Pull Requests Must Be Reviewed**
   - All PRs require review and approval before being merged.
   - Write clear commit messages and include a link to the issue being addressed.
   - Add unit tests for any new logic and update existing tests if necessary.

---

## Development Workflow

1. Fork the repo and clone your fork.
2. Create a new branch from `main`.
3. Commit your changes with clear messages.
4. Push your branch to your fork.
5. Submit a pull request to the `main` branch of this repo.
6. Reference the relevant issue number in the pull request description.

---

## Code Style

- Use modern ES6+ syntax.
- Prefer clarity over cleverness.
- Keep function size minimal and single-responsibility.
- Use consistent formatting (we’ll add prettier/ESLint config soon).

---

## Running Tests

Before submitting a PR, make sure tests pass:

```bash
npm install
npm test
```
