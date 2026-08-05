import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { slugifyHeading } from '../../help/helpMarkdownUtils';
import { HighlightText } from './HighlightText';

interface HelpMarkdownContentProps {
  markdown: string;
  searchQuery?: string;
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (React.isValidElement(children) && children.props.children) {
    return extractText(children.props.children);
  }
  return '';
}

export const HelpMarkdownContent: React.FC<HelpMarkdownContentProps> = ({ markdown, searchQuery = '' }) => {
  const components = useMemo(
    () => ({
      h1: ({ children }: { children?: React.ReactNode }) => {
        const text = extractText(children);
        const id = slugifyHeading(text);
        return (
          <h1 id={id} className="text-2xl font-bold text-slate-900 dark:text-white mt-0 mb-4 scroll-mt-24">
            <HighlightText query={searchQuery}>{text}</HighlightText>
          </h1>
        );
      },
      h2: ({ children }: { children?: React.ReactNode }) => {
        const text = extractText(children);
        const id = slugifyHeading(text);
        return (
          <h2 id={id} className="text-lg font-semibold text-slate-900 dark:text-white mt-8 mb-3 scroll-mt-24 border-b border-slate-200 dark:border-slate-700 pb-2">
            <HighlightText query={searchQuery}>{text}</HighlightText>
          </h2>
        );
      },
      h3: ({ children }: { children?: React.ReactNode }) => {
        const text = extractText(children);
        const id = slugifyHeading(text);
        return (
          <h3 id={id} className="text-base font-semibold text-slate-800 dark:text-slate-100 mt-6 mb-2 scroll-mt-24">
            <HighlightText query={searchQuery}>{text}</HighlightText>
          </h3>
        );
      },
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 mb-4">{children}</p>
      ),
      ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="list-disc pl-6 mb-4 space-y-1.5 text-[15px] text-slate-700 dark:text-slate-300">{children}</ul>
      ),
      ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="list-decimal pl-6 mb-4 space-y-1.5 text-[15px] text-slate-700 dark:text-slate-300">{children}</ol>
      ),
      li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
      strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>
      ),
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a
          href={href}
          className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:text-indigo-700"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      ),
      code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
        const isBlock = className?.includes('language-');
        if (isBlock) {
          return (
            <code className="block text-sm font-mono bg-slate-100 dark:bg-slate-800 rounded-lg p-4 overflow-x-auto">
              {children}
            </code>
          );
        }
        return (
          <code className="text-sm font-mono bg-slate-100 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">
            {children}
          </code>
        );
      },
      pre: ({ children }: { children?: React.ReactNode }) => (
        <pre className="my-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
          {children}
        </pre>
      ),
      table: ({ children }: { children?: React.ReactNode }) => (
        <div className="overflow-x-auto my-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm border-collapse min-w-[320px]">{children}</table>
        </div>
      ),
      th: ({ children }: { children?: React.ReactNode }) => (
        <th className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-left font-semibold text-slate-900 dark:text-white">
          {children}
        </th>
      ),
      td: ({ children }: { children?: React.ReactNode }) => (
        <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-700 dark:text-slate-300">{children}</td>
      ),
      hr: () => <hr className="my-8 border-slate-200 dark:border-slate-700" />,
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="border-l-4 border-indigo-400 pl-4 my-4 text-slate-600 dark:text-slate-400 italic">{children}</blockquote>
      ),
    }),
    [searchQuery],
  );

  return (
    <article className="help-markdown max-w-3xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
};
