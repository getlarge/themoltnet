import {
  colors,
  fontFamily,
  lightColors,
  radius,
  shadow,
} from '@themoltnet/design-system/tokens';

const ui = {
  page: lightColors.bg.void,
  surface: lightColors.bg.surface,
  surfaceRaised: lightColors.bg.overlay,
  border: lightColors.border.DEFAULT,
  borderStrong: lightColors.border.hover,
  primary: lightColors.primary.DEFAULT,
  primaryHover: lightColors.primary.hover,
  primaryMuted: lightColors.primary.muted,
  primarySubtle: lightColors.primary.subtle,
  ink: lightColors.text.DEFAULT,
  muted: lightColors.text.secondary,
  tertiaryText: lightColors.text.muted,
  header: colors.bg.surface,
  headerHover: colors.bg.elevated,
  headerActive: colors.bg.overlay,
  headerBorder: colors.border.hover,
  headerText: colors.text.DEFAULT,
  headerMenu: colors.bg.elevated,
  headerMenuHover: colors.bg.overlay,
} as const;

export const moltnetNodeRedThemeCss = String.raw`:root {
  color-scheme: light;
  accent-color: ${ui.primaryHover};

  --moltnet-ink: ${ui.ink};
  --moltnet-muted: ${ui.muted};
  --moltnet-page: ${ui.page};
  --moltnet-surface: ${ui.surface};
  --moltnet-surface-raised: ${ui.surfaceRaised};
  --moltnet-border: ${ui.border};
  --moltnet-border-strong: ${ui.borderStrong};
  --moltnet-primary: ${ui.primary};
  --moltnet-primary-hover: ${ui.primaryHover};
  --moltnet-primary-muted: ${ui.primaryMuted};
  --moltnet-primary-subtle: ${ui.primarySubtle};
  --moltnet-green: ${lightColors.success.DEFAULT};
  --moltnet-red: ${lightColors.error.DEFAULT};
  --moltnet-yellow: ${lightColors.warning.DEFAULT};
  --moltnet-blue: ${lightColors.info.DEFAULT};

  --red-ui-primary-font: ${fontFamily.sans};
  --red-ui-monospace-font: ${fontFamily.mono};
  --red-ui-primary-background: var(--moltnet-page);
  --red-ui-secondary-background: var(--moltnet-surface);
  --red-ui-secondary-background-selected: var(--moltnet-primary-muted);
  --red-ui-secondary-background-inactive: ${lightColors.bg.overlay};
  --red-ui-secondary-background-hover: var(--moltnet-primary-subtle);
  --red-ui-secondary-background-disabled: ${lightColors.bg.overlay};
  --red-ui-tertiary-background: var(--moltnet-surface-raised);
  --red-ui-primary-text-color: var(--moltnet-ink);
  --red-ui-secondary-text-color: var(--moltnet-muted);
  --red-ui-secondary-text-color-focus: var(--moltnet-primary);
  --red-ui-secondary-text-color-hover: var(--moltnet-primary);
  --red-ui-secondary-text-color-active: var(--moltnet-primary);
  --red-ui-secondary-text-color-selected: var(--moltnet-ink);
  --red-ui-tertiary-text-color: ${ui.tertiaryText};
  --red-ui-header-text-color: var(--red-ui-header-menu-color);
  --red-ui-text-color-error: var(--moltnet-red);
  --red-ui-text-color-warning: var(--moltnet-yellow);
  --red-ui-text-color-success: var(--moltnet-green);
  --red-ui-text-color-code: var(--moltnet-primary);
  --red-ui-text-color-link: var(--moltnet-primary);
  --red-ui-primary-border-color: var(--moltnet-border);
  --red-ui-secondary-border-color: var(--moltnet-border);
  --red-ui-tertiary-border-color: var(--moltnet-border-strong);
  --red-ui-form-input-focus-color: var(--moltnet-primary-hover);
  --red-ui-form-input-border-selected-color: var(--moltnet-primary-hover);
  --red-ui-list-item-background-selected: var(--moltnet-primary-muted);
  --red-ui-list-item-border-selected: var(--moltnet-primary);
  --red-ui-tab-background: var(--moltnet-surface);
  --red-ui-tab-background-active: var(--moltnet-surface);
  --red-ui-tab-background-selected: var(--moltnet-primary-muted);
  --red-ui-tab-background-inactive: ${lightColors.bg.overlay};
  --red-ui-tab-background-hover: var(--moltnet-primary-subtle);
  --red-ui-tab-text-color-active: var(--moltnet-ink);
  --red-ui-tab-text-color-inactive: var(--moltnet-muted);
  --red-ui-tab-badge-color: var(--moltnet-primary);
  --red-ui-tab-icon-color: var(--moltnet-primary-hover);
  --red-ui-palette-header-background: ${lightColors.bg.overlay};
  --red-ui-palette-header-color: var(--moltnet-ink);
  --red-ui-palette-content-background: var(--moltnet-surface);
  --red-ui-workspace-button-background: var(--moltnet-surface);
  --red-ui-workspace-button-background-hover: var(--moltnet-primary-subtle);
  --red-ui-workspace-button-background-active: var(--moltnet-primary-muted);
  --red-ui-workspace-button-background-selected: var(--moltnet-primary);
  --red-ui-workspace-button-border-selected: var(--moltnet-primary);
  --red-ui-workspace-button-color: var(--moltnet-muted);
  --red-ui-workspace-button-color-hover: var(--moltnet-primary);
  --red-ui-workspace-button-color-selected: ${colors.white};
  --red-ui-workspace-button-color-primary: ${colors.white};
  --red-ui-workspace-button-background-primary: var(--moltnet-primary);
  --red-ui-workspace-button-background-primary-hover: var(--moltnet-primary-hover);
  --red-ui-workspace-button-color-focus-outline: var(--moltnet-primary-hover);
  --red-ui-header-background: ${ui.header};
  --red-ui-header-accent: var(--moltnet-primary-hover);
  --red-ui-header-button-background: ${ui.header};
  --red-ui-header-button-background-hover: ${ui.headerHover};
  --red-ui-header-button-background-active: ${ui.headerActive};
  --red-ui-header-button-border: ${ui.headerBorder};
  --red-ui-header-menu-color: ${ui.headerText};
  --red-ui-header-menu-heading-color: ${colors.white};
  --red-ui-header-menu-background: ${ui.headerMenu};
  --red-ui-header-menu-item-hover: ${ui.headerMenuHover};
  --red-ui-deploy-button-color: ${colors.white};
  --red-ui-deploy-button-background: var(--moltnet-primary);
  --red-ui-deploy-button-background-hover: var(--moltnet-primary-hover);
  --red-ui-deploy-button-background-active: var(--moltnet-primary);
  --red-ui-deploy-button-border-color: var(--moltnet-primary);
  --red-ui-menuActiveColor: var(--moltnet-primary);
  --red-ui-menuActiveBackground: var(--moltnet-primary-muted);
  --red-ui-menuHoverColor: var(--moltnet-ink);
  --red-ui-menuHoverBackground: var(--moltnet-primary-subtle);
  --red-ui-view-background: var(--moltnet-surface-raised);
  --red-ui-view-grid-color: var(--moltnet-border);
  --red-ui-view-lasso-stroke: var(--moltnet-primary);
  --red-ui-view-lasso-fill: var(--moltnet-primary-muted);
  --red-ui-node-selected-color: var(--moltnet-primary-hover);
  --red-ui-port-selected-color: var(--moltnet-primary-hover);
  --red-ui-link-link-active-color: var(--moltnet-primary);
  --red-ui-notification-border-default: var(--moltnet-primary-hover);
  --red-ui-notification-border-success: var(--moltnet-green);
  --red-ui-notification-border-warning: var(--moltnet-yellow);
  --red-ui-notification-border-error: var(--moltnet-red);
  --red-ui-spinner-color: var(--moltnet-primary-hover);
}

#red-ui-header {
  box-shadow: ${shadow.md};
}

#red-ui-header .red-ui-header-logo,
#red-ui-header .red-ui-header-logo img {
  filter: saturate(1.05);
}

.red-ui-editor .red-ui-button.primary,
.red-ui-editor-dialog .red-ui-button.primary {
  background: var(--moltnet-primary);
  border-color: var(--moltnet-primary);
  color: ${colors.white};
}

.red-ui-editor .red-ui-button.primary:hover,
.red-ui-editor-dialog .red-ui-button.primary:hover {
  background: var(--moltnet-primary-hover);
  border-color: var(--moltnet-primary-hover);
}

.red-ui-editor input:focus,
.red-ui-editor textarea:focus,
.red-ui-editor select:focus,
.red-ui-editor-dialog input:focus,
.red-ui-editor-dialog textarea:focus,
.red-ui-editor-dialog select:focus {
  border-color: var(--moltnet-primary-hover);
  box-shadow: 0 0 0 3px var(--moltnet-primary-muted);
}

.red-ui-palette-node,
.red-ui-flow-node,
.red-ui-editor .red-ui-button,
.red-ui-editor-dialog .red-ui-button,
.red-ui-tab,
.red-ui-popover,
.red-ui-menu-dropdown {
  border-radius: ${radius.sm};
}

.red-ui-palette-node:hover {
  box-shadow: ${shadow.sm};
}

.red-ui-sidebar {
  border-left-color: var(--red-ui-primary-border-color);
}

.red-ui-tray,
.red-ui-editor-dialog {
  box-shadow: ${shadow.lg};
}
`;
