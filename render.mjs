import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

// Keep in sync with remarkFixEscapedMath in Mm-767.github.io/astro.config.mjs,
// otherwise the preview stops matching the blog.
function remarkFixEscapedMath() {
  const fix = (value) => value
    .replace(/\\\\(?=[a-zA-Z{}|,;!])/g, '\\')
    .replace(/\\_/g, '_')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\\left\{/g, '\\left\\{')
    .replace(/\\right\}/g, '\\right\\}')
    .replace(/;\\middle\|;/g, '\\;\\middle|\\;');
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'math' && node.type !== 'inlineMath') return;
      node.value = fix(node.value);
      // remark-math precomputes the hast text in node.data.hChildren; rehype reads that copy.
      for (const child of node.data?.hChildren ?? []) {
        if (child.type === 'text') child.value = fix(child.value);
      }
    });
  };
}

// Tags each top-level block with its source line so the preview can scroll to match the editor.
function rehypeLineAnchors() {
  return (tree) => {
    for (const node of tree.children) {
      if (node.type === 'element' && node.position) node.properties.dataLine = node.position.start.line;
    }
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFixEscapedMath)
  .use(remarkRehype)
  .use(rehypeKatex)
  .use(rehypeLineAnchors)
  .use(rehypeStringify);

export function render(md) {
  return String(processor.processSync(md));
}
