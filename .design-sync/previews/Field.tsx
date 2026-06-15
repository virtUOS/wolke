import { Field, Input } from 'wolke-web'

const stack = { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 360 } as const

export const Default = () => (
  <div style={stack}>
    <Field label="Dienstname">
      <Input defaultValue="Rechenzentrum" />
    </Field>
  </div>
)

export const Required = () => (
  <div style={stack}>
    <Field label="Service-URL" required hint="Mit http(s):// beginnen.">
      <Input placeholder="https://…" />
    </Field>
  </div>
)

export const WithError = () => (
  <div style={stack}>
    <Field label="Service-URL" error="Muss mit http(s):// beginnen.">
      <Input defaultValue="rechenzentrum.uni" />
    </Field>
  </div>
)
