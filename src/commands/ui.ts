import React from "react";
import { render } from "ink";
import { App } from "../tui/app.js";
import type { ScanOptions } from "../core/discovery.js";

export async function uiCommand(scanOptions?: ScanOptions): Promise<void> {
  const { waitUntilExit } = render(React.createElement(App, { scanOptions }), {
    exitOnCtrlC: true,
  });
  await waitUntilExit();
}
