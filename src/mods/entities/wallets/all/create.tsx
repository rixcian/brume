import { Bitcoin } from "@/libs/bitcoin/bitcoin";
import { Ethereum } from "@/libs/ethereum/ethereum";
import { Outline } from "@/libs/icons/icons";
import { Dialog, DialogTitle } from "@/libs/modals/dialog";
import { useModhash } from "@/libs/modhash/modhash";
import { useAsyncUniqueCallback } from "@/libs/react/callback";
import { useInputChange, useTextAreaChange } from "@/libs/react/events";
import { CloseProps } from "@/libs/react/props/close";
import { Mutator } from "@/libs/xswr/pipes";
import { GradientButton } from "@/mods/components/buttons/button";
import { Bytes } from "@hazae41/bytes";
import { secp256k1 } from "@noble/curves/secp256k1";
import { Wallet } from "ethers";
import { useEffect, useMemo, useState } from "react";
import { WalletAvatar } from "../avatar";
import { WalletData } from "../data";
import { useWallets } from "./data";

async function generateWallet() {
  await new Promise(ok => setTimeout(ok, 0)) // force async
  return Wallet.createRandom().privateKey
}

async function importWallet(privateKey: string) {
  await new Promise(ok => setTimeout(ok, 0)) // force async
  return new Wallet(privateKey)
}

export function WalletCreatorDialog(props: CloseProps) {
  const { close } = props
  const { mutate } = useWallets()

  const uuid = useMemo(() => {
    return crypto.randomUUID()
  }, [])

  const modhash = useModhash(uuid)

  const [name = "", setName] = useState<string>()

  const onNameChange = useInputChange(e => {
    setName(e.currentTarget.value)
  }, [])

  const [key = "", setKey] = useState<string>()

  const onKeyChange = useTextAreaChange(e => {
    setKey(e.currentTarget.value)
  }, [])

  useEffect(() => {
    generateWallet().then(setKey)
  }, [])

  const [wallet, setWallet] = useState<Wallet>()

  useEffect(() => {
    importWallet(key)
      .catch(() => undefined)
      .then(setWallet)
  }, [key])

  const onDoneClick = useAsyncUniqueCallback(async () => {
    if (!name || !wallet) return

    const privateKeyBytes = Bytes.fromHex(wallet.signingKey.privateKey.slice(2))

    const uncompressedPublicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false)
    const compressedPublicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true)

    const privateKey = `0x${Bytes.toHex(privateKeyBytes)}`
    const ethereumAddress = Ethereum.Address.from(uncompressedPublicKeyBytes)

    const uncompressedBitcoinAddress = await Bitcoin.Address.from(uncompressedPublicKeyBytes)
    const compressedBitcoinAddress = await Bitcoin.Address.from(compressedPublicKeyBytes)

    const walletd: WalletData = { type: "privateKey", uuid, name, modhash, privateKey, ethereumAddress, compressedBitcoinAddress, uncompressedBitcoinAddress }
    mutate(Mutator.data((prev = []) => [...prev, walletd]))

    close()
  }, [uuid, name, modhash, wallet, mutate, close])

  const NameInput =
    <div className="flex items-center gap-2">
      <div className="shrink-0">
        <WalletAvatar className="icon-5xl text-2xl"
          modhash={modhash} />
      </div>
      <input className="p-xmd w-full rounded-xl outline-none bg-transparent border border-contrast focus:border-opposite"
        placeholder="Enter a name"
        value={name} onChange={onNameChange} />
    </div>

  const KeyInput =
    <textarea className="p-xmd w-full resize-none rounded-xl bg-transparent outline-none border border-contrast focus:border-opposite"
      placeholder="Enter your private key"
      value={key} onChange={onKeyChange}
      rows={4} />

  const Info =
    <div className="text-contrast text-sm">
      {`We have generated a new private key just for you. You can also enter your own private key to import an existing wallet.`}
    </div>

  const DoneButton =
    <GradientButton className="w-full"
      modhash={modhash}
      disabled={!name || !wallet}
      icon={Outline.PlusIcon}
      onClick={onDoneClick.run}>
      Add
    </GradientButton>

  return <Dialog close={close}>
    <DialogTitle close={close}>
      New wallet
    </DialogTitle>
    <div className="h-2" />
    {NameInput}
    <div className="h-2" />
    {KeyInput}
    <div className="h-2" />
    {Info}
    <div className="h-4" />
    {DoneButton}
  </Dialog>
}
