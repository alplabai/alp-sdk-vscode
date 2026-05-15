import { ResourceLink } from "../components/ResourceLink";

interface ResourceLinkDef {
  label: string;
  href: string;
  /** Optional short prefix shown before the label (e.g. "→" or an icon). */
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

/**
 * Sticky footer section rendered at the bottom of the IDE Hub panel.
 * Renders a flat list of external resource links using the reusable
 * ResourceLink component.  Add new links by appending to LINKS above.
 */
export function FooterSection() {
  return (
    <div className="footer-section">
      <div className="footer-links">
        {LINKS.map(({ label, href, prefix }) => (
          <ResourceLink key={label} href={href} label={label} prefix={prefix}>
            {label}
          </ResourceLink>
        ))}
      </div>
    </div>
  );
}
