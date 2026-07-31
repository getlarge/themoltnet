import type { CSSProperties, MouseEvent, ReactNode } from 'react';

import { useInteractive, useTheme } from '../hooks.js';

export interface SideNavigationItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  current?: boolean;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface SideNavigationGroup {
  id: string;
  label?: string;
  items: SideNavigationItem[];
}

export interface SideNavigationProps {
  groups: SideNavigationGroup[];
  collapsed?: boolean;
  ariaLabel?: string;
  header?: ReactNode;
  footer?: ReactNode;
  onNavigate?: (
    item: SideNavigationItem,
    event: MouseEvent<HTMLAnchorElement>,
  ) => void;
}

export function SideNavigation({
  groups,
  collapsed = false,
  ariaLabel = 'Primary',
  header,
  footer,
  onNavigate,
}: SideNavigationProps) {
  const theme = useTheme();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        gap: theme.spacing[4],
      }}
    >
      {header}
      <nav aria-label={ariaLabel} style={{ minHeight: 0, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gap: theme.spacing[5] }}>
          {groups.map((group) => {
            const labelId = `molt-nav-${group.id}-label`;
            return (
              <section
                key={group.id}
                aria-labelledby={group.label ? labelId : undefined}
              >
                {group.label ? (
                  <div
                    id={labelId}
                    style={
                      collapsed
                        ? visuallyHidden
                        : {
                            color: theme.color.text.muted,
                            fontSize: theme.font.size.xs,
                            fontWeight: theme.font.weight.semibold,
                            letterSpacing: theme.font.letterSpacing.wider,
                            marginBottom: theme.spacing[2],
                            paddingInline: theme.spacing[3],
                            textTransform: 'uppercase',
                          }
                    }
                  >
                    {group.label}
                  </div>
                ) : null}
                <div style={{ display: 'grid', gap: theme.spacing[1] }}>
                  {group.items.map((item) => (
                    <SideNavigationLink
                      key={item.id}
                      item={item}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </nav>
      {footer ? <div style={{ marginTop: 'auto' }}>{footer}</div> : null}
    </div>
  );
}

function SideNavigationLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: SideNavigationItem;
  collapsed: boolean;
  onNavigate?: SideNavigationProps['onNavigate'];
}) {
  const theme = useTheme();
  const { focused, hovered, pressed, handlers } = useInteractive();
  const active = Boolean(item.current);

  return (
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-disabled={item.disabled || undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      onClick={(event) => {
        if (item.disabled) {
          event.preventDefault();
          return;
        }
        onNavigate?.(item, event);
      }}
      style={{
        alignItems: 'center',
        background: active
          ? theme.color.primary.subtle
          : hovered
            ? theme.color.bg.elevated
            : 'transparent',
        border: `1px solid ${
          active ? theme.color.border.hover : theme.color.transparent
        }`,
        borderRadius: theme.radius.md,
        boxShadow: focused
          ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.border.focus}`
          : 'none',
        color: active
          ? theme.color.primary.DEFAULT
          : theme.color.text.secondary,
        cursor: item.disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        fontSize: theme.font.size.sm,
        fontWeight: active
          ? theme.font.weight.semibold
          : theme.font.weight.medium,
        gap: theme.spacing[3],
        justifyContent: collapsed ? 'center' : 'flex-start',
        minHeight: '2.75rem',
        opacity: item.disabled ? 0.5 : pressed ? 0.82 : 1,
        outline: 'none',
        padding: collapsed
          ? theme.spacing[2]
          : `${theme.spacing[2]} ${theme.spacing[3]}`,
        textDecoration: 'none',
        transition: `background ${theme.transition.fast}, border-color ${theme.transition.fast}, color ${theme.transition.fast}, box-shadow ${theme.transition.fast}, opacity ${theme.transition.fast}`,
      }}
      {...handlers}
    >
      {item.icon ? (
        <span
          aria-hidden="true"
          style={{
            alignItems: 'center',
            display: 'inline-flex',
            flex: '0 0 auto',
            height: '1.125rem',
            justifyContent: 'center',
            width: '1.125rem',
          }}
        >
          {item.icon}
        </span>
      ) : null}
      {collapsed ? null : (
        <>
          <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
          {item.badge}
        </>
      )}
    </a>
  );
}

const visuallyHidden: CSSProperties = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: 1,
  margin: -1,
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: 1,
};
