import { Textarea } from 'wolke-web'

export const Default = () => (
  <Textarea
    rows={3}
    style={{ maxWidth: 360 }}
    defaultValue="Zentrale IT-Dienste der Universität Osnabrück — Anmeldung mit der Uni-Kennung."
  />
)

export const Empty = () => <Textarea rows={3} style={{ maxWidth: 360 }} placeholder="Beschreibung…" />
