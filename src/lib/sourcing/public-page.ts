import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { publicLink } from "./import-schema";
export class SupplierPageError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const MAX_PAGE_BYTES = 1024 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const special6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  special6.addSubnet(address, prefix, "ipv6");
export function publicAddress(address: string) {
  const version = isIP(address);
  return version === 4
    ? !blocked.check(address, "ipv4")
    : version === 6 &&
        global6.check(address, "ipv6") &&
        !special6.check(address, "ipv6");
}
type Address = { address: string; family: number };
export async function pinnedDestination(
  raw: string,
  resolver: (host: string) => Promise<Address[]> = (host) =>
    lookup(host, { all: true, verbatim: true }),
) {
  const parsed = publicLink.safeParse(raw);
  if (!parsed.success)
    throw new SupplierPageError(parsed.error.issues[0].message);
  const url = new URL(parsed.data);
  url.hash = "";
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    /\.(localhost|local|internal|test|invalid)$/.test(hostname)
  )
    throw new SupplierPageError("Use a public supplier website.");
  let addresses: Address[];
  let resolverTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await Promise.race([
          resolver(hostname),
          new Promise<never>((_resolve, reject) => {
            resolverTimer = setTimeout(
              () => reject(new Error("DNS timeout")),
              5000,
            );
          }),
        ]);
  } catch {
    throw new SupplierPageError(
      "The supplier website could not be found. Check the link.",
      502,
    );
  } finally {
    if (resolverTimer) clearTimeout(resolverTimer);
  }
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new SupplierPageError("Use a public supplier website.");
  return { url, hostname, address: addresses[0] };
}
/** TLS verifies the original host, while the socket uses the checked address once (no DNS rebinding). */
async function getPage(
  destination: Awaited<ReturnType<typeof pinnedDestination>>,
  signal: AbortSignal,
): Promise<{ status: number; location?: string; html?: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      destination.url,
      {
        method: "GET",
        signal,
        headers: {
          Accept: "text/html, application/xhtml+xml",
          "Accept-Encoding": "identity",
          "User-Agent": "Fundur-Workflows-ProductReader/1.0",
        },
        lookup: (_host, _options, callback) => {
          const cb = callback as (
            error: Error | null,
            address: string | Address[],
            family?: number,
          ) => void;
          if (typeof _options === "object" && _options.all)
            cb(null, [destination.address]);
          else
            cb(null, destination.address.address, destination.address.family);
        },
      },
      (res) => {
        res.once("error", () =>
          reject(
            new SupplierPageError(
              "The page download was interrupted. Please retry.",
              502,
            ),
          ),
        );
        const status = res.statusCode ?? 502;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.resume();
          resolve({ status, location: res.headers.location });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(
            new SupplierPageError(
              status === 403 || status === 429
                ? "This supplier blocks automatic reading. Copy its product details into the fields instead."
                : "The supplier page could not be read. Check the link or enter its details manually.",
              502,
            ),
          );
          return;
        }
        if (
          !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(
            res.headers["content-type"] ?? "",
          )
        ) {
          res.destroy();
          reject(
            new SupplierPageError(
              "Use a product web page. PDFs and other files can be uploaded to Documents instead.",
            ),
          );
          return;
        }
        const encoding = (
            res.headers["content-encoding"] ?? "identity"
          ).toLowerCase(),
          decode =
            encoding === "gzip"
              ? createGunzip()
              : encoding === "deflate"
                ? createInflate()
                : encoding === "br"
                  ? createBrotliDecompress()
                  : null;
        if (!["identity", "gzip", "deflate", "br"].includes(encoding)) {
          res.destroy();
          reject(
            new SupplierPageError(
              "This page uses an unsupported encoding. Enter its details manually.",
            ),
          );
          return;
        }
        const body = decode ? res.pipe(decode) : res,
          chunks: Buffer[] = [];
        let compressedBytes = 0;
        if (decode)
          res.on("data", (chunk: Buffer) => {
            compressedBytes += chunk.length;
            if (compressedBytes > MAX_PAGE_BYTES * 2) {
              body.destroy();
              res.destroy();
              req.destroy();
              reject(
                new SupplierPageError(
                  "This page is too large to read automatically.",
                ),
              );
            }
          });
        let count = 0;
        body.on("data", (chunk: Buffer) => {
          count += chunk.length;
          if (count > MAX_PAGE_BYTES) {
            body.destroy();
            res.destroy();
            req.destroy();
            reject(
              new SupplierPageError(
                "This page is too large to read automatically. Enter its details manually.",
              ),
            );
          } else chunks.push(chunk);
        });
        body.once("end", () =>
          resolve({ status, html: Buffer.concat(chunks).toString("utf8") }),
        );
        body.once("error", () =>
          reject(
            new SupplierPageError(
              "The page download was interrupted. Please retry.",
              502,
            ),
          ),
        );
        res.once("aborted", () => {
          body.destroy();
          reject(
            new SupplierPageError(
              "The page download was interrupted. Please retry.",
              502,
            ),
          );
        });
      },
    );
    req.once("error", () =>
      reject(
        new SupplierPageError(
          "The supplier page could not be reached. Please retry or enter its details manually.",
          502,
        ),
      ),
    );
    req.setTimeout(10_000, () => req.destroy());
    req.end();
  });
}
export async function readPublicPage(
  raw: string,
  deps: {
    resolver?: Parameters<typeof pinnedDestination>[1];
    read?: typeof getPage;
  } = {},
) {
  const signal = AbortSignal.timeout(20_000);
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    const destination = await pinnedDestination(url, deps.resolver),
      result = await (deps.read ?? getPage)(destination, signal);
    if (result.html !== undefined)
      return { url: destination.url.href, html: result.html };
    if (!result.location)
      throw new SupplierPageError(
        "The supplier redirect could not be followed.",
      );
    url = new URL(result.location, destination.url).href;
  }
  throw new SupplierPageError(
    "This supplier redirects too many times. Paste its final product link instead.",
  );
}
