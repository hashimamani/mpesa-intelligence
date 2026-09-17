/**
 * Design tokens as plain values — usable outside CSS (chart color arrays, RN
 * styles when the mobile app needs them later, tests asserting on semantic
 * colors). tokens.css below is the same palette expressed as CSS custom
 * properties, which components in this package use. Keep the two in sync by
 * hand — there are few enough values that generating one from the other
 * isn't worth the build-step complexity yet.
 */

export const color = {
  primary: {
    50: "#EEF2FF",
    100: "#E0E7FF",
    200: "#C7D2FE",
    300: "#A5B4FC",
    400: "#818CF8",
    500: "#6366F1",
    600: "#4F46E5",
    700: "#4338CA",
    800: "#3730A3",
    900: "#312E81",
  },
  neutral: {
    0: "#FFFFFF",
    50: "#F8FAFC",
    100: "#F1F5F9",
    200: "#E2E8F0",
    300: "#CBD5E1",
    400: "#94A3B8",
    500: "#64748B",
    600: "#475569",
    700: "#334155",
    800: "#1E293B",
    900: "#0F172A",
  },
  semantic: {
    success: "#16A34A",
    successBg: "#F0FDF4",
    danger: "#DC2626",
    dangerBg: "#FEF2F2",
    warning: "#D97706",
    warningBg: "#FFFBEB",
    info: "#2563EB",
    infoBg: "#EFF6FF",
  },
  /**
   * Money is not "good" or "bad" by default — see docs/01-prd.md §Design for
   * trust and the accounting distinction in docs/06-statement-processing-architecture.md.
   * Received/credit gets a positive-leaning color; spent/debit stays neutral,
   * not alarming; danger red is reserved for genuinely negative net movement
   * or a flagged anomaly, not for ordinary spending.
   */
  money: {
    positive: "#16A34A",
    neutral: "#1E293B",
    negative: "#DC2626",
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  "6xl": 64,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const shadow = {
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  md: "0 4px 12px rgba(15, 23, 42, 0.08)",
  lg: "0 12px 32px rgba(15, 23, 42, 0.12)",
} as const;

export const fontFamily = {
  sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

export const typeScale = {
  displayLg: { fontSize: "2.5rem", lineHeight: 1.2, fontWeight: 700 },
  h1: { fontSize: "2rem", lineHeight: 1.25, fontWeight: 700 },
  h2: { fontSize: "1.5rem", lineHeight: 1.3, fontWeight: 600 },
  h3: { fontSize: "1.25rem", lineHeight: 1.4, fontWeight: 600 },
  h4: { fontSize: "1.125rem", lineHeight: 1.4, fontWeight: 600 },
  bodyLg: { fontSize: "1.125rem", lineHeight: 1.6, fontWeight: 400 },
  body: { fontSize: "1rem", lineHeight: 1.6, fontWeight: 400 },
  bodySm: { fontSize: "0.875rem", lineHeight: 1.5, fontWeight: 400 },
  caption: { fontSize: "0.75rem", lineHeight: 1.4, fontWeight: 500, letterSpacing: "0.02em" },
} as const;
