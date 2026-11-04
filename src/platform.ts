// SPDX-License-Identifier: Apache-2.0
//
// Alp Platform status bar item + off-manifest warning (#718). Fed the raw
// `data.platform` of every `tan doctor` run; all decisions are in core.

import {
  mismatchKey,
  readPlatform,
  statusBarText,
  warningMessage,
  withOwnVersion,
} from "@alp-sdk/core/platform/service";
import * as vscode from "vscode";

import { notify } from "./notify/vscodeAdapter";
import { runAlpInTerminal } from "./alpCli/vscodeAdapter";
import { log } from "./util";

let item: vscode.StatusBarItem | undefined;
/** Mismatch sets already warned about this session. */
const warned = new Set<string>();

export function applyPlatform(
  context: vscode.ExtensionContext,
  raw: unknown,
  cwd: string | undefined,
): void {
  const read = readPlatform(raw);
  if (read.kind === "malformed") {
    log(
      "[platform] ignoring a malformed `data.platform` in tan doctor",
      "warn",
    );
  }
  if (read.kind !== "pin") {
    item?.hide();
    return;
  }
  const pin = withOwnVersion(
    read.pin,
    String(context.extension.packageJSON.version),
  );
  item ??= vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    97,
  );
  item.text = statusBarText(pin);
  item.tooltip = `Alp Platform ${pin.version} (line ${pin.line})`;
  item.show();

  const key = mismatchKey(pin);
  if (key === "" || warned.has(key)) return;
  warned.add(key);
  const action = `Run tan platform use ${pin.line}`;
  void notify({
    severity: "warning",
    channel: "toast",
    message: warningMessage(pin),
    actions: [{ id: "usePlatform", title: action }],
  }).then((picked) => {
    if (picked !== "usePlatform") return;
    // A variable, not a literal: the PINNED tan predates `tan platform`, so
    // the surface-contract gate (`test/tan.surfaceContract.test.js`) cannot
    // check this argv; it is listed in EXPECTED_UNRESOLVABLE until the pin
    // moves to a tan that ships it.
    const args = ["platform", "use", pin.line];
    return runAlpInTerminal(context, args, { name: "Alp: platform use", cwd });
  });
}
