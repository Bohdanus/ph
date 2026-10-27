declare module 'css-tree/generator' {
  import type { CssNode, GenerateOptions } from 'css-tree';

  const generate: (ast: CssNode, options?: GenerateOptions) => string;
  export default generate;
}

declare module 'css-tree/parser' {
  const parse: typeof import('css-tree').parse;
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
