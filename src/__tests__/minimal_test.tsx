import { render } from '@testing-library/react';
import { it, expect } from 'vitest';

it('minimal', () => {
  expect(typeof render).toBe('function');
});
