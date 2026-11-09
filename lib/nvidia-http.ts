import { execFileSync } from "node:child_process";
import { ProxyAgent } from "undici";

const agents = new Map<string, ProxyAgent>();
let settings: { until: number; proxy: string | null; bypass: string } | undefined;

function windowsProxy(): { proxy: string | null; bypass: string } {
  if (process.platform !== "win32") return { proxy: null, bypass: "" };
  if (settings && settings.until > Date.now()) return settings;
  let proxy: string | null = null;
  let bypass = "";
  try {
    const output = execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    });
    const value = (name: string) => output.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, "im"))?.[1]?.trim();
    if (value("ProxyEnable") === "0x1") {
      const configured = value("ProxyServer") ?? "";
      proxy = configured.includes("=")
        ? configured.split(";").map((part) => part.trim()).find((part) => /^https=/i.test(part))?.slice(6) ?? null
        : configured || null;
      bypass = value("ProxyOverride") ?? "";
    }
  } catch {
    // If Windows settings cannot be read, keep the normal direct-connection behavior.
  }
  settings = { until: Date.now() + 5000, proxy, bypass };
  return settings;
}

function isBypassed(hostname: string, rules: string): boolean {
  return rules.split(/[;,\s]+/).some((rule) => {
    const entry = rule.trim().toLowerCase();
    if (!entry || entry === "<local>") return false;
    if (entry === "*") return true;
    const suffix = entry.replace(/^\*\./, ".");
    return hostname === suffix.replace(/^\./, "") || (suffix.startsWith(".") && hostname.endsWith(suffix));
  });
}

/** NVIDIA requests honor an explicit proxy, then the Windows user proxy; local requests stay direct. */
export async function nvidiaFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.protocol !== "https:" || !(url.hostname === "nvidia.com" || url.hostname.endsWith(".nvidia.com"))) {
    throw new Error("Unapproved NVIDIA URL");
  }
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const current = envProxy ? { proxy: envProxy, bypass: process.env.NO_PROXY || process.env.no_proxy || "" } : windowsProxy();
  if (!current.proxy || isBypassed(url.hostname, current.bypass)) return fetch(input, init);
  const proxyUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(current.proxy) ? current.proxy : `http://${current.proxy}`;
  const parsed = new URL(proxyUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported proxy protocol");
  let agent = agents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    agents.set(proxyUrl, agent);
  }
  return fetch(input, { ...init, dispatcher: agent } as RequestInit);
}
