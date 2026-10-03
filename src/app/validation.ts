/** Small frontend boundary guards keep the home route within its existing bundle budget. */
export interface CreatedDiagram {
  id: string;
  key: string;
  name: string;
}

export interface BrowserSession {
  signedIn: boolean;
}

export interface Diagram extends CreatedDiagram {
  createdAt: number;
}

export interface DiagramPage {
  items: Diagram[];
  nextCursor: string | null;
}

export interface Template {
  id: string;
  name: string;
  description: string;
}

export interface LibraryEntry extends CreatedDiagram {
  openedAt: number;
}

export interface ValidationError {
  message: string;
}

export interface ApiFailure {
  error?: string | ValidationError;
}

export type Guard<T> = (value: unknown) => value is T;

export function assertBoundary<T>(value: unknown, guard: Guard<T>): asserts value is T {
  if (!guard(value)) throw new TypeError("Invalid response or stored data");
}

export function isText(value: unknown): value is string {
  return typeof value === "string";
}

export function isCreatedDiagram(value: unknown): value is CreatedDiagram {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    isText(value.id) &&
    "key" in value &&
    isText(value.key) &&
    "name" in value &&
    isText(value.name)
  );
}

export function isBrowserSession(value: unknown): value is BrowserSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "signedIn" in value &&
    typeof value.signedIn === "boolean"
  );
}

function isDiagram(value: unknown): value is Diagram {
  return (
    isCreatedDiagram(value) &&
    "createdAt" in value &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
}

export function isDiagramPage(value: unknown): value is DiagramPage {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items) &&
    value.items.every(isDiagram) &&
    "nextCursor" in value &&
    (value.nextCursor === null || isText(value.nextCursor))
  );
}

function isTemplate(value: unknown): value is Template {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    isText(value.id) &&
    "name" in value &&
    isText(value.name) &&
    "description" in value &&
    isText(value.description)
  );
}

export function isTemplateList(value: unknown): value is Template[] {
  return Array.isArray(value) && value.every(isTemplate);
}

function isLibraryEntry(value: unknown): value is LibraryEntry {
  return (
    isCreatedDiagram(value) &&
    "openedAt" in value &&
    typeof value.openedAt === "number" &&
    Number.isFinite(value.openedAt)
  );
}

export function isLibrary(value: unknown): value is LibraryEntry[] {
  return Array.isArray(value) && value.every(isLibraryEntry);
}

export function isValidationError(value: unknown): value is ValidationError {
  return typeof value === "object" && value !== null && "message" in value && isText(value.message);
}

export function isApiFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (!("error" in value) ||
      value.error === undefined ||
      isText(value.error) ||
      isValidationError(value.error))
  );
}

export function isIssues(value: unknown): value is ValidationError[] {
  return Array.isArray(value) && value.every(isValidationError);
}
