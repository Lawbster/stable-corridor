export interface KrakenChecksumLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface KrakenChecksumBook {
  readonly bids: readonly KrakenChecksumLevel[];
  readonly asks: readonly KrakenChecksumLevel[];
}

function checksumComponent(value: string): string {
  const withoutDecimalPoint = value.replace(".", "");
  const withoutLeadingZeros = withoutDecimalPoint.replace(/^0+/u, "");
  return withoutLeadingZeros.length === 0 ? "0" : withoutLeadingZeros;
}

export function krakenChecksumInput(book: KrakenChecksumBook): string {
  const asks = book.asks
    .slice(0, 10)
    .map(
      (level) =>
        checksumComponent(level.price) +
        checksumComponent(level.quantity)
    )
    .join("");
  const bids = book.bids
    .slice(0, 10)
    .map(
      (level) =>
        checksumComponent(level.price) +
        checksumComponent(level.quantity)
    )
    .join("");
  return asks + bids;
}

export function crc32Utf8(value: string): number {
  let checksum = 0xffffffff;
  for (const byte of Buffer.from(value, "utf8")) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(checksum & 1);
      checksum = (checksum >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

export function calculateKrakenBookChecksum(
  book: KrakenChecksumBook
): number {
  return crc32Utf8(krakenChecksumInput(book));
}
