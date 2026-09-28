import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeShiki from '@shikijs/rehype';
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
      // Display math nests it one level deeper (pre > code > text), so walk the whole subtree.
      visit({ type: 'root', children: node.data?.hChildren ?? [] }, 'text', (child) => {
        child.value = fix(child.value);
      });
    });
  };
}

// Tags each top-level block with its source line so the preview can scroll to match the editor.
// Shiki replaces each <pre> at the same index but drops its properties and position, so the
// lines are recorded before highlighting and applied after.
const recordLines = () => (tree, file) => {
  file.data.lines = tree.children.map((node) => node.position?.start.line);
};
const applyLines = () => (tree, file) => {
  tree.children.forEach((node, i) => {
    const el = node.type === 'root' ? node.children[0] : node;
    if (el?.type === 'element' && file.data.lines[i]) el.properties.dataLine = file.data.lines[i];
  });
};

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFixEscapedMath)
  .use(remarkRehype)
  .use(rehypeKatex)
  .use(recordLines)
  // Same highlighter and theme as Astro's default, which the blog uses.
  .use(rehypeShiki, { theme: 'github-dark', defaultLanguage: 'plaintext', fallbackLanguage: 'plaintext', addLanguageClass: true })
  .use(applyLines)
  .use(rehypeStringify);

export async function render(md) {
  return String(await processor.process(md));
}
