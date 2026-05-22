import styles from "./TabBar.module.css";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: string;
  badge?: number;
}

interface TabBarProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onTabChange: (id: T) => void;
}

export function TabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
}: TabBarProps<T>) {
  return (
    <div className={styles.tabBar} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTab}
          aria-controls={`tabpanel-${tab.id}`}
          id={`tab-${tab.id}`}
          className={styles.tab}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon && (
            <span className={styles.tabIcon} aria-hidden="true">
              {tab.icon}
            </span>
          )}
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className={styles.badge}>{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
