import React from 'react';
import { splitHighlightParts } from '../../help/helpMarkdownUtils';

interface HighlightTextProps {
  children: string;
  query?: string;
}

export const HighlightText: React.FC<HighlightTextProps> = ({ children, query = '' }) => {
  const parts = splitHighlightParts(children, query);
  return (
    <>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark key={i} className="bg-amber-200/80 dark:bg-amber-500/40 text-inherit rounded px-0.5">
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
};
