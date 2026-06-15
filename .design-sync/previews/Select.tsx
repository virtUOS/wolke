import { Select } from 'wolke-web'

export const Default = () => (
  <Select defaultValue="warning" style={{ minWidth: 200 }}>
    <option value="info">info</option>
    <option value="warning">warning</option>
    <option value="critical">critical</option>
  </Select>
)

export const Audience = () => (
  <Select defaultValue="all" style={{ minWidth: 200 }}>
    <option value="all">Alle</option>
    <option value="student">Studierende</option>
    <option value="teacher">Lehrende</option>
    <option value="staff">Mitarbeitende</option>
  </Select>
)
