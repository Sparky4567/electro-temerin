import { join } from "node:path";

const ROOT = import.meta.dir;
const PUBLIC = join(ROOT, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wav": "audio/wav",
};

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",

  async fetch(req) {
    const url = new URL(req.url);

    // Health / capability endpoint (useful for debugging sensor requirements)
    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        name: "electro-temerin",
        secureContextRequired: true,
        sensorDocs: "https://developer.mozilla.org/en-US/docs/Web/API/Magnetometer",
        time: new Date().toISOString(),
      });
    }

    let pathname = url.pathname;
    if (pathname === "/") pathname = "/index.html";

    // Prevent path traversal
    const safe = pathname.replace(/\0/g, "").split("?")[0]!;
    if (safe.includes("..")) return new Response("Bad request", { status: 400 });

    const filePath = join(PUBLIC, safe.slice(1));
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": MIME[extOf(filePath)] ?? "application/octet-stream",
          "Cache-Control": "no-cache",
          // Permissions-Policy is not required for Generic Sensor API,
          // but be explicit so embedding still works.
          "Permissions-Policy": "magnetometer=*",
        },
      });
    }

    return new Response("Not found — electro-temerin serves /index.html", {
      status: 404,
    });
  },
});

console.log(`◉ electro-temerin singing on http://localhost:${server.port}`);
console.log(`  Secure context (https or localhost) is REQUIRED for Magnetometer API.`);
