import { describe, it, expect } from 'vitest';
import { analyzeFileImpact, renderImpactAsPromptSection } from './file-impact-analyzer.js';

const SAMPLE_FILES: Array<[string, string]> = [
  ['package.json', '{"name":"test","dependencies":{"fastify":"^4.0.0"}}'],
  ['server.js', 'import Fastify from "fastify";\napp.get("/health", () => ({status:"ok"}));\napp.listen({port:3000});'],
  ['routes/users.js', 'import { z } from "zod";\nexport function registerUserRoutes(app) { app.get("/api/users", handler); }'],
  ['routes/auth.js', 'export function registerAuthRoutes(app) { app.post("/auth/login", handler); }'],
  ['schema/user.js', 'import { z } from "zod";\nexport const UserSchema = z.object({ name: z.string(), email: z.string().email() });'],
  ['db/mongo.js', 'import { MongoClient } from "mongodb";\nexport async function getMongo() {}'],
  ['mailer/templates/welcome.js', 'export function renderWelcomeEmail(name) { return `Hi ${name}`; }'],
  ['mailer/templates/rejection.js', 'export function renderRejectionEmail(name) { return `Sorry ${name}`; }'],
  ['web/App.tsx', 'export function App() { return <div>Hello</div>; }'],
  ['web/components/Form.tsx', 'export function Form() { return <form>...</form>; }'],
  ['web/styles/globals.css', ':root { --primary: #00e5cc; }'],
  ['tests/health.test.js', 'test("health", () => {});'],
  ['README.md', '# Test App'],
  ['.env.example', 'PORT=3000'],
];

describe('file-impact-analyzer', () => {
  it('identifies email-related files for email instructions', () => {
    const impacts = analyzeFileImpact('Make the rejection email warmer', SAMPLE_FILES);
    const paths = impacts.map((i) => i.path);
    expect(paths).toContain('mailer/templates/rejection.js');
    expect(impacts[0]!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('identifies form files for field change instructions', () => {
    const impacts = analyzeFileImpact('Add a phone number field to the form', SAMPLE_FILES);
    const paths = impacts.map((i) => i.path);
    expect(paths).toContain('web/components/Form.tsx');
    expect(paths).toContain('schema/user.js');
  });

  it('identifies style files for design instructions', () => {
    const impacts = analyzeFileImpact('Change the primary color to blue', SAMPLE_FILES);
    const paths = impacts.map((i) => i.path);
    expect(paths).toContain('web/styles/globals.css');
  });

  it('identifies route files for API instructions', () => {
    const impacts = analyzeFileImpact('Add a new API endpoint for products', SAMPLE_FILES);
    const paths = impacts.map((i) => i.path);
    expect(paths.some((p) => p.includes('route'))).toBe(true);
  });

  it('identifies database files for database instructions', () => {
    const impacts = analyzeFileImpact('Add a new database collection for orders', SAMPLE_FILES);
    const paths = impacts.map((i) => i.path);
    expect(paths).toContain('db/mongo.js');
  });

  it('identifies auth files for auth instructions', () => {
    const impacts = analyzeFileImpact('Add OAuth login with Google', SAMPLE_FILES);
    const paths = impacts.map((i) => i.path);
    expect(paths).toContain('routes/auth.js');
  });

  it('identifies test files for test instructions', () => {
    const impacts = analyzeFileImpact('Add more tests for the user endpoints', SAMPLE_FILES);
    const paths = impacts.map((i) => i.path);
    expect(paths).toContain('tests/health.test.js');
  });

  it('gives README low confidence', () => {
    const impacts = analyzeFileImpact('Update the styling of the dashboard', SAMPLE_FILES);
    const readme = impacts.find((i) => i.path === 'README.md');
    if (readme) {
      expect(readme.confidence).toBeLessThanOrEqual(0.1);
    }
  });

  it('detects directly mentioned file paths', () => {
    const impacts = analyzeFileImpact('Fix the bug in "routes/users.js"', SAMPLE_FILES);
    const userRoute = impacts.find((i) => i.path === 'routes/users.js');
    expect(userRoute).toBeDefined();
    expect(userRoute!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('renders prompt section correctly', () => {
    const impacts = analyzeFileImpact('Make the rejection email warmer', SAMPLE_FILES);
    const section = renderImpactAsPromptSection(impacts);
    expect(section).toContain('File impact prediction');
    expect(section).toContain('DO NOT modify');
    expect(section).toContain('HIGH confidence');
  });

  it('returns empty for unrelated instructions', () => {
    const impacts = analyzeFileImpact('Deploy to production', SAMPLE_FILES);
    // Most files should have low confidence for a deploy instruction
    const highConfidence = impacts.filter((i) => i.confidence >= 0.7);
    expect(highConfidence.length).toBeLessThanOrEqual(2);
  });
});
