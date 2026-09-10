import { memo, type ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  source: string;
  className?: string;
  empty?: ReactNode;
};

const markdownComponents: Components = {
  a({ node: _node, href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
        {children}
      </a>
    );
  },
  table({ node: _node, children, ...props }) {
    return (
      <div className="md-table-wrap">
        <table {...props}>{children}</table>
      </div>
    );
  },
  code({ node: _node, className, children, ...props }) {
    const isBlock = Boolean(className);
    return (
      <code className={isBlock ? className : "md-inline-code"} {...props}>
        {children}
      </code>
    );
  },
  pre({ node: _node, children, ...props }) {
    return (
      <pre className="code" {...props}>
        {children}
      </pre>
    );
  },
  input({ node: _node, ...props }) {
    return <input {...props} disabled />;
  },
};

const markdownUrlTransform: UrlTransform = (url, key) => {
  const safe = defaultUrlTransform(url);
  if (url && !safe) {
    console.warn("blocked unsafe markdown url", { url, key });
  }
  return safe;
};

export const MarkdownContent = memo(function MarkdownContent({ source, className, empty }: Props) {
  if (!source.trim()) {
    return <>{empty ?? null}</>;
  }

  return (
    <div className={["md-content", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={markdownComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
