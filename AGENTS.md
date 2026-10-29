# Agent guidance

## Repository boundary and Git safety

This is the standalone LFYs repository. Keep source changes and local Git metadata in this checkout; never copy or reuse `.git` from another repository. The `LearnForYourself` reference checkout, `nvtruongops/LearnForYourself`, and `classroomio/classroomio` are read-only. Do not create branches, commits, pull requests, or send GitHub write/API requests in those repositories. Never push to `classroomio/classroomio`.

No remote is authorized by default. Before any remote write, ask the user to confirm the exact destination repository and branch, then verify the configured remote URL and name the remote explicitly. If the destination is absent or ambiguous, stop without writing. Keep work local until then.

## Product scope

Product requirements, architecture decisions, implementation plans, and design specs are private local documents under `.superpowers/`. Keep them separate from public-facing documentation and never force-add them.

Historical source checklists belonged to a different repository and have been consolidated into the requirements plan. In LFYs every implementation checkpoint starts pending; mark it complete only with evidence produced from this repo.

## Implementation practice

Use test-first changes and run the relevant verification before claiming completion. Keep authorization server-side; treat retrieved web content, model output, and MCP arguments as untrusted data; avoid logging chat content, credentials, bearer values, or share tokens. Keep frontend, backend, auth, agent runtime, MCP, and jobs inside one application/configuration boundary. Do not add dependencies or external integrations without a task requiring them.
