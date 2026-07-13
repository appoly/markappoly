export type Mode = "preview" | "edit" | "split";
export type ExportKind = "txt" | "html" | "json" | "docx" | "pdf";

export type Doc = {
  id: string;
  path: string | null;
  source: string;
  dirty: boolean;
  mtime: number | null;
};

export function makeDoc(partial: Partial<Doc> = {}): Doc {
  return {
    id: crypto.randomUUID(),
    path: null,
    source: "",
    dirty: false,
    mtime: null,
    ...partial,
  };
}
