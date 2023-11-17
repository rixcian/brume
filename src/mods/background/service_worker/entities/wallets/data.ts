import { EnsAbi } from "@/libs/abi/ens.abi"
import { TokenAbi } from "@/libs/abi/erc20.abi"
import { PairAbi } from "@/libs/abi/pair.abi"
import { ChainData, PairInfo, chainByChainId, pairByAddress, tokenByAddress } from "@/libs/ethereum/mods/chain"
import { Fixed, FixedInit } from "@/libs/fixed/fixed"
import { Maps } from "@/libs/maps/maps"
import { TorRpc } from "@/libs/rpc/rpc"
import { AbortSignals } from "@/libs/signals/signals"
import { Mutators } from "@/libs/xswr/mutators"
import { Bytes } from "@hazae41/bytes"
import { Cubane, ZeroHexString } from "@hazae41/cubane"
import { Data, Fail, Fetched, FetcherMore, IDBStorage, SimpleQuery, States, createQuery } from "@hazae41/glacier"
import { RpcRequestPreinit } from "@hazae41/jsonrpc"
import { None, Nullable, Option, Some } from "@hazae41/option"
import { Ok, Panic, Result } from "@hazae41/result"
import { EthBrume } from "../brumes/data"
import { WalletsBySeed } from "../seeds/all/data"
import { SeedRef } from "../seeds/data"
import { ContractTokenData } from "../tokens/data"
import { BgWallets } from "./all/data"

export type Wallet =
  | WalletRef
  | WalletData

export interface WalletProps {
  readonly wallet: Wallet
}

export interface WalletDataProps {
  readonly wallet: WalletData
}

export interface WalletRef {
  readonly ref: true
  readonly uuid: string
}

export namespace WalletRef {

  export function create(uuid: string): WalletRef {
    return { ref: true, uuid }
  }

  export function from(wallet: Wallet): WalletRef {
    return create(wallet.uuid)
  }

}

export type WalletData =
  | EthereumWalletData

export type EthereumWalletData =
  | EthereumReadonlyWalletData
  | EthereumSignableWalletData

export type EthereumSignableWalletData =
  | EthereumPrivateKeyWalletData
  | EthereumSeededWalletData
  | EthereumTrezorWalletData

export type EthereumPrivateKeyWalletData =
  | EthereumUnauthPrivateKeyWalletData
  | EthereumAuthPrivateKeyWalletData

export interface EthereumReadonlyWalletData {
  readonly coin: "ethereum"
  readonly type: "readonly"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: ZeroHexString
}

export interface EthereumUnauthPrivateKeyWalletData {
  readonly coin: "ethereum"
  readonly type: "privateKey"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: ZeroHexString

  readonly privateKey: string
}

export interface EthereumAuthPrivateKeyWalletData {
  readonly coin: "ethereum"
  readonly type: "authPrivateKey"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: ZeroHexString

  readonly privateKey: {
    readonly ivBase64: string,
    readonly idBase64: string
  }
}

export interface EthereumSeededWalletData {
  readonly coin: "ethereum"
  readonly type: "seeded"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: ZeroHexString

  readonly seed: SeedRef
  readonly path: string
}

export interface EthereumTrezorWalletData {
  readonly coin: "ethereum"
  readonly type: "trezor"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: ZeroHexString

  readonly path: string
}

export namespace Wallet {

  export type Key = ReturnType<typeof key>

  export function key(uuid: string) {
    return `wallet/${uuid}`
  }

  export type Schema = ReturnType<typeof schema>

  export function schema(uuid: string, storage: IDBStorage) {
    const indexer = async (states: States<WalletData, never>) => {
      return await Result.unthrow<Result<void, Error>>(async t => {
        const { current, previous = current } = states

        const previousData = previous.real?.data
        const currentData = current.real?.data

        await BgWallets.schema(storage).tryMutate(Mutators.mapData((d = new Data([])) => {
          if (previousData?.inner.uuid === currentData?.inner.uuid)
            return d
          if (previousData != null)
            d = d.mapSync(p => p.filter(x => x.uuid !== previousData.inner.uuid))
          if (currentData != null)
            d = d.mapSync(p => [...p, WalletRef.from(currentData.inner)])
          return d
        })).then(r => r.throw(t))

        if (currentData?.inner.type === "seeded") {
          const { seed } = currentData.inner

          const walletsBySeedQuery = WalletsBySeed.Background.schema(seed.uuid, storage)

          await walletsBySeedQuery.tryMutate(Mutators.mapData((d = new Data([])) => {
            if (previousData?.inner.uuid === currentData?.inner.uuid)
              return d
            if (previousData != null)
              d = d.mapSync(p => p.filter(x => x.uuid !== previousData.inner.uuid))
            if (currentData != null)
              d = d.mapSync(p => [...p, WalletRef.from(currentData.inner)])
            return d
          })).then(r => r.throw(t))
        }

        return Ok.void()
      })
    }

    return createQuery<Key, WalletData, never>({ key: key(uuid), storage, indexer })
  }

  export namespace All {

    export type Key = typeof key

    export const key = `wallets`

    export type Schema = ReturnType<typeof schema>

    export function schema(storage: IDBStorage) {
      return createQuery<Key, WalletRef[], never>({ key, storage })
    }

  }

}

export type EthereumQueryKey<T> = RpcRequestPreinit<T> & {
  version?: number
  chainId: number
}

export interface BgEthereumContext {
  chain: ChainData
  brume: EthBrume
}

export interface EthereumFetchParams {
  noCheck?: boolean
}

export async function tryEthereumFetch<T>(ethereum: BgEthereumContext, init: RpcRequestPreinit<unknown> & EthereumFetchParams, more: FetcherMore = {}) {
  return await Result.runAndDoubleWrap<Fetched<T, Error>>(async () => {
    const { signal: presignal } = more
    const { brume } = ethereum

    const pools = Option.wrap(brume[ethereum.chain.chainId]).ok().unwrap()

    async function runWithPoolOrThrow(index: number) {
      const pool = await pools.tryGet(index).then(r => r.unwrap().unwrap().inner)

      async function runWithConnOrThrow(index: number) {
        const conn = await pool.tryGet(index).then(r => r.unwrap().unwrap().inner)

        const { counter, connection } = conn
        const request = counter.prepare(init)

        if (connection.isURL()) {
          const { url, circuit } = connection
          const signal = AbortSignals.timeout(5_000, presignal)

          // console.debug(`Fetching ${init.method} from ${url.href} using ${circuit.id}`)
          const result = await TorRpc.tryFetchWithCircuit<T>(url, { ...request, circuit, signal })

          if (result.isErr())
            console.debug(`Could not fetch ${init.method} from ${url.href} using ${circuit.id}`, { result })

          return Fetched.rewrap(result.unwrap())
        }

        if (connection.isWebSocket()) {
          await connection.cooldown

          const { socket, circuit } = connection
          const signal = AbortSignals.timeout(5_000, presignal)

          // console.debug(`Fetching ${init.method} from ${socket.url} using ${circuit.id}`)
          const result = await TorRpc.tryFetchWithSocket<T>(socket, request, signal)

          if (result.isErr())
            console.debug(`Could not fetch ${init.method} from ${socket.url} using ${circuit.id}`, { result })

          return Fetched.rewrap(result.unwrap())
        }

        throw new Panic()
      }

      const promises = Array.from({ length: pool.capacity }, (_, i) => runWithConnOrThrow(i))

      const results = await Promise.allSettled(promises)

      const fetcheds = new Map<string, Fetched<T, Error>>()
      const counters = new Map<string, number>()

      for (const result of results) {
        if (result.status === "rejected")
          continue
        if (init?.noCheck && result.value.isOk())
          return result.value
        const raw = JSON.stringify(result.value.inner)
        const previous = Option.wrap(counters.get(raw)).unwrapOr(0)
        counters.set(raw, previous + 1)
        fetcheds.set(raw, result.value)
      }

      /**
       * One truth -> return it
       * Zero truth -> throw AggregateError
       */
      if (counters.size < 2)
        return await Promise.any(promises)

      console.warn(`Different results from multiple connections for ${init.method}`)

      /**
       * Sort truths by occurence
       */
      const sorteds = [...Maps.entries(counters)].sort((a, b) => b.value - a.value)

      /**
       * Two concurrent truths
       */
      if (sorteds[0].value === sorteds[1].value) {
        console.warn(`Could not choose truth for ${init.method}`)
        throw new Error(`Could not choose truth`)
      }

      return fetcheds.get(sorteds[0].key)!
    }

    const promises = Array.from({ length: pools.capacity }, (_, i) => runWithPoolOrThrow(i))

    const results = await Promise.allSettled(promises)

    const fetcheds = new Map<string, Fetched<T, Error>>()
    const counters = new Map<string, number>()

    for (const result of results) {
      if (result.status === "rejected")
        continue
      if (init?.noCheck && result.value.isOk())
        return result.value
      const raw = JSON.stringify(result.value.inner)
      const previous = Option.wrap(counters.get(raw)).unwrapOr(0)
      counters.set(raw, previous + 1)
      fetcheds.set(raw, result.value)
    }

    /**
     * One truth -> return it
     * Zero truth -> throw AggregateError
     */
    if (counters.size < 2)
      return await Promise.any(promises)

    console.warn(`Different results from multiple circuits for ${init.method}`)

    /**
     * Sort truths by occurence
     */
    const sorteds = [...Maps.entries(counters)].sort((a, b) => b.value - a.value)

    /**
     * Two concurrent truths
     */
    if (sorteds[0].value === sorteds[1].value) {
      console.warn(`Could not choose truth for ${init.method}`)
      throw new Error(`Could not choose truth`)
    }

    return fetcheds.get(sorteds[0].key)!
  }).then(r => r.inspectErrSync(e => console.error({ e })))
}

export function getTotalPricedBalance(coin: "usd", storage: IDBStorage) {
  return createQuery<string, FixedInit, Error>({
    key: `totalPricedBalance/${coin}`,
    storage
  })
}

export function getTotalPricedBalanceByWallet(coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<Record<string, FixedInit>, Error>) => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const values = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr({})
      const total = Object.values(values).reduce<Fixed>((x, y) => Fixed.from(y).add(x), new Fixed(0n, 0))

      const totalBalance = getTotalPricedBalance(coin, storage)
      await totalBalance.tryMutate(Mutators.data<FixedInit, Error>(total)).then(r => r.throw(t))

      return Ok.void()
    })
  }

  return createQuery<string, Record<string, FixedInit>, Error>({
    key: `totalPricedBalanceByWallet/${coin}`,
    indexer,
    storage
  })
}

export function getTotalWalletPricedBalance(account: string, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<FixedInit, Error>) => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const value = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr(new Fixed(0n, 0))

      const indexQuery = getTotalPricedBalanceByWallet(coin, storage)
      await indexQuery.tryMutate(Mutators.mapInnerData(p => ({ ...p, [account]: value }), new Data({}))).then(r => r.throw(t))

      return Ok.void()
    })
  }

  return createQuery<string, FixedInit, Error>({
    key: `totalWalletPricedBalance/${account}/${coin}`,
    indexer,
    storage
  })
}

export function getPricedBalanceByToken(account: string, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<Record<string, FixedInit>, Error>) => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const values = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr({})
      const total = Object.values(values).reduce<Fixed>((x, y) => Fixed.from(y).add(x), new Fixed(0n, 0))

      const totalBalance = getTotalWalletPricedBalance(account, coin, storage)
      await totalBalance.tryMutate(Mutators.data<FixedInit, Error>(total)).then(r => r.throw(t))

      return Ok.void()
    })
  }

  return createQuery<string, Record<string, FixedInit>, Error>({
    key: `pricedBalanceByToken/${account}/${coin}`,
    indexer,
    storage
  })
}

export function getPricedBalance(ethereum: BgEthereumContext, account: string, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<FixedInit, Error>) => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const key = `${ethereum.chain.chainId}`
      const value = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr(new Fixed(0n, 0))

      const indexQuery = getPricedBalanceByToken(account, coin, storage)
      await indexQuery.tryMutate(Mutators.mapInnerData(p => ({ ...p, [key]: value }), new Data({}))).then(r => r.throw(t))

      return Ok.void()
    })
  }

  return createQuery<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      chainId: ethereum.chain.chainId,
      method: "eth_getPricedBalance",
      params: [account, coin]
    },
    indexer,
    storage
  })
}

export namespace BgPair {

  export namespace Price {

    export const method = "eth_getPairPrice"

    export function key(ethereum: BgEthereumContext, pair: PairInfo) {
      return {
        chainId: ethereum.chain.chainId,
        method: "eth_getPairPrice",
        params: [pair.address]
      }
    }

    export async function tryParse(ethereum: BgEthereumContext, request: RpcRequestPreinit<unknown>, storage: IDBStorage) {
      return await Result.unthrow<Result<SimpleQuery<EthereumQueryKey<unknown>, FixedInit, Error>, Error>>(async t => {
        const [address] = (request as RpcRequestPreinit<[ZeroHexString]>).params
        const pair = Option.wrap(pairByAddress[address]).ok().throw(t)
        const query = schema(ethereum, pair, storage)
        return new Ok(query)
      })
    }

    export function schema(ethereum: BgEthereumContext, pair: PairInfo, storage: IDBStorage) {
      const fetcher = () => Result.unthrow<Result<Fetched<FixedInit, Error>, Error>>(async t => {
        const data = Cubane.Abi.tryEncode(PairAbi.getReserves.args.from()).throw(t)

        const fetched = await tryEthereumFetch<ZeroHexString>(ethereum, {
          method: "eth_call",
          params: [{
            to: pair.address,
            data: data
          }, "pending"]
        }, {}).then(r => r.throw(t))

        if (fetched.isErr())
          return new Ok(new Fail(fetched.inner))

        const returns = Cubane.Abi.createDynamicTuple(Cubane.Abi.Uint256, Cubane.Abi.Uint256)
        const [a, b] = Cubane.Abi.tryDecode(returns, fetched.inner).throw(t).inner

        const price = compute(pair, [a.value, b.value])

        return new Ok(new Data(price))
      })

      return createQuery<EthereumQueryKey<unknown>, FixedInit, Error>({
        key: key(ethereum, pair),
        fetcher,
        storage
      })
    }

    export function compute(pair: PairInfo, reserves: [bigint, bigint]) {
      const decimals0 = tokenByAddress[pair.token0].decimals
      const decimals1 = tokenByAddress[pair.token1].decimals

      const [reserve0, reserve1] = reserves

      const quantity0 = new Fixed(reserve0, decimals0)
      const quantity1 = new Fixed(reserve1, decimals1)

      if (pair.reversed)
        return quantity0.div(quantity1)
      return quantity1.div(quantity0)
    }

  }

}

export function getTokenPricedBalance(ethereum: BgEthereumContext, account: string, token: ContractTokenData, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<FixedInit, Error>) => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const key = `${ethereum.chain.chainId}/${token.address}`
      const value = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr(new Fixed(0n, 0))

      const indexQuery = getPricedBalanceByToken(account, coin, storage)
      await indexQuery.tryMutate(Mutators.mapInnerData(p => ({ ...p, [key]: value }), new Data({}))).then(r => r.throw(t))

      return Ok.void()
    })
  }

  return createQuery<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      chainId: ethereum.chain.chainId,
      method: "eth_getTokenPricedBalance",
      params: [account, token.address, coin]
    },
    indexer,
    storage
  })
}

export function getTokenBalance(ethereum: BgEthereumContext, account: ZeroHexString, token: ContractTokenData, block: string, storage: IDBStorage) {
  const fetcher = () => Result.unthrow<Result<Fetched<FixedInit, Error>, Error>>(async t => {
    const data = Cubane.Abi.tryEncode(TokenAbi.balanceOf.args.from(account)).throw(t)

    const fetched = await tryEthereumFetch<ZeroHexString>(ethereum, {
      method: "eth_call",
      params: [{
        to: token.address,
        data: data
      }, "pending"]
    }, {}).then(r => r.throw(t))

    if (fetched.isErr())
      return new Ok(fetched)

    const returns = Cubane.Abi.createDynamicTuple(Cubane.Abi.Uint256)
    const [balance] = Cubane.Abi.tryDecode(returns, fetched.inner).throw(t).inner
    const fixed = new Fixed(balance.value, token.decimals)

    return new Ok(new Data(fixed))
  })

  const indexer = async (states: States<FixedInit, Error>) => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      if (block !== "pending")
        return Ok.void()

      const pricedBalance = await Option.wrap(states.current.real?.data?.get()).andThen(async balance => {
        if (token.pairs == null)
          return new None()

        let pricedBalance: Fixed = Fixed.from(balance)

        for (const pairAddress of token.pairs) {
          const pair = pairByAddress[pairAddress]
          const chain = chainByChainId[pair.chainId]

          const price = BgPair.Price.schema({ ...ethereum, chain }, pair, storage)
          const priceState = await price.state

          if (priceState.isErr())
            return new None()
          if (priceState.inner.data == null)
            return new None()

          pricedBalance = pricedBalance.mul(Fixed.from(priceState.inner.data.inner))
        }

        return new Some(pricedBalance)
      }).then(o => o.unwrapOr(new Fixed(0n, 0)))

      const pricedBalanceQuery = getTokenPricedBalance(ethereum, account, token, "usd", storage)
      await pricedBalanceQuery.tryMutate(Mutators.set<FixedInit, Error>(new Data(pricedBalance))).then(r => r.throw(t))

      return Ok.void()
    })
  }

  return createQuery<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      chainId: ethereum.chain.chainId,
      method: "eth_getTokenBalance",
      params: [account, token.address, block]
    },
    fetcher,
    indexer,
    storage
  })
}

export namespace BgEns {

  export namespace Resolver {

    export async function tryFetch(ethereum: BgEthereumContext, namehash: Bytes<32>): Promise<Result<Fetched<ZeroHexString, Error>, Error>> {
      return await Result.unthrow(async t => {
        const registry = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"

        const data = Cubane.Abi.tryEncode(EnsAbi.resolver.args.from(namehash)).throw(t)

        const fetched = await tryEthereumFetch<ZeroHexString>(ethereum, {
          method: "eth_call",
          params: [{
            to: registry,
            data: data
          }, "pending"]
        }, {}).then(r => r.throw(t))

        if (fetched.isErr())
          return new Ok(fetched)

        const returns = Cubane.Abi.createDynamicTuple(Cubane.Abi.StaticAddress)
        const [address] = Cubane.Abi.tryDecode(returns, fetched.inner).throw(t).inner

        return new Ok(new Data(address.value))
      })
    }


  }

  export namespace Lookup {

    export const method = "ens_lookup"

    export function key(name: string) {
      return {
        chainId: 1,
        method: method,
        params: [name]
      }
    }

    export async function tryParse(ethereum: BgEthereumContext, request: RpcRequestPreinit<unknown>, storage: IDBStorage) {
      const [name] = (request as RpcRequestPreinit<[string]>).params
      const query = schema(ethereum, name, storage)
      return new Ok(query)
    }

    export function schema(ethereum: BgEthereumContext, name: string, storage: IDBStorage) {
      const fetcher = () => tryFetch(ethereum, name)

      return createQuery<EthereumQueryKey<unknown>, ZeroHexString, Error>({
        key: key(name),
        fetcher,
        storage
      })
    }

    export async function tryFetch(ethereum: BgEthereumContext, name: string) {
      return await Result.unthrow<Result<Fetched<ZeroHexString, Error>, Error>>(async t => {
        const namehash = Cubane.Ens.tryNamehash(name).throw(t) as Bytes<32>
        const resolver = await Resolver.tryFetch(ethereum, namehash).then(r => r.throw(t))

        if (resolver.isErr())
          return new Ok(resolver)

        const data = Cubane.Abi.tryEncode(EnsAbi.addr.args.from(namehash)).throw(t)

        const fetched = await tryEthereumFetch<ZeroHexString>(ethereum, {
          method: "eth_call",
          params: [{
            to: resolver.inner,
            data: data
          }, "pending"]
        }, {}).then(r => r.throw(t))

        if (fetched.isErr())
          return new Ok(fetched)

        const returns = Cubane.Abi.createDynamicTuple(Cubane.Abi.StaticAddress)
        const [address] = Cubane.Abi.tryDecode(returns, fetched.inner).throw(t).inner

        return new Ok(new Data(address.value))
      })
    }

  }

  export namespace Reverse {

    export const method = "ens_reverse"

    export function key(address: ZeroHexString) {
      return {
        chainId: 1,
        method: method,
        params: [address]
      }
    }

    export async function tryParse(ethereum: BgEthereumContext, request: RpcRequestPreinit<unknown>, storage: IDBStorage) {
      const [address] = (request as RpcRequestPreinit<[ZeroHexString]>).params
      const query = schema(ethereum, address, storage)
      return new Ok(query)
    }

    export function schema(ethereum: BgEthereumContext, address: ZeroHexString, storage: IDBStorage) {
      const fetcher = () => tryFetch(ethereum, address)

      return createQuery<EthereumQueryKey<unknown>, Nullable<string>, Error>({
        key: key(address),
        fetcher,
        storage
      })
    }

    export async function tryFetchUnchecked(ethereum: BgEthereumContext, address: ZeroHexString): Promise<Result<Fetched<Nullable<string>, Error>, Error>> {
      return await Result.unthrow(async t => {
        const namehash = Cubane.Ens.tryNamehash(`${address.slice(2)}.addr.reverse`).throw(t) as Bytes<32>
        const resolver = await Resolver.tryFetch(ethereum, namehash).then(r => r.throw(t))

        if (resolver.isErr())
          return new Ok(resolver)

        const data = Cubane.Abi.tryEncode(EnsAbi.name.args.from(namehash)).throw(t)

        const fetched = await tryEthereumFetch<ZeroHexString>(ethereum, {
          method: "eth_call",
          params: [{
            to: resolver.inner,
            data: data
          }, "pending"]
        }, {}).then(r => r.throw(t))

        if (fetched.isErr())
          return new Ok(fetched)

        const returns = Cubane.Abi.createDynamicTuple(Cubane.Abi.DynamicString)
        const [name] = Cubane.Abi.tryDecode(returns, fetched.inner).throw(t).inner

        if (name.value.length === 0)
          return new Ok(new Data(undefined))

        return new Ok(new Data(name.value))
      })
    }

    export async function tryFetch(ethereum: BgEthereumContext, address: ZeroHexString) {
      return await Result.unthrow<Result<Fetched<Nullable<string>, Error>, Error>>(async t => {
        const name = await tryFetchUnchecked(ethereum, address).then(r => r.throw(t))

        if (name.isErr())
          return new Ok(name)

        if (name.inner == null)
          return new Ok(name)

        const address2 = await Lookup.tryFetch(ethereum, name.inner).then(r => r.throw(t))

        if (address2.isErr())
          return new Ok(address2)

        if (address.toLowerCase() !== address2.inner.toLowerCase())
          return new Ok(new Data(undefined))

        return new Ok(name)
      })
    }

  }

}