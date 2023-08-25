import { RpcRequest, RpcRequestInit, RpcRequestPreinit, RpcResponse, RpcResponseInit } from "@/libs/rpc";
import { Sockets } from "@/libs/sockets/sockets";
import { SafeJson } from "@/libs/wconn/libs/json/json";
import { Ciphertext, Envelope, EnvelopeTypeZero, Plaintext } from "@/libs/wconn/mods/crypto/crypto";
import { Berith } from "@hazae41/berith";
import { Opaque, Readable, Writable } from "@hazae41/binary";
import { Bytes } from "@hazae41/bytes";
import { Future } from "@hazae41/future";
import { None, Option, Some } from "@hazae41/option";
import { AbortedError, ClosedError, ErroredError, SuperEventTarget } from "@hazae41/plume";
import { Err, Ok, Result } from "@hazae41/result";
import { base58, base64url } from "@scure/base";
import { useCallback, useState } from "react";

interface RpcOpts {
  readonly prompt: boolean
  readonly ttl: number
  readonly tag: number
}

export const ENGINE_RPC_OPTS: Record<string, { req: RpcOpts, res: RpcOpts }> = {
  wc_sessionPropose: {
    req: {
      ttl: 5 * 60,
      prompt: true,
      tag: 1100,
    },
    res: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1101,
    },
  },
  wc_sessionSettle: {
    req: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1102,
    },
    res: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1103,
    },
  },
  wc_sessionUpdate: {
    req: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1104,
    },
    res: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1105,
    },
  },
  wc_sessionExtend: {
    req: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1106,
    },
    res: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1107,
    },
  },
  wc_sessionRequest: {
    req: {
      ttl: 5 * 60,
      prompt: true,
      tag: 1108,
    },
    res: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1109,
    },
  },
  wc_sessionEvent: {
    req: {
      ttl: 5 * 60,
      prompt: true,
      tag: 1110,
    },
    res: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1111,
    },
  },
  wc_sessionDelete: {
    req: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1112,
    },
    res: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1113,
    },
  },
  wc_sessionPing: {
    req: {
      ttl: 30,
      prompt: false,
      tag: 1114,
    },
    res: {
      ttl: 30,
      prompt: false,
      tag: 1115,
    },
  },
} as const

export namespace JWT {

  export function trySign(keypair: Berith.Ed25519Keypair, audience: string): Result<string, Error> {
    return Result.unthrowSync(t => {
      const alg = "EdDSA"
      const typ = "JWT"

      const preheader = { alg, typ }

      const iss = `did:key:z${base58.encode(Bytes.concat([Bytes.fromHex("ed01"), keypair.public().to_bytes()]))}`
      const sub = Bytes.toHex(Bytes.tryRandom(32).throw(t))
      const aud = audience
      const iat = Math.floor(Date.now() / 1000)
      const ttl = 24 * 60 * 60 // one day in seconds
      const exp = iat + ttl

      const prepayload = { iss, sub, aud, iat, exp }

      const header = base64url.encode(Bytes.fromUtf8(SafeJson.stringify(preheader))).replaceAll("=", "")
      const payload = base64url.encode(Bytes.fromUtf8(SafeJson.stringify(prepayload))).replaceAll("=", "")

      const presignature = Bytes.fromUtf8(`${header}.${payload}`)

      const signature = base64url.encode(keypair.sign(presignature).to_bytes()).replaceAll("=", "")

      return new Ok(`${header}.${payload}.${signature}`)
    })
  }

}

export namespace SafeRpc {

  export function prepare<T>(init: RpcRequestPreinit<T>): RpcRequest<T> {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    return new RpcRequest(id, init.method, init.params)
  }

  export async function tryRequest<T>(socket: WebSocket, init: RpcRequestPreinit<unknown>, signal: AbortSignal) {
    const request = prepare(init)

    socket.send(SafeJson.stringify(request))

    const future = new Future<Result<RpcResponse<T>, ClosedError | ErroredError | AbortedError>>()

    const onMessage = async (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string")
        return
      const response = RpcResponse.from<T>(JSON.parse(event.data))

      if (response.id !== request.id)
        return
      future.resolve(new Ok(response))
    }

    const onError = (e: unknown) => {
      future.resolve(new Err(ErroredError.from(e)))
    }

    const onClose = (e: unknown) => {
      future.resolve(new Err(ClosedError.from(e)))
    }

    const onAbort = () => {
      future.resolve(new Err(AbortedError.from(signal.reason)))
    }

    try {
      socket.addEventListener("message", onMessage, { passive: true })
      socket.addEventListener("close", onClose, { passive: true })
      socket.addEventListener("error", onError, { passive: true })
      signal.addEventListener("abort", onAbort, { passive: true })

      return await future.promise
    } finally {
      socket.removeEventListener("message", onMessage)
      socket.removeEventListener("close", onClose)
      socket.removeEventListener("error", onError)
      signal.removeEventListener("abort", onAbort)
    }

  }

}

export interface IrnSubscriptionPayload {
  readonly id: string
  readonly data: {
    readonly topic: string
    readonly message: string
    readonly publishedAt: number
    readonly tag: number
  }
}

export interface IrnPublishPayload {
  readonly topic: string
  readonly message: string
  readonly prompt: boolean
  readonly tag: number
  readonly ttl: number
}

export class IrnClient {

  readonly topicBySubscription = new Map<string, string>()

  readonly events = new SuperEventTarget<{
    request: (request: RpcRequestPreinit<unknown>) => Result<unknown, Error>
  }>()

  constructor(
    readonly socket: WebSocket
  ) {
    socket.addEventListener("message", this.#onMessage.bind(this))
  }

  #onMessage(event: MessageEvent<unknown>) {
    if (typeof event.data !== "string")
      return
    const json = JSON.parse(event.data) as RpcRequestInit<unknown> | RpcResponseInit<unknown>

    if ("method" in json)
      return this.#onRequest(json)
    return
  }

  async #onRequest(request: RpcRequestInit<unknown>) {
    const result = await this.#tryRouteRequest(request)
    const response = RpcResponse.rewrap(request.id, result)
    this.socket.send(SafeJson.stringify(response))
  }

  async #tryRouteRequest(request: RpcRequestPreinit<unknown>) {
    const returned = await this.events.emit("request", [request])

    if (returned.isSome())
      return returned.inner

    return new Err(new Error(`Unhandled`))
  }

  async trySubscribe(topic: string): Promise<Result<string, Error>> {
    return await Result.unthrow(async t => {
      const subscription = await SafeRpc.tryRequest<string>(this.socket, {
        method: "irn_subscribe",
        params: { topic }
      }, AbortSignal.timeout(5000)).then(r => r.throw(t).throw(t))

      this.topicBySubscription.set(subscription, topic)

      return new Ok(subscription)
    })
  }

  async tryPublish(payload: IrnPublishPayload): Promise<Result<void, Error>> {
    return await Result.unthrow(async t => {
      const result = await SafeRpc.tryRequest<boolean>(this.socket, {
        method: "irn_publish",
        params: payload
      }, AbortSignal.timeout(5000)).then(r => r.throw(t).throw(t))

      return Result.assert(result).setErr(new Error(`Got false`))
    })
  }

}

export class CryptoClient {

  readonly events = new SuperEventTarget<{
    request: (request: RpcRequestPreinit<unknown>) => Result<unknown, Error>
    response: (response: RpcResponseInit<unknown>) => void
  }>()

  constructor(
    readonly topic: string,
    readonly key: Bytes<32>,
    readonly irn: IrnClient
  ) {
    irn.events.on("request", this.#onIrnRequest.bind(this))
  }

  async #onIrnRequest(request: RpcRequestPreinit<unknown>) {
    if (request.method === "irn_subscription")
      return await this.#onIrnSubscription(request)
    return new None()
  }

  async #onIrnSubscription(request: RpcRequestPreinit<unknown>) {
    const { data } = (request as RpcRequestPreinit<IrnSubscriptionPayload>).params

    if (data.topic !== this.topic)
      return new None()

    return new Some(await this.#onMessage(data.message))
  }

  async #onMessage(message: string): Promise<Result<true, Error>> {
    return Result.unthrow(async t => {
      const bytes = Bytes.fromBase64(message)
      const envelope = Readable.tryReadFromBytes(Envelope, bytes).throw(t)
      const cipher = envelope.fragment.tryReadInto(Ciphertext).throw(t)
      const plain = cipher.tryDecrypt(this.key).throw(t)
      const plaintext = Bytes.toUtf8(plain.fragment.bytes)

      const data = SafeJson.parse(plaintext) as RpcRequestInit<unknown> | RpcResponseInit<unknown>

      if ("method" in data)
        this.#onRequest(data).then(r => r.unwrap()).catch(console.error)
      else
        this.#onResponse(data).then(r => r.unwrap()).catch(console.error)

      return new Ok(true)
    })
  }

  async #onRequest(request: RpcRequestInit<unknown>): Promise<Result<void, Error>> {
    return Result.unthrow(async t => {
      console.log("->", request)
      const result = await this.#tryRouteRequest(request)
      const response = RpcResponse.rewrap(request.id, result)

      const { topic } = this
      const message = this.#tryEncrypt(response).throw(t)
      const { prompt, tag, ttl } = ENGINE_RPC_OPTS[request.method].res
      return await this.irn.tryPublish({ topic, message, prompt, tag, ttl })
    })
  }

  async #tryRouteRequest(request: RpcRequestPreinit<unknown>) {
    const returned = await this.events.emit("request", [request])

    if (returned.isSome())
      return returned.inner

    return new Err(new Error(`Unhandled`))
  }

  async #onResponse(response: RpcResponseInit<unknown>) {
    console.log("->", response)
    const returned = await this.events.emit("response", [response])

    if (returned.isSome())
      return Ok.void()

    return new Err(new Error(`Unhandled`))
  }

  #tryEncrypt(data: unknown): Result<string, Error> {
    return Result.unthrowSync(t => {
      const plaintext = SafeJson.stringify(data)
      const plain = new Plaintext(new Opaque(Bytes.fromUtf8(plaintext)))
      const iv = Bytes.tryRandom(12).throw(t) // TODO maybe use a counter
      const cipher = plain.tryEncrypt(this.key, iv).throw(t)
      const envelope = new EnvelopeTypeZero(cipher)
      const bytes = Writable.tryWriteToBytes(envelope).throw(t)
      const message = Bytes.toBase64(bytes)

      return new Ok(message)
    })
  }

  async tryRequest<T>(init: RpcRequestPreinit<unknown>): Promise<Result<RpcResponse<T>, Error>> {
    return Result.unthrow(async t => {
      const request = SafeRpc.prepare(init)

      const { topic } = this
      const message = this.#tryEncrypt(request).throw(t)
      const { prompt, tag, ttl } = ENGINE_RPC_OPTS[init.method].req
      await this.irn.tryPublish({ topic, message, prompt, tag, ttl }).then(r => r.throw(t))

      const future = new Future<Result<RpcResponse<T>, Error>>()
      const signal = AbortSignal.timeout(ttl * 1000)

      const onResponse = (init: RpcResponseInit<any>) => {
        if (init.id !== request.id)
          return new None()
        const response = RpcResponse.from<T>(init)
        future.resolve(new Ok(response))
        return new Some(undefined)
      }

      const onAbort = () => {
        future.resolve(new Err(new Error(`Timed out`)))
      }

      try {
        this.events.on("response", onResponse, { passive: true })
        signal.addEventListener("abort", onAbort, { passive: true })

        return await future.promise
      } finally {
        this.events.off("response", onResponse)
        signal.removeEventListener("abort", onAbort)
      }
    })
  }

}

export interface WcSessionProposeParams {
  readonly proposer: {
    /**
     * base16
     */
    readonly publicKey: string

    readonly metadata: {
      readonly name: string
      readonly description: string
      readonly url: string
      readonly icons: string[]
    }
  }

  readonly relays: {
    readonly protocol: string
  }[]

  readonly requiredNamespaces: any
  readonly optionalNamespaces: any
}

export interface WcSessionRequestParams<T = unknown> {
  /**
   * namespace:decimal
   */
  readonly chainId: `${string}:${string}`
  readonly request: RpcRequestPreinit<T>
}

export default function Page() {
  const [url = "", setUrl] = useState<string>()

  const onClick = useCallback(async () => {
    if (!url) return

    return Result.unthrow<Result<void, Error>>(async t => {
      Berith.initSyncBundledOnce()

      const relay = "wss://relay.walletconnect.org"

      const { protocol, pathname, searchParams } = new URL(url)

      if (protocol !== "wc:")
        return new Err(new Error(`Invalid protocol`))

      const [pairingTopic, version] = pathname.split("@")

      if (version !== "2")
        return new Err(new Error(`Invalid version`))

      const relayProtocol = Option.wrap(searchParams.get("relay-protocol")).ok().throw(t)

      if (relayProtocol !== "irn")
        return new Err(new Error(`Invalid relay protocol`))

      const symKeyHex = Option.wrap(searchParams.get("symKey")).ok().throw(t)
      const symKey = Bytes.fromHexSafe(symKeyHex)
      const symKey32 = Bytes.tryCast(symKey, 32).throw(t)

      const key = new Berith.Ed25519Keypair()

      const auth = JWT.trySign(key, "wss://relay.walletconnect.org").throw(t)
      const projectId = "a6e0e589ca8c0326addb7c877bbb0857"

      const socket = new WebSocket(`${relay}/?auth=${auth}&projectId=${projectId}`)
      await Sockets.tryWaitOpen(socket, AbortSignal.timeout(5000)).then(r => r.throw(t))

      const irn = new IrnClient(socket)

      await irn.trySubscribe(pairingTopic).then(r => r.throw(t))
      const client = new CryptoClient(pairingTopic, symKey32, irn)

      {
        const relay = { protocol: "irn" }
        const self = new Berith.X25519StaticSecret()

        const proposal = await client.events.wait("request", async (future: Future<RpcRequestPreinit<WcSessionProposeParams>>, request) => {
          if (request.method !== "wc_sessionPropose")
            return new None()
          future.resolve(request as RpcRequestPreinit<WcSessionProposeParams>)

          const responderPublicKey = Bytes.toHex(self.to_public().to_bytes())
          return new Some(new Ok({ relay, responderPublicKey }))
        }).inner

        const peer = Berith.X25519PublicKey.from_bytes(Bytes.fromHexSafe(proposal.params.proposer.publicKey))
        const shared = Bytes.tryCast(self.diffie_hellman(peer).to_bytes(), 32).throw(t)

        const hdfk_key = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"])
        const hkdf_params = { name: "HKDF", hash: "SHA-256", info: new Uint8Array(), salt: new Uint8Array() }
        const key = new Uint8Array(await crypto.subtle.deriveBits(hkdf_params, hdfk_key, 8 * 32)) as Bytes<32>

        const sessionTopic = Bytes.toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", key)))

        await irn.trySubscribe(sessionTopic).then(r => r.throw(t))
        const client2 = new CryptoClient(sessionTopic, key, irn)

        const { requiredNamespaces, optionalNamespaces } = proposal.params

        const namespaces = {
          eip155: {
            chains: ["eip155:1"],
            methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
            events: ["chainChanged", "accountsChanged"],
            accounts: ["eip155:1:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]
          }
        }

        const publicKey = Bytes.toHex(self.to_public().to_bytes())
        const metadata = { name: "Brume", description: "Brume", url: location.origin, icons: [] }
        const controller = { publicKey, metadata }
        const expiry = Math.floor((Date.now() + (7 * 24 * 60 * 60)) / 1000)
        const params = { relay, namespaces, requiredNamespaces, optionalNamespaces, pairingTopic, controller, expiry }

        await client2.tryRequest<boolean>({ method: "wc_sessionSettle", params })
          .then(r => r.throw(t).throw(t))
          .then(Result.assert)
          .then(r => r.setErr(new Error(`false`)).throw(t))

        return Ok.void()
      }
    })

  }, [url])

  return <>
    <input placeholder="url"
      value={url}
      onChange={e => setUrl(e.currentTarget.value)} />
    <button onClick={onClick}>
      click me
    </button>
  </>
}