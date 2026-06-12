/// <reference types="vite/client" />

// CSS imported with `?inline` resolves to the stylesheet text as a string.
declare module '*.css?inline' {
  const css: string;
  export default css;
}
