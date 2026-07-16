export interface PhasePlaceholderProps {
  title: string;
  description: string;
  phase: number;
}

export function PhasePlaceholder({ title, description, phase }: PhasePlaceholderProps) {
  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="empty-state">Wird in Phase {phase} umgesetzt.</div>
    </>
  );
}
