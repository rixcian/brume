import { StoryObj } from "@storybook/react";
import { Badge } from "@/mods/foreground/components/badges/badge";
import { Input } from "./input";

const meta = { component: Input }

export const input: StoryObj<typeof meta["component"]> = {
  args: {
    placeholder: "Address or ENS Name",
    className: "w-60"
  }
}

export const inputWithStatus: StoryObj<typeof meta["component"]> = {
  args: {
    placeholder: "Address or ENS Name",
    className: "w-96",
    status: "success",
    statusMessage: "Valid ENS Name"
  }
}

export const inputWithRightSide: StoryObj<typeof meta["component"]> = {
  args: {
    placeholder: "Value",
    className: "w-60",
    rightSide: <Badge status="default" onClick={() => alert('Max Value')} className="transition-all ease-in-out duration-300 underline border border-transparent hover:cursor-pointer hover:border hover:border-neutral-400">Max</Badge>
  }
}

export default meta
