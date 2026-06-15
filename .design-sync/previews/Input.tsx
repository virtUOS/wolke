import { Input } from 'wolke-web'

const stack = { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 } as const

export const Default = () => (
  <div style={stack}>
    <Input placeholder="Dienstname" defaultValue="Rechenzentrum" />
    <Input placeholder="https://…" />
  </div>
)

export const Invalid = () => (
  <div style={stack}>
    <Input aria-invalid defaultValue="kein-link" />
  </div>
)

export const Disabled = () => (
  <div style={stack}>
    <Input disabled defaultValue="Gesperrt" />
  </div>
)
