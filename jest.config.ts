import { createRequire } from 'node:module';

const nodeRequire = createRequire(`${process.cwd()}/package.json`);

// @nx/jest is not installed in this fork. Keep the lookup so a later Postiz
// release that adds it still discovers its projects, and always run the Nabux
// provider tests.
function nxProjects(): string[] {
  try {
    const nx = nodeRequire('@nx/jest') as {
      getJestProjects?: () => string[];
    };
    const projects = nx.getJestProjects?.() || [];
    return Array.isArray(projects) ? projects : [];
  } catch (err) {
    return [];
  }
}

export default {
  projects: [
    ...nxProjects(),
    '<rootDir>/libraries/nestjs-libraries/jest.config.cjs',
  ],
};
