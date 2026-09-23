const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/

/** Rewrites `\[…\]` and `\(…\)` math, which remark-math does not read, as dollar math.
 * Code spans and fences are left untouched. */
export function normalizeMath(markdown: string): string {
  return markdown
    .split(CODE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(
              /\\\[([\s\S]+?)\\\]/g,
              (_, tex: string) => `\n$$\n${tex.trim()}\n$$\n`,
            )
            .replace(
              /\\\(([\s\S]+?)\\\)/g,
              (_, tex: string) => `$${tex.trim()}$`,
            ),
    )
    .join('')
}
