import {Button} from "@/libs/ui/button";
import {Dialog, useDialogContext} from "@/libs/ui/dialog/dialog";
import TrezorLogo from "@/libs/ui/logo/trezor";
import LedgerLogo from "@/libs/ui/logo/ledger";
import { useState } from "react";
import {Trezor} from "@/libs/trezor";

export function HardwareWalletCreatorDialog({}) {
  const { close } = useDialogContext().unwrap();
  const [error, setError] = useState<string | null>(null)

  const connectTrezor = async () => {
    const trezor = Trezor.getInstance()

    trezor.getEthereumPublicKeysToIndex(100)
      .then(publicKeys => {
        setError(null)
        console.log(publicKeys)
      })
      .catch((err: Error) => setError(err.message))
  }

  return <>
    <Dialog.Title close={close}>
      Connect a hardware wallet
    </Dialog.Title>
    <div className="h-2" />
    <div className="w-full flex items-center gap-2">
      <Button.Contrast className="flex-1 whitespace-nowrap p-4 rounded-xl" onClick={connectTrezor}>
        <div className={`${Button.Shrinker.className} flex-col`}>
          <TrezorLogo className="w-24 h-24" />
        </div>
      </Button.Contrast>
      <Button.Contrast className="flex-1 whitespace-nowrap p-4 rounded-xl" disabled>
        <div className={`${Button.Shrinker.className} flex-col`}>
          <LedgerLogo className="w-24 h-24" />
        </div>
      </Button.Contrast>
    </div>
    {error && <div className="text-red-500 text-sm text-center mt-4">{error}</div>}
  </>
}