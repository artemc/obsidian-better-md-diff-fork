import { describe, expect, it } from 'vitest';
import { LocalizedError, t } from '../src/i18n';

describe('interface text', () => {
  it('fills named placeholders and keeps unknown ones', () => {
    expect(t('Change {index} / {total}', { index: 2, total: 3 })).toBe('Change 2 / 3');
    expect(t('{base} line {from}', { from: 4 })).toBe('{base} line 4');
  });
  it('builds user-facing errors from the same text', () => {
    const error = new LocalizedError('Git read failed: {detail}', { detail: 'fatal' });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Git read failed: fatal');
  });
});
