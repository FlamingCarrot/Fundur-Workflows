/** Streaming, uncompressed ZIP32. CAD/PDF/image bytes stay exact; no whole-file buffering. */
export interface ZipEntry {
  name: string;
  data: Uint8Array | ReadableStream<Uint8Array>;
  expectedSize?: number;
}
const encoder = new TextEncoder(),
  MAX = 0xffffffff;
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crcUpdate(crc: number, bytes: Uint8Array) {
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}
const bytes = (length: number) => new Uint8Array(length);
const put16 = (b: Uint8Array, offset: number, value: number) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).setUint16(
    offset,
    value,
    true,
  );
const put32 = (b: Uint8Array, offset: number, value: number) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(
    offset,
    value,
    true,
  );
async function* chunks(data: ZipEntry["data"]) {
  if (data instanceof Uint8Array) {
    yield data;
    return;
  }
  const reader = data.getReader();
  let ended = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        ended = true;
        break;
      }
      yield next.value;
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function validName(name: string) {
  return (
    name.length > 0 &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !/[\x00-\x1f]/.test(name) &&
    name.split("/").every((p) => p && p !== "." && p !== "..")
  );
}
async function* zip(entries: AsyncIterable<ZipEntry>, limit: number) {
  let offset = 0;
  const directory: Uint8Array[] = [],
    names = new Set<string>();
  const tick = new Date(),
    year = Math.max(1980, Math.min(2107, tick.getUTCFullYear())),
    time =
      (tick.getUTCHours() << 11) |
      (tick.getUTCMinutes() << 5) |
      (tick.getUTCSeconds() >> 1),
    date =
      ((year - 1980) << 9) |
      ((tick.getUTCMonth() + 1) << 5) |
      tick.getUTCDate();
  const account = (n: number) => {
    offset += n;
    if (offset > limit || offset > MAX)
      throw new Error("Archive exceeded its size limit.");
  };
  for await (const entry of entries) {
    if (!validName(entry.name) || names.has(entry.name))
      throw new Error("Invalid or duplicate archive path.");
    names.add(entry.name);
    if (names.size > 60000) throw new Error("Too many archive entries.");
    const name = encoder.encode(entry.name);
    if (name.length > 65535) throw new Error("Archive path is too long.");
    const start = offset,
      header = bytes(30 + name.length);
    put32(header, 0, 0x04034b50);
    put16(header, 4, 20);
    put16(header, 6, 0x0808);
    put16(header, 10, time);
    put16(header, 12, date);
    put16(header, 26, name.length);
    header.set(name, 30);
    account(header.length);
    yield header;
    let crc = 0xffffffff,
      size = 0;
    for await (const chunk of chunks(entry.data)) {
      size += chunk.length;
      if (size > MAX) throw new Error("File exceeds the ZIP32 limit.");
      crc = crcUpdate(crc, chunk);
      account(chunk.length);
      yield chunk;
    }
    if (entry.expectedSize !== undefined && size !== entry.expectedSize)
      throw new Error("A stored file was incomplete. Retry the export.");
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = bytes(16);
    put32(descriptor, 0, 0x08074b50);
    put32(descriptor, 4, crc);
    put32(descriptor, 8, size);
    put32(descriptor, 12, size);
    account(16);
    yield descriptor;
    const central = bytes(46 + name.length);
    put32(central, 0, 0x02014b50);
    put16(central, 4, 20);
    put16(central, 6, 20);
    put16(central, 8, 0x0808);
    put16(central, 12, time);
    put16(central, 14, date);
    put32(central, 16, crc);
    put32(central, 20, size);
    put32(central, 24, size);
    put16(central, 28, name.length);
    put32(central, 42, start);
    central.set(name, 46);
    directory.push(central);
  }
  const centralOffset = offset;
  for (const central of directory) {
    account(central.length);
    yield central;
  }
  const centralSize = offset - centralOffset,
    end = bytes(22);
  put32(end, 0, 0x06054b50);
  put16(end, 8, names.size);
  put16(end, 10, names.size);
  put32(end, 12, centralSize);
  put32(end, 16, centralOffset);
  account(22);
  yield end;
}
export function zipStream(
  entries: AsyncIterable<ZipEntry>,
  limit = 2 * 1024 * 1024 * 1024,
): ReadableStream<Uint8Array> {
  const iterator = zip(entries, limit);
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (e) {
        await iterator.return(undefined).catch(() => {});
        controller.error(e);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
export const textEntry = (name: string, text: string): ZipEntry => ({
  name,
  data: encoder.encode(text),
});
