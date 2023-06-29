import { StoryObj } from "@storybook/react";
import { Badge } from "./badge";

const meta = { component: Badge }

export const badge: StoryObj<typeof meta["component"]> = {
  args: {
    status: "success",
    children: "Hello world",
  }
}

export default meta
