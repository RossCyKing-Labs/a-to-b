import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FileDrop from '~/components/FileDrop';

describe('FileDrop', () => {
  it('renders the default placeholder when no children are passed', () => {
    render(<FileDrop onFiles={() => {}} />);
    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose files/i })).toBeInTheDocument();
  });

  it('renders custom children if provided', () => {
    render(
      <FileDrop onFiles={() => {}}>
        <p>Drop your widgets</p>
      </FileDrop>,
    );
    expect(screen.getByText('Drop your widgets')).toBeInTheDocument();
  });

  it('calls onFiles when a file is selected via the input', async () => {
    const onFiles = vi.fn();
    render(<FileDrop onFiles={onFiles} accept="image/*" />);
    const file = new File(['hello'], 'hello.png', { type: 'image/png' });
    // The input is sr-only inside the label; query it by its hidden role.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toHaveLength(1);
    expect(onFiles.mock.calls[0][0][0].name).toBe('hello.png');
  });

  it('exposes an accessible name on the drop zone', () => {
    render(<FileDrop onFiles={() => {}} />);
    expect(
      screen.getByRole('button', { name: /drop files here, or click to select/i }),
    ).toBeInTheDocument();
  });
});
