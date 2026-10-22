declare module 'css-tree' {
  export interface CssNode {
    type: string;
    [key: string]: any;
  }
  export interface GenerateOptions {
    [key: string]: unknown;
  }
  export interface ParseOptions {
    [key: string]: unknown;
  }
  export type EnterOrLeaveFn = (node: CssNode) => void;
  export interface WalkOptions {
    enter?: (node: CssNode) => void;
    leave?: (node: CssNode) => void;
    [key: string]: unknown;
  }
}

declare module 'css-tree/generator' {
  import type { CssNode, GenerateOptions } from 'css-tree';

  const generate: (ast: CssNode, options?: GenerateOptions) => string;
  export default generate;
}

declare module 'css-tree/parser' {
  import type { CssNode, ParseOptions } from 'css-tree';

  const parse: (text: string, options?: ParseOptions) => CssNode;
  export default parse;
}

declare module 'css-tree/walker' {
  import type { CssNode, EnterOrLeaveFn, WalkOptions } from 'css-tree';

  const walk: {
    (ast: CssNode, options: EnterOrLeaveFn | WalkOptions): void;
    readonly break: symbol;
    readonly skip: symbol;
  };
  export default walk;
}
