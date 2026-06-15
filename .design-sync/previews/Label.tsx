import { Label, Input } from 'wolke-web'

export const Default = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
    <Label htmlFor="svc-name">Dienstname</Label>
    <Input id="svc-name" defaultValue="Rechenzentrum" />
  </div>
)
