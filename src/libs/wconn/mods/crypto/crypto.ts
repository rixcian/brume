import { BinaryReadError, BinaryWriteError, Opaque, Writable } from "@hazae41/binary";
import { Bytes } from "@hazae41/bytes";
import { ChaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { Cursor } from "@hazae41/cursor";
import { Err, Ok, Panic, Result } from "@hazae41/result";

export class CryptoError extends Error {
  readonly #class = CryptoError
  readonly name = this.#class.name

  static from(cause: unknown) {
    return new CryptoError(undefined, { cause })
  }

}

export class Plaintext<T extends Writable.Infer<T>> {

  constructor(
    readonly fragment: T
  ) { }

  tryEncrypt(key: ChaCha20Poly1305.Cipher, iv: Bytes<12>): Result<Ciphertext, ChaCha20Poly1305.EncryptError | BinaryWriteError | Writable.WriteError<T> | Writable.SizeError<T>> {
    return Result.unthrowSync(t => {
      const plain = Writable.tryWriteToBytes(this.fragment).throw(t)
      const cipher = key.tryEncrypt(plain, iv).throw(t).copyAndDispose()

      return new Ok(new Ciphertext(iv, cipher))
    })
  }

}

export class Ciphertext {

  constructor(
    readonly iv: Bytes<12>,
    readonly inner: Bytes,
  ) { }

  tryDecrypt(key: ChaCha20Poly1305.Cipher): Result<Plaintext<Opaque>, ChaCha20Poly1305.DecryptError> {
    return Result.unthrowSync(t => {
      const plain = key.tryDecrypt(this.inner, this.iv).throw(t).copyAndDispose()

      return new Ok(new Plaintext(new Opaque(plain)))
    })
  }

  trySize(): Result<number, never> {
    return new Ok(this.iv.length + this.inner.length)
  }

  tryWrite(cursor: Cursor): Result<void, BinaryWriteError> {
    return Result.unthrowSync(t => {
      cursor.tryWrite(this.iv).throw(t)
      cursor.tryWrite(this.inner).throw(t)

      return Ok.void()
    })
  }

  static tryRead(cursor: Cursor): Result<Ciphertext, BinaryReadError> {
    return Result.unthrowSync(t => {
      const iv = cursor.tryRead(12).throw(t)
      const inner = cursor.tryRead(cursor.remaining).throw(t)

      return new Ok(new Ciphertext(iv, inner))
    })
  }

}

export type Envelope<T extends Writable.Infer<T>> =
  | EnvelopeTypeZero<T>
  | EnvelopeTypeOne<T>

export namespace Envelope {

  export class UnknownTypeError extends Error {
    readonly #class = UnknownTypeError
    readonly name = this.#class.name

    constructor(
      readonly type: number
    ) {
      super(`Unknown type ${type}`)
    }

  }

  export function tryRead(cursor: Cursor): Result<Envelope<Opaque>, BinaryReadError | UnknownTypeError> {
    return Result.unthrowSync(t => {
      const type = cursor.tryGetUint8().throw(t)

      if (type === 0)
        return EnvelopeTypeZero.tryRead(cursor)
      if (type === 1)
        return EnvelopeTypeOne.tryRead(cursor)
      return new Err(new UnknownTypeError(type))
    })
  }

}

export class EnvelopeTypeZero<T extends Writable.Infer<T>> {
  readonly #class = EnvelopeTypeZero

  static readonly type = 0 as const
  readonly type = this.#class.type

  constructor(
    readonly fragment: T
  ) { }

  trySize(): Result<number, Writable.SizeError<T>> {
    return this.fragment.trySize().mapSync(x => 1 + x)
  }

  tryWrite(cursor: Cursor): Result<void, BinaryWriteError | Writable.WriteError<T>> {
    return Result.unthrowSync(t => {
      cursor.tryWriteUint8(this.type).throw(t)
      this.fragment.tryWrite(cursor).throw(t)

      return Ok.void()
    })
  }

  static tryRead(cursor: Cursor): Result<EnvelopeTypeZero<Opaque>, BinaryReadError> {
    return Result.unthrowSync(t => {
      const type = cursor.tryReadUint8().throw(t)

      if (type !== EnvelopeTypeZero.type)
        throw Panic.from(new Error(`Invalid type-0 type ${type}`))

      const bytes = cursor.tryRead(cursor.remaining).throw(t)
      const fragment = new Opaque(bytes)

      return new Ok(new EnvelopeTypeZero(fragment))
    })
  }

}

export class EnvelopeTypeOne<T extends Writable.Infer<T>> {
  readonly #class = EnvelopeTypeOne

  static readonly type = 1 as const
  readonly type = this.#class.type

  constructor(
    readonly sender: Bytes<32>,
    readonly fragment: T
  ) { }

  trySize() {
    return this.fragment.trySize().mapSync(x => 1 + this.sender.length + x)
  }

  tryWrite(cursor: Cursor): Result<void, BinaryWriteError | Writable.WriteError<T>> {
    return Result.unthrowSync(t => {
      cursor.tryWriteUint8(this.type).throw(t)
      cursor.tryWrite(this.sender).throw(t)
      this.fragment.tryWrite(cursor).throw(t)

      return Ok.void()
    })
  }

  static tryRead(cursor: Cursor): Result<EnvelopeTypeOne<Opaque>, BinaryReadError> {
    return Result.unthrowSync(t => {
      const type = cursor.tryReadUint8().throw(t)

      if (type !== EnvelopeTypeOne.type)
        throw Panic.from(new Error(`Invalid type ${type}`))

      const sender = cursor.tryRead(32).throw(t)
      const bytes = cursor.tryRead(cursor.remaining).throw(t)
      const fragment = new Opaque(bytes)

      return new Ok(new EnvelopeTypeOne(sender, fragment))
    })
  }

}