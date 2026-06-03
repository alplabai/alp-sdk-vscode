import { ResourceLink } from "../../shared/ui/ResourceLink";
import styles from "./FooterView.module.css";

interface ResourceLinkDef {
  label: string;
  href: string;
  prefix?: string;
}

const LINKS: ResourceLinkDef[] = [
  {
    label: "Documentation",
    href: "https://github.com/alplabai/alp-sdk/tree/main/docs",
    prefix: "📖",
  },
  {
    label: "Getting Started",
    href: "https://github.com/alplabai/alp-sdk/blob/main/docs/getting-started.md",
    prefix: "🚀",
  },
  {
    label: "West Docs",
    href: "https://docs.zephyrproject.org/latest/develop/west/index.html",
    prefix: "⚡",
  },
  {
    label: "Report Issue",
    href: "https://github.com/alplabai/alp-sdk-vscode/issues/new",
    prefix: "🐛",
  },
];

export function FooterView() {
  return (
    <div className={styles.footer}>
      <div className={styles.links}>
        {LINKS.map(({ label, href, prefix }) => (
          <ResourceLink key={label} href={href} label={label} prefix={prefix}>
            {label}
          </ResourceLink>
        ))}
      </div>
    </div>
  );
}
