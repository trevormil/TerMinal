import { NOTE_TEMPLATES, appendTemplate } from './templates'

export function TemplateInsert({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <select
      aria-label="Append note template"
      value=""
      disabled={disabled}
      className="rounded border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2 py-1 text-xs text-zinc-300"
      onChange={(event) => onChange(appendTemplate(value, event.target.value))}
    >
      <option value="" disabled>
        Append template…
      </option>
      {NOTE_TEMPLATES.map((template) => (
        <option key={template.id} value={template.id}>
          {template.title}
        </option>
      ))}
    </select>
  )
}
