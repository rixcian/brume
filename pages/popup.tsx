import { BigIntToHex, BigInts } from "@/libs/bigints/bigints";
import { UIError } from "@/libs/errors/errors";
import { chainByChainId } from "@/libs/ethereum/mods/chain";
import { Outline } from "@/libs/icons/icons";
import { useAsyncUniqueCallback } from "@/libs/react/callback";
import { useInputChange } from "@/libs/react/events";
import { useBooleanHandle } from "@/libs/react/handles/boolean";
import { useAsyncReplaceMemo } from "@/libs/react/memo";
import { Results } from "@/libs/results/results";
import { Button } from "@/libs/ui/button";
import { Dialog } from "@/libs/ui/dialog/dialog";
import { Wallet } from "@/mods/background/service_worker/entities/wallets/data";
import { BackgroundGuard, useBackgroundContext } from "@/mods/foreground/background/context";
import { PageBody, PageHeader } from "@/mods/foreground/components/page/header";
import { Page } from "@/mods/foreground/components/page/page";
import { useAppRequests } from "@/mods/foreground/entities/requests/all/data";
import { useAppRequest } from "@/mods/foreground/entities/requests/data";
import { useSession } from "@/mods/foreground/entities/sessions/data";
import { useSignature } from "@/mods/foreground/entities/signatures/data";
import { UserGuard } from "@/mods/foreground/entities/users/context";
import { WalletCreatorDialog } from "@/mods/foreground/entities/wallets/all/create";
import { useWallets } from "@/mods/foreground/entities/wallets/all/data";
import { SelectableWalletGrid } from "@/mods/foreground/entities/wallets/all/page";
import { EthereumWalletInstance, useEthereumContext, useGasPrice, useNonce, useWallet } from "@/mods/foreground/entities/wallets/data";
import { UserRejectedError } from "@/mods/foreground/errors/errors";
import { Bottom } from "@/mods/foreground/overlay/bottom";
import { NavBar } from "@/mods/foreground/overlay/navbar";
import { Overlay } from "@/mods/foreground/overlay/overlay";
import { Path, usePathContext } from "@/mods/foreground/router/path/context";
import { Router } from "@/mods/foreground/router/router";
import { Base16 } from "@hazae41/base16";
import { Bytes } from "@hazae41/bytes";
import { Abi, Cubane, ZeroHexString } from "@hazae41/cubane";
import { RpcErr, RpcOk } from "@hazae41/jsonrpc";
import { Nullable, Option } from "@hazae41/option";
import { Err, Ok, Result } from "@hazae41/result";
import { Transaction } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function Popup() {
  return <main id="main" className="p-safe grow w-full flex flex-col overflow-hidden">
    <NavBar />
    <Overlay>
      <BackgroundGuard>
        <UserGuard>
          <Ready />
        </UserGuard>
      </BackgroundGuard>
    </Overlay>
  </main>
}

export function Ready() {
  const background = useBackgroundContext().unwrap()

  useEffect(() => {
    background
      .tryRequest<void>({ method: "popup_hello" })
      .then(r => r.unwrap().unwrap())
  }, [background])

  return <>
    <div className="grow w-full flex flex-col overflow-y-scroll">
      <div className="grow w-full m-auto max-w-3xl flex flex-col">
        <Router />
      </div>
    </div>
    <Bottom />
  </>
}

export function TransactPage() {
  const { searchParams } = usePathContext().unwrap()
  const background = useBackgroundContext().unwrap()

  const id = Option.wrap(searchParams.get("id")).unwrap()
  const to = Option.wrap(searchParams.get("to")).unwrap()
  const gas = Option.wrap(searchParams.get("gas")).unwrap()
  const walletId = Option.wrap(searchParams.get("walletId")).unwrap()
  const chainId = Option.wrap(searchParams.get("chainId")).mapSync(Number).unwrap()

  const requestQuery = useAppRequest(id)
  const maybeRequest = requestQuery.data?.inner

  const sessionQuery = useSession(maybeRequest?.session)
  const maybeSession = sessionQuery.data?.inner

  const walletQuery = useWallet(walletId)
  const maybeWallet = walletQuery.data?.inner

  const chain = Option.wrap(chainByChainId[chainId]).unwrap()

  const value = searchParams.get("value")
  const maybeData = searchParams.get("data")

  const context = useEthereumContext(maybeSession?.wallets.at(0)?.uuid, chain)

  const gasPriceQuery = useGasPrice(context)
  const maybeGasPrice = gasPriceQuery.data?.inner

  const nonceQuery = useNonce(maybeWallet?.address, context)
  const maybeNonce = nonceQuery.data?.inner

  const maybeHash = Option.wrap(maybeData).mapSync(x => {
    return x.slice(0, 10) as ZeroHexString
  }).inner

  const signaturesQuery = useSignature(context, maybeHash)
  const maybeSignatures = signaturesQuery.data?.inner

  const maybeSignature = useAsyncReplaceMemo(async () => {
    if (maybeData == null)
      return
    if (maybeHash == null)
      return
    if (maybeSignatures == null)
      return

    const zeroHexData = ZeroHexString.from(maybeData)

    return maybeSignatures.items.map(({ text }) => {
      return Result.unthrowSync<Result<{ text: string, decoded: string }, Error>>(t => {
        const abi = Cubane.Abi.FunctionSignature.tryParse(text).throw(t)
        const { args } = Cubane.Abi.tryDecode(abi.args, zeroHexData).throw(t)

        function stringify(x: any): string {
          if (typeof x === "string")
            return x
          if (typeof x === "boolean")
            return String(x)
          if (typeof x === "number")
            return String(x)
          if (typeof x === "bigint")
            return String(x)
          if (x instanceof Uint8Array)
            return ZeroHexString.from(Base16.get().tryEncode(x).throw(t))
          if (Array.isArray(x))
            return `(${x.map(stringify).join(", ")})`
          return "unknown"
        }

        const decoded = args.into().map(stringify).join(", ")

        return new Ok({ text, decoded })
      }).inspectErrSync(e => console.warn({ e })).unwrapOr(undefined)
    }).find(it => it != null)
  }, [maybeData, maybeHash, maybeSignatures])

  const onApprove = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const wallet = Option.wrap(maybeWallet).ok().throw(t)
      const gasPrice = Option.wrap(maybeGasPrice).ok().throw(t)
      const nonce = Option.wrap(maybeNonce).ok().throw(t)

      const tx = Result.runAndDoubleWrapSync(() => {
        return Transaction.from({
          data: maybeData,
          to: to,
          gasLimit: gas,
          chainId: chain.chainId,
          gasPrice: gasPrice,
          nonce: Number(nonce),
          value: value
        })
      }).throw(t)

      const instance = await EthereumWalletInstance.tryFrom(wallet, background).then(r => r.throw(t))
      tx.signature = await instance.trySignTransaction(tx, background).then(r => r.throw(t))

      await background.tryRequest({
        method: "brume_respond",
        params: [new RpcOk(id, tx.serialized)]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id, maybeWallet, maybeGasPrice, maybeNonce, chain])

  const onReject = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      await background.tryRequest({
        method: "brume_respond",
        params: [RpcErr.rewrap(id, new Err(new UserRejectedError()))]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id])

  const loading = useMemo(() => {
    if (onApprove.loading)
      return true
    if (gasPriceQuery.data == null)
      return true
    if (nonceQuery.data == null)
      return true
    return false
  }, [onApprove.loading, gasPriceQuery.data, nonceQuery.data])

  return <Page>
    <div className="p-4 grow flex flex-col items-center justify-center">
      <div className="text-center text-xl font-medium">
        Transaction
      </div>
      <div className="w-full max-w-[230px] text-center text-contrast">
        Do you want to approve this transaction?
      </div>
    </div>
    <div className="w-full p-4 grow flex flex-col">
      <div className="w-full p-4 border border-contrast rounded-xl whitespace-pre-wrap break-words">
        To: {to}
      </div>
      {value &&
        <div className="w-full p-4 border border-contrast rounded-xl whitespace-pre-wrap mt-2 break-words">
          Value: {BigIntToHex.tryDecode(value).mapSync(x => BigInts.float(x, 18)).ok().unwrapOr("Error")}
        </div>}
      {maybeSignature &&
        <div className="grow w-full p-4 border border-contrast rounded-xl whitespace-pre-wrap mt-2 break-words">
          Function: {maybeSignature.text}
        </div>}
      {(maybeSignature || maybeData) &&
        <div className="grow w-full p-4 border border-contrast rounded-xl whitespace-pre-wrap mt-2 break-words">
          Data: {maybeSignature?.decoded ?? maybeData}
        </div>}
    </div>
    <div className="p-4 w-full flex items-center gap-2">
      <Button.Contrast className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onReject.run}
        disabled={onReject.loading}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.XMarkIcon className="s-sm" />
          No, reject it
        </div>
      </Button.Contrast>
      <Button.Gradient className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onApprove.run}
        disabled={loading}
        colorIndex={5}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.CheckIcon className="s-sm" />
          Yes, approve it
        </div>
      </Button.Gradient>
    </div>
  </Page>
}

export function SwitchPage() {
  const { searchParams } = usePathContext().unwrap()
  const background = useBackgroundContext().unwrap()

  const id = Option.wrap(searchParams.get("id")).unwrap()

  const onApprove = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      await background.tryRequest({
        method: "brume_respond",
        params: [new RpcOk(id, undefined)]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id])

  const onReject = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      await background.tryRequest({
        method: "brume_respond",
        params: [RpcErr.rewrap(id, new Err(new UserRejectedError()))]
      }).then(r => r.throw(t).throw(t))

      await new Promise(ok => setTimeout(ok, 250))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id])

  return <Page>
    <div className="p-4 grow flex flex-col items-center justify-center">
      <div className="text-center text-xl font-medium">
        Switch chain
      </div>
      <div className="w-full max-w-[230px] text-center text-contrast">
        Do you want to switch the Ethereum chain?
      </div>
    </div>
    <div className="p-4 w-full flex items-center gap-2">
      <Button.Contrast className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onReject.run}
        disabled={onReject.loading}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.XMarkIcon className="s-sm" />
          No, reject it
        </div>
      </Button.Contrast>
      <Button.Gradient className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onApprove.run}
        disabled={onApprove.loading}
        colorIndex={5}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.CheckIcon className="s-sm" />
          Yes, approve it
        </div>
      </Button.Gradient>
    </div>
  </Page>
}

export function PersonalSignPage() {
  const { searchParams } = usePathContext().unwrap()
  const background = useBackgroundContext().unwrap()

  const id = Option.wrap(searchParams.get("id")).unwrap()
  const message = Option.wrap(searchParams.get("message")).unwrap()
  const walletId = Option.wrap(searchParams.get("walletId")).unwrap()

  const walletQuery = useWallet(walletId)
  const maybeWallet = walletQuery.data?.inner

  const userMessage = useMemo(() => {
    return message.startsWith("0x")
      ? Bytes.toUtf8(Base16.get().tryPadStartAndDecode(message.slice(2)).unwrap().copyAndDispose())
      : message
  }, [message])

  const onApprove = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const wallet = Option.wrap(maybeWallet).ok().throw(t)

      const instance = await EthereumWalletInstance.tryFrom(wallet, background).then(r => r.throw(t))
      const signature = await instance.trySignPersonalMessage(userMessage, background).then(r => r.throw(t))

      await background.tryRequest({
        method: "brume_respond",
        params: [new RpcOk(id, signature)]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id, maybeWallet, userMessage])

  const onReject = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      await background.tryRequest({
        method: "brume_respond",
        params: [RpcErr.rewrap(id, new Err(new UserRejectedError()))]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id])

  return <Page>
    <div className="p-4 grow flex flex-col items-center justify-center">
      <div className="text-center text-xl font-medium">
        Sign message
      </div>
      <div className="w-full max-w-[230px] text-center text-contrast">
        Do you want to sign the following message?
      </div>
    </div>
    <div className="w-full p-4 grow">
      <div className="h-full w-full p-4 border border-contrast rounded-xl whitespace-pre-wrap break-words">
        {userMessage}
      </div>
    </div>
    <div className="p-4 w-full flex items-center gap-2">
      <Button.Contrast className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onReject.run}
        disabled={onReject.loading}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.XMarkIcon className="s-sm" />
          No, reject it
        </div>
      </Button.Contrast>
      <Button.Gradient className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onApprove.run}
        disabled={onApprove.loading}
        colorIndex={5}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.CheckIcon className="s-sm" />
          Yes, approve it
        </div>
      </Button.Gradient>
    </div>
  </Page>
}

export function TypedSignPage() {
  const { searchParams } = usePathContext().unwrap()
  const background = useBackgroundContext().unwrap()

  const id = Option.wrap(searchParams.get("id")).unwrap()
  const data = Option.wrap(searchParams.get("data")).unwrap()
  const walletId = Option.wrap(searchParams.get("walletId")).unwrap()

  const walletQuery = useWallet(walletId)
  const maybeWallet = walletQuery.data?.inner

  const onApprove = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      const wallet = Option.wrap(maybeWallet).ok().throw(t)

      const typed = JSON.parse(data) as Abi.Typed.TypedData

      const instance = await EthereumWalletInstance.tryFrom(wallet, background).then(r => r.throw(t))
      const signature = await instance.trySignEIP712HashedMessage(typed, background).then(r => r.throw(t))

      await background.tryRequest({
        method: "brume_respond",
        params: [new RpcOk(id, signature)]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id, maybeWallet, data])

  const onReject = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      await background.tryRequest({
        method: "brume_respond",
        params: [RpcErr.rewrap(id, new Err(new UserRejectedError()))]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id])

  return <Page>
    <div className="p-4 grow flex flex-col items-center justify-center">
      <div className="text-center text-xl font-medium">
        Sign message
      </div>
      <div className="w-full max-w-[230px] text-center text-contrast">
        Do you want to sign the following message?
      </div>
    </div>
    <div className="w-full p-4 grow">
      <div className="h-full w-full p-4 border border-contrast rounded-xl whitespace-pre-wrap break-words">
        {JSON.stringify(JSON.parse(data))}
      </div>
    </div>
    <div className="p-4 w-full flex items-center gap-2">
      <Button.Contrast className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onReject.run}
        disabled={onReject.loading}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.XMarkIcon className="s-sm" />
          No, reject it
        </div>
      </Button.Contrast>
      <Button.Gradient className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onApprove.run}
        disabled={onApprove.loading}
        colorIndex={5}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.CheckIcon className="s-sm" />
          Yes, approve it
        </div>
      </Button.Gradient>
    </div>
  </Page>
}

export function WalletAndChainSelectPage() {
  const { searchParams } = usePathContext().unwrap()
  const background = useBackgroundContext().unwrap()

  const id = Option.wrap(searchParams.get("id")).unwrap()

  const wallets = useWallets()

  const creator = useBooleanHandle(false)

  const [persistent, setPersistent] = useState(true)

  const onPersistentChange = useInputChange(e => {
    setPersistent(e.currentTarget.checked)
  }, [])

  const [selecteds, setSelecteds] = useState<Nullable<Wallet>[]>([])
  const [chain, setChain] = useState<number>(1)

  const onWalletClick = useCallback((wallet: Wallet) => {
    const clone = new Set(selecteds)

    if (clone.has(wallet))
      clone.delete(wallet)
    else
      clone.add(wallet)

    setSelecteds([...clone])
  }, [selecteds])

  const onApprove = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      if (selecteds.length === 0)
        return new Err(new UIError(`No wallet selected`))

      await background.tryRequest({
        method: "brume_respond",
        params: [new RpcOk(id, [persistent, chain, selecteds])]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id, selecteds, chain, persistent])

  const onReject = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      await background.tryRequest({
        method: "brume_respond",
        params: [RpcErr.rewrap(id, new Err(new UserRejectedError()))]
      }).then(r => r.throw(t).throw(t))

      Path.go("/done")

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, id])

  const Body =
    <PageBody>
      <SelectableWalletGrid
        create={creator.enable}
        wallets={wallets.data?.inner}
        ok={onWalletClick}
        selecteds={selecteds} />
      <div className="h-4" />
      <label className="flex items-center justify-between">
        <div className="">
          Keep me connected
        </div>
        <input className=""
          type="checkbox"
          checked={persistent}
          onChange={onPersistentChange} />
      </label>
    </PageBody>

  const Header =
    <PageHeader title="Select wallets">
      <Button.Base className="s-xl hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={creator.enable}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.PlusIcon className="s-sm" />
        </div>
      </Button.Base>
    </PageHeader>

  return <Page>
    <Dialog
      opened={creator.current}
      close={creator.disable}>
      <WalletCreatorDialog />
    </Dialog>
    {Header}
    {Body}
    <div className="p-4 w-full flex items-center gap-2">
      <Button.Contrast className="grow po-md hovered-or-clicked-or-focused:scale-105 !transition"
        onClick={onReject.run}
        disabled={onReject.loading}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.XMarkIcon className="s-sm" />
          No, reject it
        </div>
      </Button.Contrast>
      <button className={`${Button.Base.className} ${Button.Gradient.className(5)} grow po-md hovered-or-clicked-or-focused:scale-105 !transition`}
        onClick={onApprove.run}
        disabled={onApprove.loading}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.CheckIcon className="s-sm" />
          Yes, approve it
        </div>
      </button>
    </div>
  </Page>
}

export function DonePage() {
  const requests = useAppRequests().data?.inner

  useEffect(() => {
    if (!requests?.length)
      return
    Path.go("/requests")
  }, [requests])

  return <Page>
    <div className="p-4 grow flex flex-col items-center justify-center">
      <div className="text-center text-xl font-medium">
        Done
      </div>
      <div className="w-full max-w-[230px] text-center text-contrast">
        You can now close this window or continue using it
      </div>
    </div>
  </Page>
}