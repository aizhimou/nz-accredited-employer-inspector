import type { APIRoute } from "astro";
import { releases } from "../data/changelog";

export const GET: APIRoute = () => {
  const entries = releases
    .map((release) => {
      const status = release.status ? ` · ${release.status}` : "";
      const changes = release.changes
        .map((change) => `- **${change.title}:** ${change.detail}`)
        .join("\n");

      return `## v${release.version}${status}\n\nReleased ${release.date}.\n\n### ${release.headline}\n\n${release.summary}\n\n${changes}`;
    })
    .join("\n\n---\n\n");

  const body = `---
title: Changelog | NZ Accredited Employer Inspector
description: A public record of product releases, user-visible improvements and the source changes behind NZ Accredited Employer Inspector.
language: en-NZ
current_version: ${releases[0].version}
---

# Changelog

A plain record of what changed, when it changed, and why it matters to people checking New Zealand employers. Entries are listed newest first.

${entries}

## Complete technical history

The [public repository](https://github.com/aizhimou/nz-accredited-employer-inspector) is the complete technical record. [View every commit](https://github.com/aizhimou/nz-accredited-employer-inspector/commits/main/).
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
