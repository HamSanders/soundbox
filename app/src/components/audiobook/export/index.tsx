/**
 * Stub from core so the editor compiles. The export area replaces this file
 * with the real export dialog.
 */

export interface ExportDialogProps {
  bookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog(_props: ExportDialogProps) {
  return null;
}
