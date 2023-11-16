export interface HDNodeResponse {
  path: number[];
  serializedPath: string;
  childNum: number;
  xpub: string;
  xpubSegwit?: string;
  chainCode: string;
  publicKey: string;
  fingerprint: number;
  depth: number;
}