// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { Component, type ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorFallback from '../app/components/ErrorFallback'

// A minimal class boundary mirroring what Next's error.tsx does (getDerivedStateFromError -> render
// the fallback). Proves the mechanism catches a render throw and shows the fallback, NOT a blank screen.
class Boundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  componentDidCatch() {}
  render() {
    return this.state.crashed
      ? <ErrorFallback message="It broke." actions={[{ label: 'Try again', onClick: () => this.setState({ crashed: false }), primary: true }]} />
      : this.props.children
  }
}
function Boom(): ReactNode { throw new Error('kaboom') }

describe('error boundary', () => {
  it('renders the recover UI instead of a white screen when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {}) // silence expected React log
    render(<Boundary><Boom /></Boundary>)
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText(/It broke/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    spy.mockRestore()
  })

  it('fires the recover action on click', () => {
    const onClick = vi.fn()
    render(<ErrorFallback message="x" actions={[{ label: 'Reload', onClick, primary: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows the digest reference for support when present', () => {
    render(<ErrorFallback message="x" digest="abc123" actions={[{ label: 'ok', onClick: () => {} }]} />)
    expect(screen.getByText(/abc123/)).toBeTruthy()
  })
})
