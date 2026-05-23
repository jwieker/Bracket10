#!/usr/bin/env bash
#
# excluded-paths.sh — single source of truth for what stays private.
#
# Sourced by both scripts/sync-public.sh (which pushes the public
# snapshot to the public repo) and scripts/private/preview-public-branch.sh
# (which pushes a preview branch to origin for inspection).
#
# The contract is: anything under `docs/private/` or `scripts/private/`
# stays private. To exempt new content, drop it into one of those dirs.
# Top-level private dirs that don't fit the umbrella convention
# (`docs/plans`, `product-backlog`, `.claude`, `.skills`) are also listed.
#
# tar --exclude takes either a file path or a directory name; bare dir
# names exclude the whole subtree.

PRIVATE_ONLY=(
  # Umbrella private dirs — anything inside these is stripped on publish.
  "docs/private"
  "scripts/private"
  "ai_private"        # AI prompts, LLM data extracts, model configs.

  # Other top-level private artifacts that don't fit the umbrella dirs.
  "docs/plans"        # Internal planning docs.
  "product-backlog"   # Product backlog kept at repo root.
  ".claude"           # Claude Code settings (allow-lists, hooks).
  ".skills"           # Claude Code skill definitions.

  # The publish script itself — only meaningful in the private repo.
  "scripts/sync-public.sh"
)
