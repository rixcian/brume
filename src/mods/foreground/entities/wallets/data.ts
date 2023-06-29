import { BigInts, Fixed, FixedInit } from "@/libs/bigints/bigints"
import { EthereumChain, PairInfo } from "@/libs/ethereum/chain"
import { useObjectMemo } from "@/libs/react/memo"
import { RpcRequestPreinit } from "@/libs/rpc"
import { EthereumQueryKey } from "@/mods/background/service_worker/entities/wallets/data"
import { Optional } from "@hazae41/option"
import { Result } from "@hazae41/result"
import { Core, Data, FetchError, Fetched, FetcherMore, Query, createQuerySchema, useCore, useError, useFallback, useFetch, useOnce, useQuery, useVisible } from "@hazae41/xswr"
import { ethers, Contract, ContractRunner, TransactionRequest } from "ethers"
import { useEffect } from "react"
import { Background } from "../../background/background"
import { useBackground } from "../../background/context"
import { useUserStorage } from "../../storage/context"
import { UserStorage } from "../../storage/storage"
import { useCurrentUser } from "../users/context"
import { User } from "../users/data"

export type Wallet =
  | WalletRef
  | WalletData

export interface WalletProps {
  wallet: Wallet
}

export interface WalletRef {
  ref: true
  uuid: string
}

export type WalletData =
  | EthereumPrivateKeyWallet

export interface EthereumPrivateKeyWallet {
  coin: "ethereum"
  type: "privateKey"

  uuid: string
  name: string,

  color: number,
  emoji: string

  privateKey: string
  address: string
}

export interface BitcoinPrivateKeyWallet {
  coin: "bitcoin"
  type: "privateKey"

  uuid: string
  name: string,

  color: number,
  emoji: string

  privateKey: string
  compressedAddress: string
  uncompressedAddress: string
}

export function getWallet(uuid: Optional<string>, background: Background) {
  if (uuid === undefined)
    return undefined

  const fetcher = async <T>(init: RpcRequestPreinit<unknown>, more: FetcherMore = {}) =>
    await background.tryRequest<T>(init).then(r => r.mapSync(x => Fetched.rewrap(x)).mapErrSync(FetchError.from))

  return createQuerySchema<RpcRequestPreinit<unknown>, WalletData, Error>({
    method: "brume_getWallet",
    params: [uuid]
  }, fetcher)
}

export function useWallet(uuid: Optional<string>, background: Background) {
  const query = useQuery(getWallet, [uuid, background])
  useOnce(query)
  return query
}

export interface EthereumContext {
  core: Core,
  user: User,
  background: Background
  wallet: Wallet,
  chain: EthereumChain,
}

export interface GeneralContext {
  core: Core,
  user: User,
  background: Background
}

export interface EthereumContextProps {
  handle: EthereumContext
}

export function useGeneralContext() {
  const core = useCore().unwrap()
  const user = useCurrentUser()
  const background = useBackground()
  return useObjectMemo({ core, user, background })
}

export function useEthereumContext(wallet: Wallet, chain: EthereumChain): EthereumContext {
  const core = useCore().unwrap()
  const user = useCurrentUser()
  const background = useBackground()
  return useObjectMemo({ core, user, background, wallet, chain })
}

export async function tryFetch<T>(request: RpcRequestPreinit<unknown>, ethereum: EthereumContext): Promise<Result<Fetched<T, Error>, FetchError>> {
  const { background, wallet, chain } = ethereum

  return await background.tryRequest<T>({
    method: "brume_call_ethereum",
    params: [wallet.uuid, chain.chainId, request]
  }).then(r => r.mapSync(x => Fetched.rewrap(x)).mapErrSync(FetchError.from))
}

export function useSubscribe<K, D, F>(query: Query<K, D, F>, storage: UserStorage) {
  const { cacheKey } = query

  useEffect(() => {
    if (cacheKey === undefined)
      return
    storage.trySubscribe(cacheKey).then(r => r.ignore())
  }, [cacheKey, storage])
}

export function getTotalPricedBalance(context: GeneralContext, coin: "usd", storage: UserStorage) {
  return createQuerySchema<string, FixedInit, Error>(`totalPricedBalance/${context.user.uuid}/${coin}`, undefined, { storage })
}

export function useTotalPricedBalance(coin: "usd") {
  const context = useGeneralContext()
  const storage = useUserStorage().unwrap()
  const query = useQuery(getTotalPricedBalance, [context, coin, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  useFallback(query, new Data(new Fixed(0n, 0)))
  return query
}

export function getTotalWalletPricedBalance(context: GeneralContext, address: string, coin: "usd", storage: UserStorage) {
  return createQuerySchema<string, FixedInit, Error>(`totalPricedBalance/${address}/${coin}`, undefined, { storage })
}

export function useTotalWalletPricedBalance(address: string, coin: "usd") {
  const context = useGeneralContext()
  const storage = useUserStorage().unwrap()
  const query = useQuery(getTotalWalletPricedBalance, [context, address, coin, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export function getPricedBalance(context: EthereumContext, address: string, coin: "usd", storage: UserStorage) {
  return createQuerySchema<string, FixedInit, Error>(`pricedBalance/${address}/${context.chain.chainId}/${coin}`, undefined, { storage })
}

export function usePricedBalance(context: EthereumContext, address: string, coin: "usd") {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getPricedBalance, [context, address, coin, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export function getPendingBalance(address: string, context: EthereumContext, storage: UserStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>, more: FetcherMore = {}) =>
    await tryFetch<FixedInit>(request, context)

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    version: 2,
    chainId: context.chain.chainId,
    method: "eth_getBalance",
    params: [address, "pending"]
  }, fetcher, { storage })
}

export function usePendingBalance(address: string, ethereum: EthereumContext, ...prices: Optional<Data<FixedInit>>[]) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getPendingBalance, [address, ethereum, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)

  useEffect(() => {
    query.fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...prices])

  return query
}

export function getNonceSchema(address: string, context: EthereumContext, storage: UserStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>, more: FetcherMore = {}) =>
    await tryFetch<string>(request, context).then(r => r.mapSync(r => r.mapSync(BigInt)))

  return createQuerySchema<EthereumQueryKey<unknown>, bigint, Error>({
    chainId: context.chain.chainId,
    method: "eth_getTransactionCount",
    params: [address, "pending"]
  }, fetcher, { storage, dataSerializer: BigInts })
}

export function useNonce(address: string, ethereum: EthereumContext) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getNonceSchema, [address, ethereum, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export function getGasPriceSchema(context: EthereumContext, storage: UserStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>) =>
    await tryFetch<string>(request, context).then(r => r.mapSync(r => r.mapSync(BigInt)))

  return createQuerySchema<EthereumQueryKey<unknown>, bigint, Error>({
    chainId: context.chain.chainId,
    method: "eth_gasPrice",
    params: []
  }, fetcher, { storage, dataSerializer: BigInts })
}

export function useGasPrice(ethereum: EthereumContext) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getGasPriceSchema, [ethereum, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export class BrumeProvider implements ContractRunner {
  provider = null

  constructor(
    readonly ethereum: EthereumContext
  ) { }

  async call(tx: TransactionRequest) {
    return await tryFetch<string>({
      method: "eth_call",
      params: [{
        to: tx.to,
        data: tx.data
      }, "pending"]
    }, this.ethereum).then(r => r.unwrap().unwrap())
  }

}

export function getPairPrice(context: EthereumContext, pair: PairInfo, storage: UserStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>, more: FetcherMore = {}) =>
    await tryFetch<FixedInit>(request, context)

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    method: "eth_getPairPrice",
    params: [pair.address]
  }, fetcher, { storage })
}

export function usePairPrice(ethereum: EthereumContext, pair: PairInfo) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getPairPrice, [ethereum, pair, storage])
  useOnce(query)
  useVisible(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export async function getEnsResolverAddress(name: string, ethereum: EthereumContext) {
  const provider = new BrumeProvider(ethereum)
  const namehash = ethers.namehash(name)

  const contract = new Contract(
      "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41",
      ["function addr(bytes32 node) public view returns (address payable)"],
      provider
  )

  const address: string | undefined = await contract.addr(namehash).then(a => a).catch(() => undefined)

  return address
}