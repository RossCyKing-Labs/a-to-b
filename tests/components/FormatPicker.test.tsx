import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FormatPicker from '~/components/FormatPicker';

/**
 * The bug that motivated these tests: on the live site, only the JPEG
 * radio reacted to clicks. The fix was an explicit htmlFor/id binding plus
 * a value attribute. These cases lock that behavior down — every option
 * must be clickable and fire onChange with its own id.
 */
describe('FormatPicker', () => {
  it('renders all three format options', () => {
    render(
      <FormatPicker value="jpeg" onChange={() => {}} quality={0.85} onQualityChange={() => {}} />,
    );
    expect(screen.getByText('JPEG')).toBeInTheDocument();
    expect(screen.getByText('PNG')).toBeInTheDocument();
    expect(screen.getByText('WebP')).toBeInTheDocument();
  });

  it('fires onChange("jpeg") when JPEG is clicked', async () => {
    const onChange = vi.fn();
    render(
      <FormatPicker value="png" onChange={onChange} quality={0.85} onQualityChange={() => {}} />,
    );
    await userEvent.click(screen.getByText('JPEG'));
    expect(onChange).toHaveBeenCalledWith('jpeg');
  });

  it('fires onChange("png") when PNG is clicked', async () => {
    const onChange = vi.fn();
    render(
      <FormatPicker value="jpeg" onChange={onChange} quality={0.85} onQualityChange={() => {}} />,
    );
    await userEvent.click(screen.getByText('PNG'));
    expect(onChange).toHaveBeenCalledWith('png');
  });

  it('fires onChange("webp") when WebP is clicked', async () => {
    const onChange = vi.fn();
    render(
      <FormatPicker value="jpeg" onChange={onChange} quality={0.85} onQualityChange={() => {}} />,
    );
    await userEvent.click(screen.getByText('WebP'));
    expect(onChange).toHaveBeenCalledWith('webp');
  });

  it('shows the quality slider for JPEG', () => {
    render(
      <FormatPicker value="jpeg" onChange={() => {}} quality={0.85} onQualityChange={() => {}} />,
    );
    expect(screen.getByLabelText(/quality/i)).toBeInTheDocument();
  });

  it('shows the quality slider for WebP', () => {
    render(
      <FormatPicker value="webp" onChange={() => {}} quality={0.85} onQualityChange={() => {}} />,
    );
    expect(screen.getByLabelText(/quality/i)).toBeInTheDocument();
  });

  it('hides the quality slider for PNG (lossless)', () => {
    render(
      <FormatPicker value="png" onChange={() => {}} quality={0.85} onQualityChange={() => {}} />,
    );
    expect(screen.queryByLabelText(/quality/i)).not.toBeInTheDocument();
  });

  it('fires onQualityChange when the slider moves', () => {
    const onQualityChange = vi.fn();
    render(
      <FormatPicker
        value="jpeg"
        onChange={() => {}}
        quality={0.85}
        onQualityChange={onQualityChange}
      />,
    );
    const slider = screen.getByLabelText(/quality/i);
    // fireEvent.change is React-aware and the right tool for range inputs.
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(onQualityChange).toHaveBeenCalledWith(0.5);
  });
});
