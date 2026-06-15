import { render, screen } from '@testing-library/react'
import { Field } from '../field'
import { Input } from '../input'

describe('Field', () => {
  it('associates the label with its control', () => {
    render(
      <Field label="Titel">
        <Input />
      </Field>,
    )
    // Label association works only if Field injected a matching id + htmlFor.
    expect(screen.getByLabelText('Titel')).toBeInstanceOf(HTMLInputElement)
  })

  it('marks the control invalid and describes it by the error', () => {
    render(
      <Field label="Titel" error="Pflichtfeld">
        <Input />
      </Field>,
    )
    const el = screen.getByLabelText('Titel')
    expect(el).toHaveAttribute('aria-invalid', 'true')
    const describedBy = el.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(screen.getByText('Pflichtfeld')).toHaveAttribute('id', describedBy!)
  })

  it('describes the control by a hint when there is no error', () => {
    render(
      <Field label="Titel" hint="Kurz halten">
        <Input />
      </Field>,
    )
    const el = screen.getByLabelText('Titel')
    expect(el).not.toHaveAttribute('aria-invalid', 'true')
    const describedBy = el.getAttribute('aria-describedby')
    expect(screen.getByText('Kurz halten')).toHaveAttribute('id', describedBy!)
  })

  it('shows a required marker', () => {
    render(
      <Field label="Titel" required>
        <Input />
      </Field>,
    )
    expect(screen.getByText('*')).toBeInTheDocument()
  })
})
