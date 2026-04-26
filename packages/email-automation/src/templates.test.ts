import { describe, expect, it } from 'vitest';
import { renderApprovalEmail, renderDigestEmail, renderRepairApprovalEmail } from './templates.js';

describe('renderApprovalEmail', () => {
  it('produces the locked subject shape', () => {
    const r = renderApprovalEmail({
      operationName: "Maya's Recruiting",
      ownerFirstName: 'Maya',
      itemSummary: 'Approve forward to Acme — Priya R.',
      draftPreview: ['Hi Acme,', 'Sharing Priya — strong match.'],
      approveUrl: 'https://app.argo/approve/x',
      editUrl: 'https://app.argo/edit/x',
      declineUrl: 'https://app.argo/decline/x',
    });
    expect(r.subject.startsWith("[Argo · Maya's Recruiting]")).toBe(true);
    expect(r.text).toContain('[ APPROVE & SEND ]');
    expect(r.text).toContain('[ EDIT FIRST ]');
    expect(r.text).toContain('[ DECLINE ]');
    expect(r.html).toContain('APPROVE &amp; SEND');
  });

  it('escapes html in variable substitution', () => {
    const r = renderApprovalEmail({
      operationName: '<scam>',
      ownerFirstName: '<x>',
      itemSummary: 'safe',
      draftPreview: ['<b>nope</b>'],
      approveUrl: 'https://x',
      editUrl: 'https://x',
      declineUrl: 'https://x',
    });
    expect(r.html).not.toContain('<b>nope</b>');
    expect(r.html).toContain('&lt;b&gt;nope&lt;&#x2F;b&gt;');
  });
});

describe('renderDigestEmail', () => {
  it('keeps three paragraphs and no bullets', () => {
    const r = renderDigestEmail({
      operationName: "Maya's Recruiting",
      ownerFirstName: 'Maya',
      paragraphs: ['p1', 'p2', 'p3'],
    });
    expect(r.text).toContain('p1');
    expect(r.text).toContain('p2');
    expect(r.text).toContain('p3');
    expect(r.text).not.toContain('•');
  });
});

describe('renderRepairApprovalEmail', () => {
  it('includes the three load-bearing sentences', () => {
    const r = renderRepairApprovalEmail({
      operationName: "Maya's Recruiting",
      ownerFirstName: 'Maya',
      whatBroke: 'duplicate emails to candidates',
      whatChanged: 'wait 24h before second send',
      whatWeTested: 'synthetic submission round-trip',
      approveUrl: 'https://x',
      reviewUrl: 'https://x',
    });
    expect(r.text).toContain('What broke:');
    expect(r.text).toContain('What I changed:');
    expect(r.text).toContain('What I tested:');
  });
});
