import type { ReactNode } from "react";
import { Icon } from "../../shared/ui";
import { ResourceLink } from "../../shared/ui/ResourceLink";
import styles from "./FooterView.module.css";

interface ResourceLinkDef {
  label: string;
  href: string;
  prefix?: ReactNode;
}

const LINK_ICON_SIZE = 13;
const LINKS: ResourceLinkDef[] = [
  {
    label: "Documentation",
    href: "https://github.com/alplabai/alp-sdk/tree/main/docs",
    prefix: <Icon name="book" size={LINK_ICON_SIZE} />,
  },
  {
    label: "Getting Started",
    href: "https://github.com/alplabai/alp-sdk/blob/main/docs/getting-started.md",
    prefix: <Icon name="rocket" size={LINK_ICON_SIZE} />,
  },
  {
    label: "West Docs",
    href: "https://docs.zephyrproject.org/latest/develop/west/index.html",
    prefix: <Icon name="bolt" size={LINK_ICON_SIZE} />,
  },
  {
    label: "Report Issue",
    href: "https://github.com/alplabai/alp-sdk-vscode/issues/new",
    prefix: <Icon name="bug" size={LINK_ICON_SIZE} />,
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
