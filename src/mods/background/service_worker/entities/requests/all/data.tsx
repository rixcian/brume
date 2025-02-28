import { createQuery } from "@hazae41/glacier";
import { AppRequest } from "../data";

export namespace BgAppRequests {

  export type Key = typeof key

  export const key = `requests`

  export type Schema = ReturnType<typeof schema>

  export function schema() {
    return createQuery<Key, AppRequest[], never>({ key })
  }

}