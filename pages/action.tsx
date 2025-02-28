import { BackgroundGuard, useBackgroundContext } from "@/mods/foreground/background/context";
import { UserGuard } from "@/mods/foreground/entities/users/context";
import { Bottom } from "@/mods/foreground/overlay/bottom";
import { NavBar } from "@/mods/foreground/overlay/navbar";
import { Overlay } from "@/mods/foreground/overlay/overlay";
import { Router } from "@/mods/foreground/router/router";
import { useEffect } from "react";

export default function Action() {
  const background = useBackgroundContext().unwrap()

  useEffect(() => {
    /**
     * Chromium
     */
    document.documentElement.className = "h-[600px] w-[400px]"
    /**
     * Firefox
     */
    document.body.className = "h-[600px] w-[400px]"
  }, [])

  useEffect(() => {
    background
      .tryRequest<string>({ method: "brume_getPath" })
      .then(r => r.unwrap().unwrap())
      .then(p => location.hash = p)

    const onHashChange = () => background.tryRequest<void>({
      method: "brume_setPath",
      params: [location.hash]
    }).then(r => r.unwrap().unwrap())

    addEventListener("hashchange", onHashChange, { passive: true })
    return () => removeEventListener("hashchange", onHashChange)
  }, [background])

  return <main id="main" className="grow w-full flex flex-col overflow-hidden">
    <NavBar />
    <Overlay>
      <BackgroundGuard>
        <UserGuard>
          <div className="grow w-full flex flex-col overflow-y-scroll">
            <div className="grow w-full m-auto max-w-3xl flex flex-col">
              <Router />
            </div>
          </div>
          <Bottom />
        </UserGuard>
      </BackgroundGuard>
    </Overlay>
  </main>
}