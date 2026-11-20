/**
 * Stub from core so the shelf and editor compile. The import area replaces
 * this file with the real wizard.
 */

export interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new book's id once the import is committed. */
  onImported?: (bookId: string) => void;
}

export function ImportWizard(_props: ImportWizardProps) {
  return null;
}
