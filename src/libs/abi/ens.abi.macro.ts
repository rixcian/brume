import { $parse$ } from "./macros/parse";

function $pre$() {
  return `import { Cubane } from "@hazae41/cubane"`
}

$pre$()

export namespace EnsAbi {
  export const resolver = $parse$("resolver(bytes32)")
  export const addr = $parse$("addr(bytes32)")
  export const name = $parse$("name(bytes32)")
}
