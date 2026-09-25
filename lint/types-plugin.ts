// Local oxlint rules for this repo (loaded via `jsPlugins` in .oxlintrc.json).

type Node = { type: string; range: [number, number]; parent?: Node | null };
type Context = { report: (d: { node: Node; message: string }) => void };

const DECLARATIONS = new Set(["TSTypeAliasDeclaration", "TSInterfaceDeclaration"]);

/** A declaration at module level: directly in the program, or exported from it. */
const atModuleLevel = (decl: Node) => {
  const parent = decl.parent;
  const up =
    parent?.type === "ExportNamedDeclaration" || parent?.type === "ExportDefaultDeclaration"
      ? parent.parent
      : parent;
  return up?.type === "Program" || up?.type === "TSModuleBlock";
};

/** The type alias or interface a type node is written in, if any. */
const declarationOf = (node: Node) => {
  for (let p = node.parent; p; p = p.parent) if (DECLARATIONS.has(p.type)) return p;
  return undefined;
};

const noInlineTypes = {
  meta: {
    type: "suggestion" as const,
    docs: {
      description:
        "Declare object and tuple types as named module-level types instead of writing them inline",
    },
  },
  create(context: Context) {
    const check = (node: Node, what: string) => {
      // Inside any type declaration it's part of that type (a local one is reported on its own).
      if (declarationOf(node)) return;
      context.report({
        node,
        message: `Inline ${what} type: declare it as a named module-level type or interface.`,
      });
    };
    return {
      TSTypeLiteral: (node: Node) => check(node, "object"),
      TSTupleType: (node: Node) => check(node, "tuple"),
      TSTypeAliasDeclaration(node: Node) {
        if (!atModuleLevel(node))
          context.report({ node, message: "Declare types at module level, not inside functions." });
      },
      TSInterfaceDeclaration(node: Node) {
        if (!atModuleLevel(node))
          context.report({ node, message: "Declare types at module level, not inside functions." });
      },
    };
  },
};

export default {
  meta: { name: "local" },
  rules: { "no-inline-types": noInlineTypes },
};
