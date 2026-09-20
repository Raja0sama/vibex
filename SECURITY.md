# Security

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/Raja0sama/vibex/security/advisories/new).
It is the only channel that lets us fix something before it is public.

Please do not open a public issue for a security problem. The intake queue answers
issues automatically, and an automatic answer to a vulnerability report is worse
than no answer.

Expect an acknowledgement within a week. If a report is valid you will be credited
in the advisory unless you ask not to be.

## Supported versions

Pre-1.0, only the latest published version gets fixes. There are no backports.

## What is worth reporting

vibeX turns a spec into a standalone HTML file that somebody then opens in a
browser, and reads a repository to check claims against code. The interesting
boundaries are therefore:

- **A spec that produces live markup.** Every string from a spec is escaped before
  it reaches HTML or SVG, and the embedded JSON block is encoded so it cannot close
  itself. A spec that gets a script to run, an attribute to break out, or a
  `javascript:` URL into an `href`, is a vulnerability.
- **A spec or lock file that reads outside the repository.** Anchor paths resolve
  against `--repo` and are confined to it. A path that escapes — through traversal,
  a symlink, or an absolute path — is a vulnerability.
- **A spec that causes command execution.** git runs through `execFileSync` with
  argument arrays and no shell. Anything that reaches a shell, or smuggles an
  option into a git invocation, is a vulnerability.
- **The intake workflow.** It reads issue bodies written by the public. Anything
  that turns that text into repository writes, or into instructions an agent
  follows, is a vulnerability.

## What is not

- A hostile spec making an ugly or unreadable diagram. Garbage in, garbage out is
  not a security boundary.
- The generated HTML executing its own inlined viewer script. That is the point.
- Anything requiring the attacker to already be able to write to your repository.
