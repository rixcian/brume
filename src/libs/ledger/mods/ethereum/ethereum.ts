import { SignatureInit } from "@/libs/ethereum/mods/signature";
import { Base16 } from "@hazae41/base16";
import { Empty, Opaque, Writable } from "@hazae41/binary";
import { Bytes } from "@hazae41/bytes";
import { Rlp } from "@hazae41/cubane";
import { Cursor } from "@hazae41/cursor";
import { Err, Ok, Result } from "@hazae41/result";
import { Transaction } from "ethers";
import { Paths } from "../common/binary/paths";
import { LedgerUSBDevice } from "../usb";

export interface AppConfigResult {
  readonly arbitraryDataEnabled: boolean,
  readonly erc20ProvisioningNecessary: boolean,
  readonly starkEnabled: boolean,
  readonly starkv2Supported: boolean,

  readonly version: string
}

export async function tryGetAppConfig(device: LedgerUSBDevice): Promise<Result<AppConfigResult, Error>> {
  return await Result.unthrow(async t => {
    const request = { cla: 0xe0, ins: 0x06, p1: 0x00, p2: 0x00, fragment: new Empty() }
    const response = await device.tryRequest(request).then(r => r.throw(t).throw(t).bytes)

    const arbitraryDataEnabled = Boolean(response[0] & 0x01)
    const erc20ProvisioningNecessary = Boolean(response[0] & 0x02)
    const starkEnabled = Boolean(response[0] & 0x04)
    const starkv2Supported = Boolean(response[0] & 0x08)

    const version = `${response[1]}.${response[2]}.${response[3]}`

    return new Ok({ arbitraryDataEnabled, erc20ProvisioningNecessary, starkEnabled, starkv2Supported, version })
  })
}

export interface GetAddressResult {
  /**
   * 0x-prefixed hex address
   */
  readonly address: string

  /**
   * Raw uncompressed public key bytes
   */
  readonly uncompressedPublicKey: Bytes

  readonly chaincode: Bytes<32>
}

/**
 * Just get the address
 * @param device 
 * @param path 
 * @returns 
 */
export async function tryGetAddress(device: LedgerUSBDevice, path: string): Promise<Result<GetAddressResult, Error>> {
  return await Result.unthrow(async t => {
    const paths = Paths.from(path)

    const bytes = Writable.tryWriteToBytes(paths).throw(t)

    const request = { cla: 0xe0, ins: 0x02, p1: 0x00, p2: 0x01, fragment: new Opaque(bytes) }
    const response = await device.tryRequest(request).then(r => r.throw(t).throw(t).bytes)

    const cursor = new Cursor(response)

    const uncompressedPublicKeyLength = cursor.tryReadUint8().throw(t)
    const uncompressedPublicKey = cursor.tryRead(uncompressedPublicKeyLength).throw(t)

    const addressLength = cursor.tryReadUint8().throw(t)
    const address = `0x${Bytes.toAscii(cursor.tryRead(addressLength).throw(t))}`

    const chaincode = cursor.tryRead(32).throw(t)

    return new Ok({ uncompressedPublicKey, address, chaincode })
  })
}

/**
 * Ask the user to verify the address and get it
 * @param device 
 * @param path 
 * @returns 
 */
export async function tryVerifyAndGetAddress(device: LedgerUSBDevice, path: string): Promise<Result<GetAddressResult, Error>> {
  return await Result.unthrow(async t => {
    const paths = Paths.from(path)

    const bytes = Writable.tryWriteToBytes(paths).throw(t)

    const request = { cla: 0xe0, ins: 0x02, p1: 0x01, p2: 0x01, fragment: new Opaque(bytes) }
    const response = await device.tryRequest(request).then(r => r.throw(t).throw(t).bytes)

    const cursor = new Cursor(response)

    const uncompressedPublicKeyLength = cursor.tryReadUint8().throw(t)
    const uncompressedPublicKey = cursor.tryRead(uncompressedPublicKeyLength).throw(t)

    const addressLength = cursor.tryReadUint8().throw(t)
    const address = `0x${Bytes.toAscii(cursor.tryRead(addressLength).throw(t))}`

    const chaincode = cursor.tryRead(32).throw(t)

    return new Ok({ uncompressedPublicKey, address, chaincode })
  })
}

export async function trySignPersonalMessage(device: LedgerUSBDevice, path: string, message: Uint8Array): Promise<Result<SignatureInit, Error>> {
  return await Result.unthrow(async t => {
    const paths = Paths.from(path)

    const reader = new Cursor(message)

    let response: Bytes

    {
      const head = paths.trySize().get() + 4
      const body = Math.min(150 - head, reader.remaining)

      const chunk = reader.tryRead(body).throw(t)

      const writer = new Cursor(Bytes.tryAllocUnsafe(head + body).throw(t))
      paths.tryWrite(writer).throw(t)
      writer.tryWriteUint32(message.length).throw(t)
      writer.tryWrite(chunk).throw(t)

      const request = { cla: 0xe0, ins: 0x08, p1: 0x00, p2: 0x00, fragment: new Opaque(writer.bytes) }
      response = await device.tryRequest(request).then(r => r.throw(t).throw(t).bytes)
    }

    while (reader.remaining) {
      const body = Math.min(150, reader.remaining)
      const chunk = reader.tryRead(body).throw(t)

      const request = { cla: 0xe0, ins: 0x08, p1: 0x80, p2: 0x00, fragment: new Opaque(chunk) }
      response = await device.tryRequest(request).then(r => r.throw(t).throw(t).bytes)
    }

    const cursor = new Cursor(response)
    const v = cursor.tryReadUint8().throw(t) - 27
    const r = cursor.tryRead(32).throw(t)
    const s = cursor.tryRead(32).throw(t)

    return new Ok({ v, r, s })
  })
}

/**
 * Get the unprotected part of a legacy replay-protected transaction
 * @param bytes 
 * @returns 
 */
export function tryReadLegacyUnprotected(bytes: Uint8Array) {
  /**
   * This is not a legacy transaction (EIP-2718)
   */
  if (bytes[0] < 0x80)
    return new Ok(undefined)

  /**
   * Decode the bytes as RLP
   */
  const rlp = Rlp.tryReadFromBytes(bytes)

  if (rlp.isErr())
    return rlp

  if (!Array.isArray(rlp.inner))
    return new Err(new Error(`Wrong RLP type for transaction`))

  /**
   * This is not a replay-protected transaction (EIP-155)
   */
  if (rlp.inner.length !== 9)
    return new Ok(undefined)

  /**
   * Take only the first 6 parameters instead of the 9
   */
  const [nonce, gasprice, startgas, to, value, data] = rlp.inner

  /**
   * Encode them as RLP
   */
  return Rlp.tryWriteToBytes([nonce, gasprice, startgas, to, value, data])
}

export async function trySignTransaction(device: LedgerUSBDevice, path: string, transaction: Transaction): Promise<Result<SignatureInit, Error>> {
  return await Result.unthrow(async t => {
    const paths = Paths.from(path)

    using slice = Base16.get().tryPadStartAndDecode(transaction.unsignedSerialized.slice(2)).throw(t)

    const reader = new Cursor(slice.bytes)

    const unprotected = tryReadLegacyUnprotected(slice.bytes).throw(t)

    let response: Bytes

    {
      const head = paths.trySize().get()

      let body = Math.min(150 - head, reader.remaining)

      /**
       * Make sure that the chunk doesn't end right on the replay protection marker (EIP-155)
       * If it goes further than the unprotected part, then send the (few) remaining bytes of the protection
       */
      if (unprotected != null && reader.offset + body >= unprotected.length)
        body = reader.remaining

      const chunk = reader.tryRead(body).throw(t)

      const writer = new Cursor(Bytes.tryAllocUnsafe(head + body).throw(t))
      paths.tryWrite(writer).throw(t)
      writer.tryWrite(chunk).throw(t)

      const request = { cla: 0xe0, ins: 0x04, p1: 0x00, p2: 0x00, fragment: new Opaque(writer.bytes) }
      response = await device.tryRequest(request).then(r => r.throw(t).throw(t).bytes)
    }

    while (reader.remaining) {
      let body = Math.min(150, reader.remaining)

      /**
       * Make sure that the chunk doesn't end right on the replay protection marker (EIP-155)
       * If it goes further than the unprotected part, then send the (few) remaining bytes of the protection
       */
      if (unprotected != null && reader.offset + body >= unprotected.length)
        body = reader.remaining

      const chunk = reader.tryRead(body).throw(t)

      const request = { cla: 0xe0, ins: 0x04, p1: 0x80, p2: 0x00, fragment: new Opaque(chunk) }
      response = await device.tryRequest(request).then(r => r.throw(t).throw(t).bytes)
    }

    const cursor = new Cursor(response)
    const v = cursor.tryReadUint8().throw(t)
    const r = cursor.tryRead(32).throw(t)
    const s = cursor.tryRead(32).throw(t)

    // if ((((chainId * 2) + 35) + 1) > 255) {
    //   const parity = Math.abs(v0 - (((chainId * 2) + 35) % 256))

    //   if (transaction.type == null)
    //     v = ((chainId * 2) + 35) + parity
    //   else
    //     v = (parity % 2) == 1 ? 0 : 1;
    // }

    return new Ok({ v, r, s })
  })
}

export async function trySignEIP712HashedMessage(device: LedgerUSBDevice, path: string, domain: Bytes<32>, message: Bytes<32>): Promise<Result<SignatureInit, Error>> {
  return await Result.unthrow(async t => {
    const paths = Paths.from(path)

    const writer = new Cursor(Bytes.tryAllocUnsafe(paths.trySize().get() + 32 + 32).throw(t))
    paths.tryWrite(writer).throw(t)
    writer.tryWrite(domain).throw(t)
    writer.tryWrite(message).throw(t)

    const request = { cla: 0xe0, ins: 0x0c, p1: 0x00, p2: 0x00, fragment: new Opaque(writer.bytes) }
    const response = await device.tryRequest(request).then(r => r.throw(t).throw(t).bytes)

    const reader = new Cursor(response)
    const v = reader.tryReadUint8().throw(t) - 27
    const r = reader.tryRead(32).throw(t)
    const s = reader.tryRead(32).throw(t)

    return new Ok({ v, r, s })
  })
}