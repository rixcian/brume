import { Radix } from "@/libs/hex/hex";
import { Outline } from "@/libs/icons/icons";
import { Dialog, DialogTitle } from "@/libs/modals/dialog";
import { ExternalDivisionLink } from "@/libs/next/anchor";
import { useAsyncUniqueCallback } from "@/libs/react/callback";
import { useInputChange } from "@/libs/react/events";
import { CloseProps } from "@/libs/react/props/close";
import { TitleProps } from "@/libs/react/props/title";
import { Err, Ok, Result } from "@hazae41/result";
import { ethers, isAddress } from "ethers";
import { useMemo, useState } from "react";
import { InnerButton } from "../../components/buttons/button";
import { GradientButton } from "../../components/buttons/gradient";
import { useWalletData } from "./context";
import { EthereumContextProps, getEnsResolverAddress, useGasPrice, useNonce, usePendingBalance } from "./data";
import { Input } from "@/mods/foreground/components/inputs/input";
import {Badge} from "@/mods/foreground/components/badges/badge";
import {useDisplay} from "@/mods/foreground/entities/wallets/page";

export function WalletDataSendDialog(props: TitleProps & CloseProps & EthereumContextProps) {
  const wallet = useWalletData()
  const { title, handle, close } = props

  const balance = usePendingBalance(wallet.address, handle)
  const balanceDisplay = useDisplay(balance.current)
  const nonce = useNonce(wallet.address, handle)
  const gasPrice = useGasPrice(handle)

  const [recipientAddress, setRecipientAddress] = useState<string>("")
  const [recipientInput , setRecipientInput] = useState<string>("")
  const [recipientStatus, setRecipientStatus] = useState<{ status: 'success' | 'error' | 'loading', message: string }>()

  const onRecipientInputChange = useInputChange(async (e) => {
    const addressOrName = e.currentTarget.value as string
    setRecipientInput(addressOrName)

    // If the input is empty, reset the status
    if (addressOrName.length === 0) {
      setRecipientStatus(undefined)
      return setRecipientAddress("")
    }

    // If the input is not an address, check if it's ENS
    if (!isAddress(addressOrName)) {
      // If the input is an ENS, check if it's valid
      if ((addressOrName as string).length >= 7 && (addressOrName as string).includes('.eth')) {
        // Set loading status
        setRecipientStatus({ status: "loading", message: "..." })

        const address = await getEnsResolverAddress(addressOrName, handle)

        // Get address from ENS, if the address is undefined, the ENS is invalid
        if (address) {
          setRecipientAddress(address)
          setRecipientStatus({ status: "success", message: "Valid ENS Name" })
          return setRecipientAddress(address)
        } else {
          setRecipientStatus({ status: "error", message: "Invalid ENS Name" })
          return setRecipientAddress("")
        }
      }

      return setRecipientStatus({ status: "error", message: "Invalid address" })
    }

    return setRecipientStatus({ status: "success", message: "Valid address" })
  }, [])

  const RecipientInput = <>
    <div className="">
      Recipient
    </div>
    <div className="h-2" />
    <Input
      className="w-full"
      placeholder="Address or ENS"
      value={recipientInput}
      onChange={onRecipientInputChange}
      status={recipientStatus && recipientStatus.status}
      statusMessage={recipientStatus && recipientStatus.message}
    />
  </>

  const [valueInput = "", setValueInput] = useState<string>()
  const [valueStatus, setValueStatus] = useState<{ status: 'success' | 'error', message?: string }>()

  const updateValueStatus = (value: string) => {
    // If the value is empty, reset the status
    if (value.length === 0) setValueStatus(undefined)

    const valueNumber = parseFloat(value)
    const balanceNumber = parseFloat(balanceDisplay)

    if (valueNumber > balanceNumber) return setValueStatus({ status: "error", message: "Insufficient balance" })
    if (valueNumber <= 0) return setValueStatus({ status: "error", message: "Invalid value" })
    return setValueStatus({ status: "success" })
  }

  const onValueInputChange = useInputChange(e => {
    const value = e.currentTarget.value
      .replaceAll(/[^\d.,]/g, "")
      .replaceAll(",", ".")

    setValueInput(value)

    updateValueStatus(value)
  }, [valueInput])

  const ValueInput = <>
    <div className="">
      Value (ETH)
    </div>
    <div className="h-2" />
    <Input
      className="w-full"
      placeholder="1.0"
      value={valueInput}
      onChange={onValueInputChange}
      status={valueStatus && valueStatus.status}
      statusMessage={valueStatus && valueStatus.message}
      rightSide={(
        <Badge
          status="default"
          onClick={() => {
            setValueInput(balanceDisplay)
            updateValueStatus(balanceDisplay)
          }}
          className="transition-all ease-in-out duration-300 underline border border-transparent hover:cursor-pointer hover:border hover:border-neutral-400"
        >
          Max
        </Badge>
      )}
    />
  </>

  const [error, setError] = useState<Error>()
  const [txHash, setTxHash] = useState<string>()

  const trySend = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      if (nonce.data === undefined)
        return new Err(new Error(`Invalid nonce`))
      if (gasPrice.data === undefined)
        return new Err(new Error(`Invalid gas price`))

      const gas = await handle.background.tryRequest<string>({
        method: "brume_call_ethereum",
        params: [handle.wallet.uuid, handle.chain.chainId, {
          method: "eth_estimateGas",
          params: [{
            chainId: Radix.toHex(handle.chain.chainId),
            from: wallet.address,
            to: ethers.getAddress(recipientInput),
            value: Radix.toHex(ethers.parseUnits(valueInput, 18)),
            nonce: Radix.toHex(nonce.data.inner),
            gasPrice: Radix.toHex(gasPrice.data.inner)
          }, "latest"]
        }]
      }).then(r => r.throw(t).throw(t))

      const txHash = await handle.background.tryRequest<string>({
        method: "brume_call_ethereum",
        params: [handle.wallet.uuid, handle.chain.chainId, {
          method: "eth_sendTransaction",
          params: [{
            chainId: Radix.toHex(handle.chain.chainId),
            from: wallet.address,
            to: ethers.getAddress(recipientAddress),
            value: Radix.toHex(ethers.parseUnits(valueInput, 18)),
            nonce: Radix.toHex(nonce.data.inner),
            gasPrice: Radix.toHex(gasPrice.data.inner),
            gas: gas
          }]
        }]
      }).then(r => r.throw(t).throw(t))

      setTxHash(txHash)
      setError(undefined)

      balance.refetch()
      nonce.refetch()

      return Ok.void()
    }).then(r => r.inspectErrSync(setError).ignore())
  }, [handle, wallet.address, nonce.data, gasPrice.data, recipientInput, valueInput])

  const TxHashDisplay = <>
    <div className="">
      Transaction hash
    </div>
    <div className="text-contrast truncate">
      {txHash}
    </div>
    <div className="h-2" />
    <ExternalDivisionLink className="w-full"
      href={`${handle.chain.etherscan}/tx/${txHash}`}
      target="_blank" rel="noreferrer">
      <GradientButton className="w-full"
        colorIndex={wallet.color}>
        <InnerButton icon={Outline.ArrowTopRightOnSquareIcon}>
          Etherscan
        </InnerButton>
      </GradientButton>
    </ExternalDivisionLink>
  </>

  const disabled = useMemo(() => {
    if (nonce.data === undefined)
      return true
    if (gasPrice.data === undefined)
      return true
    if (!recipientInput || recipientStatus?.status === "error")
      return true
    if (!valueInput || valueStatus?.status === "error")
      return true
    return false
  }, [nonce.data, gasPrice.data, recipientInput, valueInput, recipientStatus, valueStatus])

  const SendButton =
    <GradientButton className="w-full"
      colorIndex={wallet.color}
      disabled={trySend.loading || disabled}
      onClick={trySend.run}>
      <InnerButton icon={Outline.PaperAirplaneIcon}>
        {trySend.loading
          ? "Loading..."
          : "Send"}
      </InnerButton>
    </GradientButton>

  return <Dialog close={close}>
    <DialogTitle close={close}>
      Send {title}
    </DialogTitle>
    <div className="h-2" />
    {RecipientInput}
    <div className="h-2" />
    {ValueInput}
    <div className="h-4" />
    {error && <>
      <div className="text-red-500">
        {error.message}
      </div>
      <div className="h-2" />
    </>}
    {txHash ? <>
      {TxHashDisplay}
    </> : <>
      {SendButton}
    </>}
  </Dialog>
}