// SPDX-License-Identifier: Apache-2.0
//
// The last line of defence between a thrown render and a blank webview.
//
// Why this exists (#517): the Models panel cast `modelFitData.models` — which
// crosses the wire as `unknown[]` — instead of narrowing it. One malformed
// element threw during render, React unmounted the WHOLE tree, and the customer
// saw an empty panel. An empty Models panel is indistinguishable from "no
// models declared", so the failure was not a missing answer but a wrong one,
// and the only trace was a webview devtools console nobody opens.
//
// Narrowing at the boundary fixes the shapes we thought of; this bounds the
// ones we did not. It is deliberately in `shared/ui` and wrapped around the
// ROUTER rather than around Models alone: every view had the same gap, and a
// per-view boundary is a list someone has to remember to extend.
//
// A class component on purpose — `getDerivedStateFromError` has no hook form.
import * as React from "react";

import layout from "../layout.module.css";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    // The message is shown, not swallowed. A boundary that renders a bare
    // "something went wrong" trades a blank panel for an uninformative one:
    // the customer still cannot say what failed, and neither can a bug report.
    return (
      <div className={layout.section} role="alert">
        <p className={layout.sectionTitle}>This view failed to render</p>
        <p className={layout.setupRowDesc}>
          The panel stopped before it could draw. This is a defect in the
          extension, not a result about your project — nothing here reflects the
          state of your board or models.
        </p>
        <p className={layout.setupRowDesc}>{error.message}</p>
      </div>
    );
  }
}
