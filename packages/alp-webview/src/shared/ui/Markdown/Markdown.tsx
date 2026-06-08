import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { postMessage } from "../../../vscode";
import styles from "./Markdown.module.css";

/**
 * Render GitHub-flavoured Markdown (release notes, etc.) as React elements —
 * no raw HTML injection, so it stays within the webview CSP. Links are routed
 * through the host via `openUrl` (the webview itself cannot navigate).
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href ?? "#"}
              onClick={(e) => {
                e.preventDefault();
                if (href) {
                  postMessage({
                    type: "openUrl",
                    url: href,
                    label: "markdown",
                  });
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
