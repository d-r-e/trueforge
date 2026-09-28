// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CatalogRow } from '@/atoms/draft/DraftCompositeSelector.js';

describe('CatalogRow description tooltip', () => {
  it('shows the full description in a tooltip on hover', () => {
    const description =
      'Answer questions about how a company (default Truefoundry) appears across analyst reports and filings.';
    render(<CatalogRow title="analyst-report-insights" description={description} checked={false} onToggle={vi.fn()} />);

    const descriptionEl = screen.getByText(description);
    expect(descriptionEl).toHaveClass('line-clamp-1');

    fireEvent.mouseEnter(descriptionEl);
    expect(screen.getByRole('tooltip')).toHaveTextContent(description);
  });
});
