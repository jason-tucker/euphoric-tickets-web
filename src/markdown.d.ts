// Raw-string imports of Markdown files, enabled by the `asset/source` webpack
// rule in next.config.ts (e.g. `import changelog from '../../../CHANGELOG.md'`).
declare module '*.md' {
  const content: string
  export default content
}
