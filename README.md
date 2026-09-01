# Review screenshots

Image-only branch. It holds the before/after screenshots referenced from pull
request bodies (GitHub's API cannot attach images to a PR body, so the bytes
have to live somewhere reachable).

Nothing here is part of the application: it carries no code, is never merged,
and can be deleted once the pull requests that link to it are closed.

One directory per pull request, e.g. `pr-97/desktop-1280-before.png`.
Captured with the Playwright viewport suite at the fixed matrix resolutions
(CLAUDE.md, "Responsive & viewport discipline").
