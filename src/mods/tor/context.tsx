import { useAsyncMemo } from "@/libs/react/memo";
import { ChildrenProps } from "@/libs/react/props/children";
import { Berith } from "@hazae41/berith";
import { createWebSocketSnowflakeStream, TorClientDuplex } from "@hazae41/echalote";
import { Ed25519 } from "@hazae41/ed25519";
import { Morax } from "@hazae41/morax";
import { Sha1 } from "@hazae41/sha1";
import { X25519 } from "@hazae41/x25519";
import { createContext, useContext } from "react";

export const TorContext =
  createContext<TorClientDuplex | undefined>(undefined)

export function useTor() {
  return useContext(TorContext)
}

export function TorProvider(props: ChildrenProps) {
  const { children } = props

  const tor = useAsyncMemo(async () => {
    await Berith.initBundledOnce()
    await Morax.initBundledOnce()

    const ed25519 = Ed25519.fromBerith(Berith)
    const x25519 = X25519.fromBerith(Berith)
    const sha1 = Sha1.fromMorax(Morax)

    const fallbacksRes = await fetch("https://raw.githubusercontent.com/hazae41/echalote/master/tools/fallbacks/fallbacks.json")
    if (!fallbacksRes.ok) throw new Error(await fallbacksRes.text())
    const fallbacks = await fallbacksRes.json()

    const tcp = await createWebSocketSnowflakeStream("wss://snowflake.bamsoftware.com/")

    return new TorClientDuplex(tcp, { fallbacks, ed25519, x25519, sha1 })
  }, [])

  return <TorContext.Provider value={tor}>
    {children}
  </TorContext.Provider>
}