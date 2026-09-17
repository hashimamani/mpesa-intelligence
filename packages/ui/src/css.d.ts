// This package is consumed as raw source (not compiled to dist) via each Next.js
// app's `transpilePackages`, since Next.js is what needs to process its CSS Modules —
// see docs/12-design-system.md. This ambient declaration lets `tsc --noEmit` (used
// for typecheck, and by editors) resolve `*.module.css` imports.
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
