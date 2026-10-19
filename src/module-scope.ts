import { z } from "zod";
export const ScopeFile = z.object({
  path: z.string(),
  kind: z.enum(["source", "documentation"]),
  bytes: z.number().nonnegative(),
});
export type ScopeFile = z.infer<typeof ScopeFile>;
export const ModuleScope = z.object({
  module: z.string().min(1),
  documents: z.array(z.string()).max(100),
});
export type ModuleScope = z.infer<typeof ModuleScope>;
export function inModule(path: string, module: string) {
  return module === "." ? !path.includes("/") : path.startsWith(`${module}/`);
}
export function repositoryModules(files: ScopeFile[]) {
  const modules = new Set<string>();
  for (const file of files.filter((f) => f.kind === "source")) {
    const parts = file.path.split("/");
    if (parts.length === 1) modules.add(".");
    for (let i = 1; i < parts.length; i++)
      modules.add(parts.slice(0, i).join("/"));
  }
  return [...modules].sort();
}
export function suggestedDocuments(files: ScopeFile[], module: string) {
  const name = module.split("/").at(-1)!;
  return files
    .filter(
      (f) =>
        f.kind === "documentation" &&
        (inModule(f.path, module) ||
          /^(README(?:\.[^/]+)?|ARCHITECTURE(?:\.[^/]+)?)$/i.test(f.path) ||
          (module !== "." && f.path.split(/[/.]/).includes(name))),
    )
    .map((f) => f.path)
    .slice(0, 100);
}
/** Preview and execution share exact folder boundaries and deterministic budget ordering. */
export function previewModule(files: ScopeFile[], scope: ModuleScope) {
  if (!repositoryModules(files).includes(scope.module))
    throw new Error("Choose a module from the repository inventory.");
  if (
    scope.documents.some(
      (path) =>
        !files.some((f) => f.kind === "documentation" && f.path === path),
    )
  )
    throw new Error("Choose documentation from the repository inventory.");
  const selected = files.filter((f) =>
    f.kind === "source"
      ? inModule(f.path, scope.module)
      : inModule(f.path, scope.module) || scope.documents.includes(f.path),
  );
  selected.sort(
    (a, b) =>
      Number(a.kind === "documentation") - Number(b.kind === "documentation") ||
      a.path.localeCompare(b.path),
  );
  let bytes = 0;
  const included: ScopeFile[] = [],
    deferred: ScopeFile[] = [];
  for (const file of selected) {
    if (included.length >= 100 || bytes + file.bytes > 64000)
      deferred.push(file);
    else {
      included.push(file);
      bytes += file.bytes;
    }
  }
  return { included, deferred, bytes };
}
