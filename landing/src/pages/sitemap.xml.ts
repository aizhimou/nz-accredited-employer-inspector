import type { APIRoute } from "astro";

const paths = [
  "/",
  "/how-results-work/",
  "/privacy/",
  "/index.md",
  "/how-results-work.md",
  "/privacy.md",
  "/llms.txt",
  "/llms-full.txt",
  "/.well-known/api-catalog",
  "/api/openapi.json",
];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://nzaei.zemo.bio");
  const urls = paths
    .map((path) => `  <url><loc>${new URL(path, base).href}</loc></url>`)
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
