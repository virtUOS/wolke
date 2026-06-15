import { PillButton } from 'wolke-web'

export const Tabs = () => (
  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
    <PillButton active aria-current="page">
      Favoriten
    </PillButton>
    <PillButton>Dienste</PillButton>
    <PillButton>Admin</PillButton>
  </div>
)
