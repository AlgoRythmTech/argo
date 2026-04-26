import { describe, expect, it } from 'vitest';
import { escapeForEmail, renderTemplate, sanitiseSubject } from './escape.js';

describe('escapeForEmail', () => {
  it('escapes the standard set', () => {
    expect(escapeForEmail("<script>alert('x')</script>")).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;&#x2F;script&gt;',
    );
  });

  it('handles null and undefined', () => {
    expect(escapeForEmail(null)).toBe('');
    expect(escapeForEmail(undefined)).toBe('');
  });

  it('coerces non-strings', () => {
    expect(escapeForEmail(42)).toBe('42');
  });
});

describe('sanitiseSubject', () => {
  it('strips header injection candidates', () => {
    expect(sanitiseSubject('Hello\r\nBcc: evil@x.com')).toBe('Hello Bcc: evil@x.com');
  });

  it('falls back when empty', () => {
    expect(sanitiseSubject('   ')).toBe('(no subject)');
  });
});

describe('renderTemplate', () => {
  it('escapes html mode', () => {
    expect(renderTemplate('Hello {{name}}', { name: '<b>x</b>' }, { mode: 'html' })).toBe(
      'Hello &lt;b&gt;x&lt;&#x2F;b&gt;',
    );
  });

  it('does not escape plain mode', () => {
    expect(renderTemplate('Hello {{name}}', { name: '<b>x</b>' })).toBe('Hello <b>x</b>');
  });

  it('looks up nested keys', () => {
    expect(renderTemplate('Hi {{user.name}}', { user: { name: 'Maya' } })).toBe('Hi Maya');
  });
});
