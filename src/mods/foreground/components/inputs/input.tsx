import React from "react";
import { InputProps } from "@/libs/react/props/html";
import { Badge } from "@/mods/foreground/components/badges/badge";

export interface BrumeInput extends InputProps {
  status?: "success" | "warning" | "error" | "default",
  statusMessage?: React.ReactNode,
  rightSide?: React.ReactNode
}

export function Input(props: BrumeInput) {
  const { className, status, statusMessage, rightSide, ...input } = props

  const borderColorByStatus = () => {
    if (status === "success") return `border-green-400`
    if (status === "warning") return `border-yellow-400`
    if (status === "error") return `border-red-400`
    if (status === "default") return `border-neutral-400`
    return `border-neutral-400`
  }

  if (status) {
    return (
      <div className={`flex flex-row items-center bg-white rounded-xl px-4 py-3 border ${borderColorByStatus()} ${className}`}>
        <input className="bg-transparent outline-none w-full" {...input} />
        {rightSide && (<div className="ml-4">{rightSide}</div>)}
        <Badge status={status} className="ml-4">{statusMessage}</Badge>
      </div>
    )
  }

  return (
    <div className={`flex flex-row items-center bg-white rounded-xl px-4 py-3 border ${borderColorByStatus()} ${className}`}>
      <input className="bg-transparent outline-none w-full" {...input} />
      {rightSide && (<div className="ml-4">{rightSide}</div>)}
    </div>
  )
}
