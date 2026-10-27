/** @type {import('jest').Config} */
module.exports = {
  displayName: 'nabux-providers',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/integrations/social/nabux/**/*.spec.ts'],
  moduleNameMapper: {
    '^@gitroom/nestjs-libraries/(.*)$': '<rootDir>/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/../helpers/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: false,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          module: 'commonjs',
          target: 'es2021',
          types: ['jest', 'node'],
          skipLibCheck: true,
        },
      },
    ],
  },
};
