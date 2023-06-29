import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string,
  status?: "success" | "warning" | "error" | "default",
  children?: React.ReactNode
}

export function Badge(props: BadgeProps) {
  const { className, status, children, ...rest } = props

  const bgColor = () => {
    if (status === "success") return "bg-green-100"
    if (status === "warning") return "bg-yellow-100"
    if (status === "error") return "bg-red-100"
    return "bg-neutral-100"
  }

  const textColor = () => {
    if (status === "success") return "text-green-400"
    if (status === "warning") return "text-yellow-400"
    if (status === "error") return "text-red-400"
    return "text-neutral-400"
  }

  return (
    <div className={`inline-block px-sm px-3 py-1 rounded-md text-xs h-fit whitespace-nowrap ${textColor()} ${bgColor()} ${className}`} {...rest}>
      {children}
    </div>
  )
}