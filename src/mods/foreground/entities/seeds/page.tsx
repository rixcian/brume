/* eslint-disable @next/next/no-img-element */
import { useBooleanHandle } from "@/libs/react/handles/boolean";
import { UUIDProps } from "@/libs/react/props/uuid";
import { Dialog } from "@/libs/ui/dialog/dialog";
import { Wallet } from "@/mods/background/service_worker/entities/wallets/data";
import { useCallback } from "react";
import { PageBody, PageHeader } from "../../components/page/header";
import { Page } from "../../components/page/page";
import { Path } from "../../router/path/context";
import { SeededWalletCreatorDialog } from "../wallets/all/create/seeded";
import { ClickableWalletGrid } from "../wallets/all/page";
import { useWalletsBySeed } from "./all/data";
import { SeedDataCard } from "./card";
import { SeedDataProvider, useSeedDataContext, } from "./context";

export function SeedPage(props: UUIDProps) {
  const { uuid } = props

  return <SeedDataProvider uuid={uuid}>
    <SeedDataPage />
  </SeedDataProvider>
}

function SeedDataPage() {
  const seed = useSeedDataContext()

  const walletsQuery = useWalletsBySeed(seed.uuid)
  const maybeWallets = walletsQuery.data?.inner

  const creator = useBooleanHandle(false)

  const onBackClick = useCallback(() => {
    Path.go("/seeds")
  }, [])

  const onWalletClick = useCallback((wallet: Wallet) => {
    Path.go(`/wallet/${wallet.uuid}`)
  }, [])

  const Header =
    <PageHeader
      title="Seed"
      back={onBackClick} />

  const Card =
    <div className="p-4 flex justify-center">
      <div className="w-full max-w-sm">
        <SeedDataCard />
      </div>
    </div>

  const Body =
    <PageBody>
      <ClickableWalletGrid
        ok={onWalletClick}
        create={creator.enable}
        wallets={maybeWallets} />
    </PageBody>

  return <Page>
    <Dialog
      opened={creator.current}
      close={creator.disable}>
      <SeededWalletCreatorDialog />
    </Dialog>
    {Header}
    {Card}
    {Body}
  </Page>
}
