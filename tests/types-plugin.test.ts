import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import plugin from "../lint/types-plugin.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const objectError = "Inline object type: declare it as a named module-level type or interface.";
const tupleError = "Inline tuple type: declare it as a named module-level type or interface.";
const localError = "Declare types at module level, not inside functions.";

tester.run("no-inline-types", plugin.rules["no-inline-types"], {
  valid: [
    "type Point = [number, number]; const point: Point = [0, 0];",
    "type Args = { nested: { value: string }; points: [number, number][] };",
    "interface Args { nested: { value: string }; points: [number, number][] }",
    "export type Args = { value: string };",
    "export interface Args { value: string }",
    "export default interface Args { value: string }",
    "declare namespace API { export type Args = { value: string }; }",
    'declare module "api" { export interface Args { value: string } }',
    "type Selected = Extract<Op, { op: 'add' }>;",
    "type Args = { value: string }; const fn = (args: Args): Args => args;",
  ],
  invalid: [
    { code: "const fn = (args: { value: string }) => args;", errors: [{ message: objectError }] },
    {
      code: "function fn(): { value: string } { return { value: '' }; }",
      errors: [{ message: objectError }],
    },
    { code: "const value = input as { value: string };", errors: [{ message: objectError }] },
    {
      code: "const value = input satisfies { value: string };",
      errors: [{ message: objectError }],
    },
    {
      code: "const values = new Map<string, { value: string }>();",
      errors: [{ message: objectError }],
    },
    { code: "const point: [number, number] = [0, 0];", errors: [{ message: tupleError }] },
    { code: "const point = input as [number, number];", errors: [{ message: tupleError }] },
    { code: "function fn() { type Args = { value: string }; }", errors: [{ message: localError }] },
    {
      code: "const fn = () => { interface Args { value: string } };",
      errors: [{ message: localError }],
    },
    {
      code: "class C { method() { type Args = [number, number]; } }",
      errors: [{ message: localError }],
    },
    { code: "if (true) { type Args = { value: string }; }", errors: [{ message: localError }] },
  ],
});
