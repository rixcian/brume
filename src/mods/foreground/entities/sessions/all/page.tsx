/* eslint-disable @next/next/no-img-element */
import { Outline } from "@/libs/icons/icons"
import { useAsyncUniqueCallback } from "@/libs/react/callback"
import { OkProps } from "@/libs/react/props/promise"
import { Results } from "@/libs/results/results"
import { Button } from "@/libs/ui/button"
import { ImageWithFallback } from "@/libs/ui/image/image_with_fallback"
import { BlobbyData } from "@/mods/background/service_worker/entities/blobbys/data"
import { Session } from "@/mods/background/service_worker/entities/sessions/data"
import { useBackgroundContext } from "@/mods/foreground/background/context"
import { PageBody, PageHeader } from "@/mods/foreground/components/page/header"
import { Page } from "@/mods/foreground/components/page/page"
import { Nullable, Option } from "@hazae41/option"
import { Ok, Result } from "@hazae41/result"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useBlobby } from "../../blobbys/data"
import { useOrigin } from "../../origins/data"
import { useSession } from "../data"
import { useStatus } from "../status/data"
import { usePersistentSessions, useTemporarySessions } from "./data"

export function SessionsPage() {
  const background = useBackgroundContext().unwrap()

  const tempSessionsQuery = useTemporarySessions()
  const maybeTempSessions = tempSessionsQuery.data?.inner

  const persSessionsQuery = usePersistentSessions()
  const maybePersSessions = persSessionsQuery.data?.inner

  const length = useMemo(() => {
    const temp = maybeTempSessions?.length || 0
    const pers = maybePersSessions?.length || 0
    return temp + pers
  }, [maybeTempSessions, maybePersSessions])

  const tryDisconnectAll = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      if (!confirm(`Do you want to disconnect all sessions?`))
        return Ok.void()

      for (const session of Option.wrap(maybeTempSessions).unwrapOr([]))
        await background.tryRequest({
          method: "brume_disconnect",
          params: [session.id]
        }).then(r => r.throw(t).throw(t))

      for (const session of Option.wrap(maybePersSessions).unwrapOr([]))
        await background.tryRequest({
          method: "brume_disconnect",
          params: [session.id]
        }).then(r => r.throw(t).throw(t))

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, maybePersSessions])

  const Body =
    <PageBody>
      <div className="flex flex-col gap-2">
        {maybeTempSessions?.map(session =>
          <SessionRow
            key={session.id}
            session={session} />)}
        {maybePersSessions?.map(session =>
          <SessionRow
            key={session.id}
            session={session} />)}
      </div>
    </PageBody>

  const Header =
    <PageHeader title="Sessions">
      <Button.Base className="s-xl hovered-or-clicked-or-focused:scale-105 !transition"
        disabled={tryDisconnectAll.loading || !length}
        onClick={tryDisconnectAll.run}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.TrashIcon className="s-sm" />
        </div>
      </Button.Base>
    </PageHeader>

  return <Page>
    {Header}
    {Body}
  </Page>
}

export function SessionRow(props: { session: Session }) {
  const background = useBackgroundContext().unwrap()

  const sessionQuery = useSession(props.session.id)
  const maybeSessionData = sessionQuery.data?.inner

  const originQuery = useOrigin(maybeSessionData?.origin)
  const maybeOriginData = originQuery.data?.inner

  const statusQuery = useStatus(props.session.id)
  const maybeStatusData = statusQuery.data?.inner

  const [iconDatas, setIconDatas] = useState<Nullable<BlobbyData>[]>([])

  const onIconData = useCallback(([index, data]: [number, Nullable<BlobbyData>]) => {
    setIconDatas(iconDatas => {
      iconDatas[index] = data
      return [...iconDatas]
    })
  }, [])

  const tryDisconnect = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      if (maybeSessionData == null)
        return Ok.void()
      if (!confirm(`Do you want to disconnect this session?`))
        return Ok.void()

      await background.tryRequest({
        method: "brume_disconnect",
        params: [maybeSessionData.id]
      }).then(r => r.throw(t).throw(t))

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, maybeSessionData])

  if (maybeOriginData == null)
    return null

  return <div role="button" className="po-md rounded-xl flex items-center gap-4"
    onClick={tryDisconnect.run}>
    {maybeOriginData.icons?.map((x, i) =>
      <IndexedBlobbyLoader
        key={x.id}
        index={i}
        id={x.id}
        ok={onIconData} />)}
    <div className="relative shrink-0">
      {(() => {
        if (maybeStatusData == null)
          return <div className="absolute top-0 -right-2 bg-blue-400 rounded-full w-2 h-2" />
        if (maybeStatusData.error == null)
          return <div className="absolute top-0 -right-2 bg-green-400 rounded-full w-2 h-2" />
        return <div className="absolute top-0 -right-2 bg-red-400 rounded-full w-2 h-2" />
      })()}
      <ImageWithFallback className="s-3xl"
        alt="icon"
        src={iconDatas.find(Boolean)?.data}>
        <Outline.CubeTransparentIcon className="s-3xl" />
      </ImageWithFallback>
    </div>
    <div className="grow">
      <div className="font-medium">
        {maybeOriginData.title}
      </div>
      <div className="text-contrast">
        {maybeOriginData.origin}
      </div>
    </div>
    <Button.Base>
      <div className={`${Button.Shrinker.className}`}>
        <Outline.EllipsisVerticalIcon className="s-sm" />
      </div>
    </Button.Base>
  </div>
}

function IndexedBlobbyLoader(props: OkProps<[number, Nullable<BlobbyData>]> & { id: string, index: number }) {
  const { index, id, ok } = props

  const { data } = useBlobby(id)

  useEffect(() => {
    ok([index, data?.inner])
  }, [index, data, ok])

  return null
}