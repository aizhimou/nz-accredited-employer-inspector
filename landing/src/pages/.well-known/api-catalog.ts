import type { APIRoute } from "astro";

const API_BASE_URL = "https://nzaei.zemo.bio/api";
const CONTRACT_URL =
  "https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/docs/extension-api-ssot.md";

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://nzaei.zemo.bio");
  const catalogUrl = new URL("/.well-known/api-catalog", base).href;
  const body = {
    linkset: [
      {
        anchor: API_BASE_URL,
        "service-desc": [
          {
            href: new URL("/api/openapi.json", base).href,
            type: "application/vnd.oai.openapi+json;version=3.1",
          },
        ],
        "service-doc": [{ href: CONTRACT_URL, type: "text/html" }],
        author: [{ href: "https://zemo.bio/", type: "text/html" }],
        "privacy-policy": [
          { href: new URL("/privacy/", base).href, type: "text/html" },
        ],
        status: [{ href: `${API_BASE_URL}/health`, type: "application/json" }],
        "service-meta": [
          { href: new URL("/llms-full.txt", base).href, type: "text/markdown" },
        ],
      },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type":
        'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      Link: `<${catalogUrl}>; rel="api-catalog"`,
    },
  });
};
