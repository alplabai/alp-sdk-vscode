// JSX type declarations for @vscode/webview-ui-toolkit web components.
// Only elements registered in main.tsx are declared here.
import type { HTMLAttributes, Key } from "react";

// key is in React.Attributes (merged by JSX transform), but TypeScript
// doesn't always apply IntrinsicAttributes for declared custom elements,
// so we include it explicitly here.
type HtmlProps = HTMLAttributes<HTMLElement> & { key?: Key | null };

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "vscode-button": HtmlProps & {
        appearance?: "primary" | "secondary" | "icon";
        disabled?: boolean;
      };
      "vscode-divider": HtmlProps & {
        role?: "separator" | "presentation";
      };
      "vscode-progress-ring": HtmlProps;
      "vscode-tag": HtmlProps;
    }
  }
}
